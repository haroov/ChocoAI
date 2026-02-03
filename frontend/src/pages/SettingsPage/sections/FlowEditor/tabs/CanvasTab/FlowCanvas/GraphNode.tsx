import React, { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { FlowGraphNode } from '../../../../../../../types/flow';
import classNames from '../../../../../../../helpers/classNames';
import { flowStore } from '../../../../../../../stores/flowStore';

type GraphNodeProps = {
  node: FlowGraphNode;
  selected: boolean;
  onSelect: () => void;
  onDoubleClick?: () => void;
}

export const GraphNode: React.FC<GraphNodeProps> = observer(({ node, selected, onSelect, onDoubleClick }) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x:number; y:number } | null>(null);

  const { stages } = flowStore.editorState!.flow.definition;

  return (
    <div
      ref={ref}
      className={classNames(
        'absolute rounded-medium border bg-content1 px-3 py-2 cursor-move select-none',
        selected ? 'border-primary shadow-medium' : 'border-default-300',
      )}
      style={{ left: node.x, top: node.y }}
      onMouseDown={(e) => { dragging.current = { x: e.clientX, y: e.clientY }; e.stopPropagation(); }}
      onMouseUp={(e) => { dragging.current = null; e.stopPropagation(); }}
      onMouseMove={(e) => {
        if (!dragging.current) return;
        const dx = e.clientX - dragging.current.x;
        const dy = e.clientY - dragging.current.y;
        if (dx !== 0 || dy !== 0) {
          flowStore.moveNode(node.stageSlug, dx, dy);
          dragging.current = { x: e.clientX, y: e.clientY };
        }
      }}
      onClick={(e) => { onSelect(); e.stopPropagation(); }}
      onDoubleClick={(e) => { onDoubleClick?.(); e.stopPropagation(); }}
      role="button"
      aria-pressed={selected}
      tabIndex={0}
    >
      <div className="text-small font-medium flex items-center gap-2">
        <span className={`inline-block size-2 rounded-full ${node.isFinal ? 'bg-danger' : 'bg-primary'}`} />
        {node.stageSlug}
      </div>
      <div className="text-tiny text-default-500 mt-1 max-w-[240px] truncate">{stages[node.stageSlug].description}</div>
    </div>
  );
});
