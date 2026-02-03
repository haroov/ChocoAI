import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Card, CardBody, Checkbox, Input, Select, SelectItem, Textarea } from '@heroui/react';
import { useTranslations } from 'use-intl';
import { PlusIcon } from '@heroicons/react/24/outline';
import { flowStore } from '../../../../../stores/flowStore';
import { FieldDefinition, FlowDefinition } from '../../../../../types/flow';

export const FieldsTab: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');
  const tCommon = useTranslations('Common');

  const [slugMap, setSlugMap] = useState(new Map<string, string>());

  if (!flowStore.editorState) return null;

  const { fields } = flowStore.editorState.flow.definition;

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
    const newFields: FlowDefinition['fields'] = {};
    for (const slug of Object.keys(fields)) {
      newFields[slugMap.get(slug) || slug] = fields[slug];
    }
    slugMap.clear();
    flowStore.rewriteEditorStateValue({
      definition: {
        ...flowStore.editorState!.flow.definition,
        fields: newFields,
      },
    });
  };

  const deleteField = (slug: string) => {
    const newFields: FlowDefinition['fields'] = {};
    for (const slug of Object.keys(fields)) {
      newFields[slugMap.get(slug) || slug] = fields[slug];
    }
    delete newFields[slug];
    flowStore.rewriteEditorStateValue({
      definition: {
        ...flowStore.editorState!.flow.definition,
        fields: newFields,
      },
    });
  };

  return (
    <div className="grid gap-3">
      <div className="text-tiny text-default-500">{t('defileFlowLevelFieldsMsg')}</div>
      {Object.keys(fields).length === 0 && (
        <div className="text-small text-default-500">{t('noFieldsYetMsg')}</div>
      )}

      <div>
        <Button
          size="sm"
          onPress={addField}
          startContent={<PlusIcon className="size-3" />}
        >
          {t('addField')}
        </Button>
      </div>

      {Object.entries(fields).map(([fieldSlug, fieldDefinition]) => (
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
              }}
              onBlur={reconcileSlugs}
            />
            <Select
              label={t('type')}
              size="sm"
              selectedKeys={Array.isArray(fieldDefinition.enum) ? ['enum'] : [fieldDefinition.type]}
              onSelectionChange={(selection) => {
                const isEnum = selection.anchorKey === 'enum';
                const type = isEnum ? 'string' : selection as string as FieldDefinition['type'];

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
