import React from 'react';
import { useTranslations } from 'use-intl';
import { Input, Textarea } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import { flowStore } from '../../../../../stores/flowStore';

export const GeneralTab: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');

  const { editorState } = flowStore;
  if (!editorState) return null;

  const { flow } = editorState;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Input
        label={t('name')}
        value={flow.name}
        onValueChange={(name) => flowStore.setEditorStateValue({ name })}
      />
      <Input
        label={t('slug')}
        value={flow.slug}
        onValueChange={(slug) => flowStore.setEditorStateValue({ slug })}
      />
      <Textarea
        label={t('description')}
        value={flow.description}
        onValueChange={(description) => flowStore.setEditorStateValue({ description })}
        minRows={3}
        className="md:col-span-2"
      />
    </div>
  );
});
