import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import React from 'react';
import { Checkbox } from '@heroui/react';
import { flowStore } from '../../../../../../../stores/flowStore';

export const FieldsToCollect: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');

  if (!flowStore.editorState?.selectedStage) return null;

  const { selectedStage } = flowStore.editorState;
  const availableFields = Object.keys(flowStore.editorState.flow.definition.fields);
  const stage = flowStore.editorState.flow.definition.stages[selectedStage];

  return (
    <div className="grid gap-2">
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
