import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Card, CardBody, Checkbox, Input, Select, SelectItem, Textarea } from '@heroui/react';
import { useTranslations } from 'use-intl';
import { BarsArrowUpIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { flowStore } from '../../../../../stores/flowStore';
import { FieldDefinition, FlowDefinition } from '../../../../../types/flow';
import { app } from '../../../../../helpers/app';

export const FieldsTab: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');
  const tCommon = useTranslations('Common');

  const [slugMap, setSlugMap] = useState(new Map<string, string>());
  const [search, setSearch] = useState('');

  if (!flowStore.editorState) return null;

  const { fields } = flowStore.editorState.flow.definition;
  const uiConfig = flowStore.editorState.flow.definition.config.ui || { fieldsSort: 'none' as const };

  const addField = () => {
    let ind = Object.keys(fields).length + 1;
    while (fields[`field_${ind}`]) ind += 1;
    flowStore.rewriteEditorStateValue({
      definition: {
        ...flowStore.editorState!.flow.definition,
        fields: {
          [`field_${ind}`]: { type: 'string', description: '' },
          ...flowStore.editorState!.flow.definition.fields,
        },
      },
    });
  };

  const setFields = (slug: string, def: Partial<FieldDefinition>) => {
    if (typeof slug !== 'string') return;
    flowStore.setEditorStateValue({
      definition: {
        fields: { [slug]: def },
      },
    });
  };

  const reconcileSlugs = () => {
    const res = flowStore.applyPendingFieldSlugEdits();
    if (!res.ok) {
      app.notification.error(`Cannot rename fields due to collisions: ${res.collisions.join(', ')}`);
      return;
    }
    setSlugMap(new Map());
  };

  const deleteField = (slug: string) => {
    if (!flowStore.editorState) return;
    const res = flowStore.applyPendingFieldSlugEdits();
    if (!res.ok) {
      app.notification.error(`Cannot rename fields due to collisions: ${res.collisions.join(', ')}`);
      return;
    }

    const currentFields = flowStore.editorState.flow.definition.fields;
    const currentStages = flowStore.editorState.flow.definition.stages;

    const newFields: FlowDefinition['fields'] = { ...currentFields };
    delete newFields[slug];

    const newStages: FlowDefinition['stages'] = {};
    for (const [stageSlug, stageDef] of Object.entries(currentStages)) {
      const filtered = stageDef.fieldsToCollect.filter((f) => f !== slug);
      const deduped = Array.from(new Set(filtered));
      newStages[stageSlug] = {
        ...stageDef,
        fieldsToCollect: deduped.filter((f) => f in newFields),
      };
    }

    setSlugMap(new Map());
    flowStore.rewriteEditorStateValue({
      definition: {
        ...flowStore.editorState.flow.definition,
        fields: newFields,
        stages: newStages,
      },
    });
  };

  const sortFieldsByPriority = () => {
    if (!flowStore.editorState) return;

    const res = flowStore.applyPendingFieldSlugEdits();
    if (!res.ok) {
      app.notification.error(`Cannot rename fields due to collisions: ${res.collisions.join(', ')}`);
      return;
    }

    const nextSort = uiConfig.fieldsSort === 'priorityAsc' ? 'none' : 'priorityAsc';
    flowStore.rewriteEditorStateValue({
      definition: {
        ...flowStore.editorState.flow.definition,
        config: {
          ...flowStore.editorState.flow.definition.config,
          ui: {
            ...(flowStore.editorState.flow.definition.config.ui || {}),
            fieldsSort: nextSort,
          },
        },
      },
    });
  };

  const normalizedSearch = String(search || '').trim().toLowerCase();
  const baseEntries = Object.entries(fields);
  const sortedEntries = (uiConfig.fieldsSort === 'priorityAsc')
    ? [...baseEntries].sort(([aSlug, aDef], [bSlug, bDef]) => {
      const aPr = typeof (aDef as any)?.priority === 'number' ? (aDef as any).priority : Number.POSITIVE_INFINITY;
      const bPr = typeof (bDef as any)?.priority === 'number' ? (bDef as any).priority : Number.POSITIVE_INFINITY;
      if (aPr !== bPr) return aPr - bPr;
      return aSlug.localeCompare(bSlug);
    })
    : baseEntries;

  const visibleEntries = sortedEntries.filter(([fieldSlug, fieldDefinition]) => {
    if (!normalizedSearch) return true;
    const displayedSlug = String(slugMap.get(fieldSlug) || fieldSlug).toLowerCase();
    const desc = String(fieldDefinition?.description || '').toLowerCase();
    return displayedSlug.includes(normalizedSearch) || desc.includes(normalizedSearch);
  });

  return (
    <div className="grid gap-3">
      <div className="text-tiny text-default-500">{t('defileFlowLevelFieldsMsg')}</div>
      {Object.keys(fields).length === 0 && (
        <div className="text-small text-default-500">{t('noFieldsYetMsg')}</div>
      )}

      <div className="flex items-end gap-2">
        <Input
          size="sm"
          label={t('searchFields')}
          value={search}
          onValueChange={setSearch}
          startContent={<MagnifyingGlassIcon className="size-4 text-default-400" />}
          className="max-w-md"
        />
        <Button
          size="sm"
          variant="flat"
          isIconOnly
          aria-label={t('sortByPriority')}
          title={t('sortByPriority')}
          onPress={sortFieldsByPriority}
        >
          <BarsArrowUpIcon className="size-4" />
        </Button>
        <Button
          size="sm"
          onPress={addField}
          startContent={<PlusIcon className="size-3" />}
        >
          {t('addField')}
        </Button>
      </div>

      {visibleEntries.map(([fieldSlug, fieldDefinition]) => (
        <Card key={fieldSlug} shadow="none" className="border border-default-200">
          <CardBody className="grid gap-3 md:grid-cols-4 items-end">
            <Input
              label={t('slug')}
              value={slugMap.get(fieldSlug) || fieldSlug}
              size="sm"
              onValueChange={(v) => {
                setSlugMap((prevMap) => {
                  const newMap = new Map(prevMap);
                  newMap.set(fieldSlug, v);
                  return newMap;
                });
                flowStore.setPendingFieldSlugEdit(fieldSlug, v);
              }}
              onBlur={reconcileSlugs}
            />
            <Input
              label={t('priority')}
              size="sm"
              value={String(fieldDefinition.priority ?? '')}
              onValueChange={(v) => {
                const n = Number(String(v).trim());
                setFields(fieldSlug, { priority: Number.isFinite(n) ? n : undefined });
              }}
            />
            <Select
              label={t('type')}
              size="sm"
              selectedKeys={Array.isArray(fieldDefinition.enum) ? ['enum'] : [fieldDefinition.type]}
              onSelectionChange={(selection) => {
                const selectedKey = (selection as any)?.currentKey ?? (selection as any)?.anchorKey;
                if (!selectedKey) return;
                const isEnum = selectedKey === 'enum';
                const type = isEnum ? 'string' : selectedKey as FieldDefinition['type'];

                setFields(fieldSlug, { type, enum: isEnum ? [] : undefined });
              }}
            >
              <SelectItem key="string">{t('string')}</SelectItem>
              <SelectItem key="enum">{t('enum')}</SelectItem>
              <SelectItem key="number">{t('number')}</SelectItem>
              <SelectItem key="boolean">{t('boolean')}</SelectItem>
            </Select>
            <div className="flex items-center gap-3">
              <Checkbox
                isSelected={!!fieldDefinition.sensitive}
                onValueChange={(sensitive) => setFields(fieldSlug, { sensitive })}
              >
                {t('sensitive')}
              </Checkbox>
              <Button
                size="sm"
                color="danger"
                variant="flat"
                onPress={() => deleteField(fieldSlug)}
              >
                {tCommon('delete')}
              </Button>
            </div>
            {Array.isArray(fieldDefinition.enum) && (
              <Input
                size="sm"
                className="md:col-span-4"
                label={t('allowedValues')}
                value={fieldDefinition.enum.join(',')}
                onValueChange={(v) => {
                  const newEnum = v.split(',').map((s) => s.trim());
                  setFields(fieldSlug, { enum: newEnum });
                }}
              />
            )}
            {!Array.isArray(fieldDefinition.enum) && fieldDefinition.type === 'string' && (
              <div className="col-span-full grid grid-cols-3 gap-3">
                <Input
                  size="sm"
                  label={t('patternRegex')}
                  value={fieldDefinition.pattern || ''}
                  onValueChange={(pattern) => setFields(fieldSlug, { pattern })}
                />
                <Input
                  size="sm"
                  label={t('minLength')}
                  value={String(fieldDefinition.minLength || '')}
                  onValueChange={(minLength) => setFields(fieldSlug, { minLength: Number(minLength) || undefined })}
                />
                <Input
                  size="sm"
                  label={t('maxLength')}
                  value={String(fieldDefinition.maxLength || '')}
                  onValueChange={(maxLength) => setFields(fieldSlug, { maxLength: Number(maxLength) || undefined })}
                />
              </div>
            )}
            <Textarea
              className="col-span-4"
              label={t('description')}
              value={fieldDefinition.description || ''}
              size="sm"
              minRows={1}
              onValueChange={(description) => setFields(fieldSlug, { description })}
            />
          </CardBody>
        </Card>
      ))}
    </div>
  );
});
