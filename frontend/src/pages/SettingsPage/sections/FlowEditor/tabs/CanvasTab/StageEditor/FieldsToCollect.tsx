import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import React from 'react';
import { Button, Checkbox, Chip } from '@heroui/react';
import { flowStore } from '../../../../../../../stores/flowStore';
import { app } from '../../../../../../../helpers/app';

export const FieldsToCollect: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');

  if (!flowStore.editorState?.selectedStage) return null;

  const { selectedStage } = flowStore.editorState;
  const availableFields = Object.keys(flowStore.editorState.flow.definition.fields);
  const stage = flowStore.editorState.flow.definition.stages[selectedStage];
  const missingRefs = stage.fieldsToCollect.filter((f) => !availableFields.includes(f));

  const removeRef = (fieldSlug: string) => {
    flowStore.updateStage(selectedStage, {
      fieldsToCollect: stage.fieldsToCollect.filter((f) => f !== fieldSlug),
    });
  };

  const ensureFieldDefinition = (fieldSlug: string) => {
    const exists = !!flowStore.editorState?.flow.definition.fields[fieldSlug];
    if (exists) return;
    flowStore.setEditorStateValue({
      definition: {
        fields: {
          [fieldSlug]: { type: 'string', description: '' },
        },
      },
    });
    app.notification.success(t('createdFieldDefinition', { slug: fieldSlug }));
  };

  return (
    <div className="grid gap-2">
      {missingRefs.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-danger-200 bg-danger-50 p-2">
          <div className="text-tiny text-danger-700">{t('missingFieldRefsMsg')}</div>
          <div className="flex flex-wrap gap-2">
            {missingRefs.map((fieldSlug) => (
              <Chip
                key={fieldSlug}
                color="danger"
                variant="flat"
                className="gap-2"
              >
                <span className="font-mono text-tiny">{fieldSlug}</span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => ensureFieldDefinition(fieldSlug)}
                  >
                    {t('createFieldDefinition')}
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => removeRef(fieldSlug)}
                  >
                    {t('removeFieldRef')}
                  </Button>
                </div>
              </Chip>
            ))}
          </div>
        </div>
      )}
      {availableFields.length === 0 && (
        <div className="text-tiny text-default-500">{t('noFieldsDefinedYet')}</div>
      )}
      {availableFields.map((fieldSlug) => (
        <Checkbox
          key={fieldSlug}
          isSelected={stage.fieldsToCollect.includes(fieldSlug)}
          onValueChange={(checked) => {
            flowStore.updateStage(
              selectedStage,
              {
                fieldsToCollect: checked
                  ? [...stage.fieldsToCollect, fieldSlug]
                  : stage.fieldsToCollect.filter((f) => f !== fieldSlug),
              });
          }}
        >
          {fieldSlug}
        </Checkbox>
      ))}
    </div>
  );
});
