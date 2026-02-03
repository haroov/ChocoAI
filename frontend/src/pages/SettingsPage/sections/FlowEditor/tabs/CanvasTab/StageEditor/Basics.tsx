import React from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { Input, Textarea } from '@heroui/react';
import { flowStore } from '../../../../../../../stores/flowStore';

export const Basics: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');

  if (!flowStore.editorState?.selectedStage) return null;

  const { selectedStage } = flowStore.editorState;
  const stage = flowStore.editorState.flow.definition.stages[selectedStage];

  return (
    <div className="grid gap-3">
      <Input
        label={t('slug')}
        value={selectedStage}
        onValueChange={(v) => flowStore.changeStageSlug(selectedStage, v)}
      />
      <Input
        label={t('name')}
        value={stage.name || ''}
        onValueChange={(name) => flowStore.updateStage(selectedStage, { name })}
      />
      <Textarea
        label={t('description')}
        value={stage.description}
        onValueChange={(description) => flowStore.updateStage(selectedStage, { description })}
        minRows={2}
      />
      <Textarea
        label={t('prompt')}
        value={stage.prompt}
        onValueChange={(prompt) => flowStore.updateStage(selectedStage, { prompt })}
        minRows={2}
      />
    </div>
  );
});
