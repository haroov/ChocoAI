import { FlowDefinition, FlowGraphEdge, FlowGraphEdgeKind, FlowGraphNode } from '../../types/flow';

export const definitionToGraph = (stages: FlowDefinition['stages']): [FlowGraphNode[], FlowGraphEdge[]] => {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];

  Object.entries(stages).forEach(([stageSlug, stage]) => {
    nodes.push({
      stageSlug,
      x: 0,
      y: 0,
      isFinal: !stage.nextStage,
    });

    if (typeof stage.nextStage === 'string') {
      edges.push({ from: stageSlug, to: stage.nextStage, kind: FlowGraphEdgeKind.Fixed });
    } else if (typeof stage.nextStage === 'object') {
      edges.push({ from: stageSlug, to: stage.nextStage.fallback, kind: FlowGraphEdgeKind.Fallback });
      stage.nextStage.conditional.forEach((c) => {
        edges.push({ from: stageSlug, to: c.ifTrue, kind: FlowGraphEdgeKind.Conditional });
        if (c.ifFalse) edges.push({ from: stageSlug, to: c.ifFalse, kind: FlowGraphEdgeKind.Conditional });
      });
    }
  });

  return [nodes, edges];
};
