import React from 'react';
import { useParams } from 'react-router-dom';
import { Tabs, Tab, CircularProgress } from '@heroui/react';
import { Link } from '@heroui/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import { useMainLayout } from '../../../../layouts/MainLayout';
import { SectionHeader } from '../../components/SectionHeader';
import { SectionContent } from '../../components/SectionContent';
import { flowStore } from '../../../../stores/flowStore';
import { apiClientStore } from '../../../../stores/apiClientStore';
import { app } from '../../../../helpers/app';
import { GeneralTab } from './tabs/GeneralTab';
import { CanvasTab } from './tabs/CanvasTab';
import { FieldsTab } from './tabs/FieldsTab';
import { SchemaJSONTab } from './tabs/SchemaJSONTab';
import { ValidationTab } from './tabs/ValidationTab';

export const FlowEditor: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');
  const tCommon = useTranslations('Common');

  const { flowId } = useParams();
  useMainLayout({ title: 'Edit Flow' });

  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['flows', 'get', flowId],
    queryFn: async () => flowStore.loadFlow(flowId!),
    enabled: !!flowId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!flowStore.editorState) return;

      // Apply any pending slug edits even if inputs didn't blur yet.
      const renameRes = flowStore.applyPendingFieldSlugEdits();
      if (!renameRes.ok) {
        app.notification.error(`Cannot save due to field slug collisions: ${renameRes.collisions.join(', ')}`);
        throw new Error('Field slug collisions');
      }

      // Ensure any pending field slug edits (onBlur reconciliations) are applied
      // before we snapshot and send the payload.
      try {
        (document.activeElement as HTMLElement | null)?.blur?.();
      } catch {
        // ignore
      }
      await new Promise((r) => { setTimeout(r, 0); });

      // Repair: ensure all fields referenced by stages exist in definition.fields.
      // This prevents "references unknown field" save failures and lets the user fully edit via UI.
      const flow = toJS(flowStore.editorState.flow);
      const fields = { ...(flow.definition.fields || {}) };
      const stages = { ...(flow.definition.stages || {}) };
      const missingReferencedFields = new Set<string>();
      for (const stage of Object.values<any>(stages)) {
        if (!stage?.fieldsToCollect) continue;
        for (const f of stage.fieldsToCollect) {
          if (!(f in fields)) missingReferencedFields.add(String(f));
        }
      }
      if (missingReferencedFields.size > 0) {
        for (const f of missingReferencedFields) {
          fields[f] = fields[f] || { type: 'string', description: '' };
        }
        // Deduplicate and keep order
        for (const [stageSlug, stage] of Object.entries<any>(stages)) {
          const deduped = Array.from(new Set((stage.fieldsToCollect || []).map(String)));
          stages[stageSlug] = { ...stage, fieldsToCollect: deduped };
        }
        flow.definition = { ...flow.definition, fields, stages };
        app.notification.warning(t('autoCreatedMissingFieldsForSave', { count: missingReferencedFields.size }));
      }

      const fieldRenames = flowStore.editorState.fieldRenames || {};
      const payload = Object.keys(fieldRenames).length > 0
        ? { ...flow, __meta: { fieldRenames } }
        : flow;

      const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const res = await resp.json();
      if (!res.ok) {
        app.notification.error(res.error || res.message);
        throw res;
      }
      if (res.fileSync && res.fileSync.ok === false && !res.fileSync.skipped) {
        app.notification.warning(`Saved, but failed to sync to backend JSON files: ${res.fileSync.error || 'unknown error'}`);
      }
      await queryClient.invalidateQueries({ queryKey: ['flows', 'get', flowId] });
      flowStore.clearRecordedFieldRenames();
    },
  });

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title={(
          <>
            <span>{data?.name}</span>
            <span className="ml-2 text-sm text-default-500">{`v${data?.version}`}</span>
          </>
        )}
        actions={[
          {
            id: 'back-to-list',
            as: Link,
            href: '/settings/flows',
            variant: 'flat',
            children: t('backToList'),
          },
          {
            id: 'save',
            color: 'primary',
            onPress: () => saveMutation.mutate(),
            isLoading: saveMutation.isPending,
            isDisabled: isPending || !flowStore.editorState?.touched,
            children: tCommon('save'),
          },
        ]}
      />

      <SectionContent>
        {isPending && (
          <div className="flex justify-center items-center">
            <CircularProgress aria-label={`${tCommon('loading')}...`} />
          </div>
        )}
        {isError && <div className="text-danger">{'error' in error ? error.error as string : error.message}</div>}

        {!isPending && !isError && (
          <Tabs aria-label="Flow editor" variant="bordered" defaultSelectedKey="canvas">
            <Tab key="general" title={t('general')}><GeneralTab /></Tab>

            <Tab key="canvas" title={t('canvas')}><CanvasTab /></Tab>

            <Tab key="fields" title={t('fields')}><FieldsTab /></Tab>

            <Tab key="schema" title={t('schemaJSON')}><SchemaJSONTab /></Tab>

            <Tab
              key="validation"
              title={t('validationWithCount', { errorCount: flowStore.editorState?.graphIssues?.length || 0 })}
            >
              <ValidationTab />
            </Tab>
          </Tabs>
        )}
      </SectionContent>
    </div>
  );
});

FlowEditor.displayName = 'FlowEditor';
