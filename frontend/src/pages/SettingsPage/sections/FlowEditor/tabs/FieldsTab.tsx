import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Card, CardBody, Checkbox, Input, Select, SelectItem, Textarea } from '@heroui/react';
import { useTranslations } from 'use-intl';
import { BarsArrowUpIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { flowStore } from '../../../../../stores/flowStore';
import { FieldDefinition, FlowDefinition } from '../../../../../types/flow';
import { app } from '../../../../../helpers/app';

type BuiltInValidationKind = 'email' | 'israeli_mobile' | 'israeli_id' | 'il_business_id';

function getBuiltInValidationMeta(fieldSlug: string, fieldDefinition: FieldDefinition): null | {
  kind: BuiltInValidationKind;
  recommendedPattern: string;
  recommendedMinLength?: number;
  recommendedMaxLength?: number;
} {
  const slug = String(fieldSlug || '').toLowerCase();
  const desc = String(fieldDefinition?.description || '');

  const looksLikeEmail = slug === 'email'
    || slug.endsWith('_email')
    || slug.includes('email')
    || /דואר\s*אלקטרוני|אימייל|מייל|\bemail\b/i.test(desc);
  if (looksLikeEmail) {
    return {
      kind: 'email',
      recommendedPattern: String.raw`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`,
    };
  }

  const looksLikeMobile = slug === 'mobile_phone'
    || slug === 'user_mobile_phone'
    || slug === 'user_phone'
    || slug === 'proposer_mobile_phone'
    || /טלפון\s*נייד|נייד|\bmobile\b/i.test(desc);
  if (looksLikeMobile) {
    return {
      kind: 'israeli_mobile',
      recommendedPattern: String.raw`^05\d{8}$`,
      recommendedMinLength: 10,
      recommendedMaxLength: 10,
    };
  }

  const looksLikeIsraeliId = slug === 'user_id'
    || slug === 'legal_id'
    || slug === 'israeli_id'
    || slug === 'id_number'
    || slug === 'tz'
    || /ת[\"״׳']?ז|תעודת\s*זהות|מספר\s*זהות/i.test(desc);
  if (looksLikeIsraeliId) {
    return {
      kind: 'israeli_id',
      recommendedPattern: String.raw`^\d{9}$`,
      recommendedMinLength: 9,
      recommendedMaxLength: 9,
    };
  }

  const looksLikeBusinessRegistrationId = slug === 'business_registration_id'
    || slug === 'regnum'
    || /ח[\"״׳']?פ|ע[\"״׳']?מ|מספר\s*רישום|vat|company\s*id/i.test(desc);
  const looksLikeEntityTaxIdIl = slug === 'entity_tax_id'
    && /ח[\"״׳']?פ|ע[\"״׳']?מ|מספר\s*רישום/i.test(desc);
  if (looksLikeBusinessRegistrationId) {
    return {
      kind: 'il_business_id',
      recommendedPattern: String.raw`^\d{9}$`,
      recommendedMinLength: 9,
      recommendedMaxLength: 9,
    };
  }
  if (looksLikeEntityTaxIdIl) {
    return {
      kind: 'il_business_id',
      recommendedPattern: String.raw`^\d{9}$`,
      recommendedMinLength: 9,
      recommendedMaxLength: 9,
    };
  }

  return null;
}

function getSelectedKeyFromSelection(selection: unknown): string | null {
  if (typeof selection === 'string') return selection;
  if (!selection || typeof selection !== 'object') return null;

  const sel = selection as { currentKey?: unknown; anchorKey?: unknown };
  const raw = sel.currentKey ?? sel.anchorKey;
  return typeof raw === 'string' && raw ? raw : null;
}

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
      const aPr = typeof aDef.priority === 'number' ? aDef.priority : Number.POSITIVE_INFINITY;
      const bPr = typeof bDef.priority === 'number' ? bDef.priority : Number.POSITIVE_INFINITY;
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
                const selectedKey = getSelectedKeyFromSelection(selection);
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
              (() => {
                const meta = getBuiltInValidationMeta(fieldSlug, fieldDefinition);
                const kindLabel = (() => {
                  if (!meta) return '';
                  switch (meta.kind) {
                    case 'email': return t('validationEmail');
                    case 'israeli_mobile': return t('validationIsraeliMobile');
                    case 'israeli_id': return t('validationIsraeliId');
                    case 'il_business_id': return t('validationIlBusinessId');
                    default: return '';
                  }
                })();

                const canApply = !!meta && (
                  (fieldDefinition.pattern || '') !== meta.recommendedPattern
                  || (meta.recommendedMinLength !== undefined
                    && fieldDefinition.minLength !== meta.recommendedMinLength)
                  || (meta.recommendedMaxLength !== undefined
                    && fieldDefinition.maxLength !== meta.recommendedMaxLength)
                );

                return (
                  <div className="col-span-full grid gap-2">
                    {meta && (
                      <div className="text-tiny text-default-500">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <span className="font-medium">{t('serverValidation')}</span>
                            {' '}
                            {kindLabel}
                            <span className="opacity-80">
                              {' '}
                              {t('serverValidationEnforcedEvenIfEmpty')}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="flat"
                            isDisabled={!canApply}
                            onPress={() => setFields(fieldSlug, {
                              pattern: meta.recommendedPattern,
                              minLength: meta.recommendedMinLength ?? fieldDefinition.minLength,
                              maxLength: meta.recommendedMaxLength ?? fieldDefinition.maxLength,
                            })}
                          >
                            {t('applyRecommended')}
                          </Button>
                        </div>
                        <div className="mt-1">
                          <span className="font-medium">{t('recommendedPattern')}</span>
                          {' '}
                          <span className="font-mono select-all">{meta.recommendedPattern}</span>
                          {meta.recommendedMinLength !== undefined
                            && meta.recommendedMaxLength !== undefined
                            && (
                              <span className="opacity-80">
                                {' '}
                                {t('recommendedMinMax', {
                                  min: meta.recommendedMinLength,
                                  max: meta.recommendedMaxLength,
                                })}
                              </span>
                            )}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        size="sm"
                        label={t('patternRegex')}
                        value={fieldDefinition.pattern || ''}
                        placeholder={meta?.recommendedPattern || ''}
                        onValueChange={(pattern) => setFields(fieldSlug, { pattern })}
                      />
                      <Input
                        size="sm"
                        label={t('minLength')}
                        value={String(fieldDefinition.minLength || '')}
                        placeholder={String(meta?.recommendedMinLength ?? '')}
                        onValueChange={(minLength) =>
                          setFields(fieldSlug, { minLength: Number(minLength) || undefined })}
                      />
                      <Input
                        size="sm"
                        label={t('maxLength')}
                        value={String(fieldDefinition.maxLength || '')}
                        placeholder={String(meta?.recommendedMaxLength ?? '')}
                        onValueChange={(maxLength) =>
                          setFields(fieldSlug, { maxLength: Number(maxLength) || undefined })}
                      />
                    </div>
                  </div>
                );
              })()
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
