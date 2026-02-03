import React from 'react';
import { observer } from 'mobx-react-lite';
import { FlowGraphEdgeKind } from '../../../../../../../types/flow';
import { flowStore } from '../../../../../../../stores/flowStore';

const bezierPath = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(Math.abs(x2 - x1) * 0.5, 40);
  const c1x = x1 + dx;
  const c2x = x2 - dx;
  return `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
};

export const GraphEdges: React.FC = observer(() => {
  if (!flowStore.editorState) return null;

  const { graphEdges, graphNodes } = flowStore.editorState;

  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
      <defs>
        <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
          <path d="M0,0 L12,6 L0,12 z" fill="currentColor" />
        </marker>
      </defs>
      {graphEdges.map((e, index) => {
        const from = graphNodes.find((n) => n.stageSlug === e.from);
        const to = graphNodes.find((n) => n.stageSlug === e.to);
        if (!from || !to) return null;
        const x1 = from.x + 120;
        const y1 = from.y + 24;
        const x2 = to.x;
        const y2 = to.y + 24;
        const colorClass = {
          [FlowGraphEdgeKind.Fixed]: 'text-primary',
          [FlowGraphEdgeKind.Conditional]: 'text-warning',
          [FlowGraphEdgeKind.Fallback]: 'text-default-400',
        }[e.kind];
        const dash = e.kind === FlowGraphEdgeKind.Fallback ? '2 4' : '0';
        const path = bezierPath(x1, y1, x2, y2);
        // Use index to ensure unique keys even if multiple edges have same from/to
        return (
          <g key={`${e.from}->${e.to}-${e.kind}-${index}`} className={`pointer-events-none ${colorClass}`}>
            <path
              d={path}
              style={{
                stroke: 'currentColor',
                strokeWidth: 2,
                fill: 'none',
                strokeDasharray: dash,
              }}
              markerEnd="url(#arrow)"
            />
          </g>
        );
      })}
    </svg>
  );
});
