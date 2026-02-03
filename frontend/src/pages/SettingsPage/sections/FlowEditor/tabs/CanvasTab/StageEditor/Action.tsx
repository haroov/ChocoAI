import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { Input, Select, SelectItem } from '@heroui/react';
import { flowStore } from '../../../../../../../stores/flowStore';

const availableTools = [
  '–',
  'choco.signup',
  'guidestar.lookup',
  'choco.setup-organisation',
];

export const Action = observer(() => {
  const t = useTranslations('FlowEditor');

  if (!flowStore.editorState?.selectedStage) return null;

  const { selectedStage } = flowStore.editorState;
  const stage = flowStore.editorState.flow.definition.stages[selectedStage];

  return (
    <div className="grid gap-3">
      <Select
        label={t('toolToExecute')}
        selectedKeys={[stage.action?.toolName || availableTools[0]]}
        onSelectionChange={(selection) => {
          flowStore.updateStage(
            selectedStage,
            {
              action: !selection.anchorKey || selection.anchorKey === availableTools[0] ? undefined : {
                toolName: selection.anchorKey,
                condition: stage.action?.condition || '',
              },
            },
          );
        }}
      >
        {availableTools.map((toolName) => <SelectItem key={toolName}>{toolName}</SelectItem>)}
      </Select>
      {stage.action && (
        <Input
          label={t('condition')}
          value={stage.action.condition || ''}
          onValueChange={(condition) => flowStore
            .updateStage(selectedStage, { action: { ...stage.action!, condition } })}
          className="font-mono"
        />
      )}
    </div>
  );
});
