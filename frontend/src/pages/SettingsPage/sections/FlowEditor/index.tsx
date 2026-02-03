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
      const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toJS(flowStore.editorState.flow)),
      });
      const res = await resp.json();
      if (!res.ok) {
        app.notification.error(res.error || res.message);
        throw res;
      }
      await queryClient.invalidateQueries({ queryKey: ['flows', 'get', flowId] });
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
