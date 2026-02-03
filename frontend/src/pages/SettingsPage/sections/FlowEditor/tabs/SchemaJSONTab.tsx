import React from 'react';
import { observer } from 'mobx-react-lite';
import { Textarea } from '@heroui/react';
import { flowStore } from '../../../../../stores/flowStore';

export const SchemaJSONTab: React.FC = observer(() => {
  if (!flowStore.editorState) return null;

  return (
    <Textarea
      value={JSON.stringify(flowStore.editorState.flow, null, 2)}
      readOnly
      maxRows={25}
      className="font-mono"
    />
  );
});
