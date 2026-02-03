import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { flowStore } from '../../../../../../../stores/flowStore';
import { GraphNode } from './GraphNode';
import { GraphEdges } from './GraphEdges';

interface FlowCanvasProps {
  onDoubleClick?: (id: string) => void;
}

export const FlowCanvas: React.FC<FlowCanvasProps> = observer(({ onDoubleClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasXYRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const abortSignal = new AbortController();

    containerRef.current?.addEventListener('wheel', (e) => {
      e.preventDefault();

      canvasXYRef.current.x -= e.deltaX;
      canvasXYRef.current.y -= e.deltaY;

      if (canvasRef.current) {
        canvasRef.current.style.transform = `translate(${canvasXYRef.current.x}px, ${canvasXYRef.current.y}px)`;
      }

    }, { signal: abortSignal.signal });

    return () => abortSignal.abort();
  }, []);

  if (!flowStore.editorState) return null;

  const { graphNodes, flow } = flowStore.editorState;
  const initialNode = graphNodes.find((n) => n.stageSlug === flow.definition.config.initialStage);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[680px] rounded-medium border border-default-200 bg-default-50 overflow-hidden"
      onClick={() => flowStore.selectStage(null)}
    >
      <div ref={canvasRef} className="w-full h-full relative">
        {/* SVG edges */}
        <GraphEdges />

        {/* Nodes */}
        {graphNodes.map((n) => (
          <GraphNode
            key={n.stageSlug}
            node={n}
            selected={flowStore.editorState?.selectedStage === n.stageSlug}
            onSelect={() => flowStore.selectStage(n.stageSlug)}
            onDoubleClick={() => onDoubleClick?.(n.stageSlug)}
          />
        ))}

        {/* Initial marker */}
        {initialNode && (
          <div
            className="absolute text-tiny text-default-500"
            style={{ left: initialNode.x - 16, top: initialNode.y + 22 }}
          >
            ⮚ start
          </div>
        )}
      </div>
    </div>
  );
});
