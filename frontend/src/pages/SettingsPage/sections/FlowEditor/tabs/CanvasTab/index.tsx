import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ValidationPanel } from '../../ValidationPanel';
import { flowStore } from '../../../../../../stores/flowStore';
import { FlowCanvas } from './FlowCanvas';
import { FlowPalette } from './FlowPalette';
import { StageSummaryPanel } from './StageSummaryPanel';
import { StageEditor } from './StageEditor';
import { FlowAgentPanel } from './FlowAgentPanel';

export const CanvasTab: React.FC = observer(() => {
  const [stageEditorOpened, setStageEditorOpened] = useState(false);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="flex flex-col gap-3">
          <FlowCanvas
            onDoubleClick={(stage) => { flowStore.selectStage(stage); setStageEditorOpened(true); }}
          />
        </div>
        <div className="flex flex-col gap-3">
          <FlowPalette />
          <StageSummaryPanel openEditor={() => setStageEditorOpened(true)} />
          <FlowAgentPanel />
          <ValidationPanel onSelect={(stageSlug) => flowStore.selectStage(stageSlug)} />
        </div>
      </div>

      <StageEditor open={stageEditorOpened} onClose={() => setStageEditorOpened(false)} />
    </>
  );
});
