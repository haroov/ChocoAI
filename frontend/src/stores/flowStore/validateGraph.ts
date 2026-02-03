import { FlowGraphEdge, FlowGraphNode } from '../../types/flow';
import { getTranslator } from '../../helpers/getTranslator';
import { appSettingsStore } from '../appSettingsStore';

export type GraphValidationIssue = {
  id: string;
  type: 'error' | 'warning';
  message: string;
  stageSlug?: string;
}

type GraphModel = {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  initial?: string;
}

export const validateGraph = (graph: GraphModel): GraphValidationIssue[] => {
  const t = getTranslator(appSettingsStore.language);

  const issues: GraphValidationIssue[] = [];

  const nodeIds = new Set(graph.nodes.map((n) => n.stageSlug));

  if (!graph.initial) {
    issues.push({ id: 'no-initial', type: 'error', message: t('FlowEditor.initialStageIsNotSet') });
  } else if (!nodeIds.has(graph.initial)) {
    issues.push({
      id: 'initial-missing',
      type: 'error',
      message: t('FlowEditor.initialStageNotExist'),
      stageSlug: graph.initial,
    });
  }

  // Edges pointing to missing nodes
  graph.edges.forEach((e) => {
    if (!nodeIds.has(e.to)) {
      issues.push({
        id: `edge-missing-${`${e.from }->${e.to}`}`,
        type: 'error',
        message: t('FlowEditor.edgePointsToMissingStage', { stage: e.to }),
        stageSlug: e.from,
      });
    }
  });

  // Reachability from initial
  if (graph.initial && nodeIds.has(graph.initial)) {
    const visited = new Set<string>();
    const stack = [graph.initial];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      graph.edges.filter((e) => e.from === cur).forEach((e) => { if (!visited.has(e.to)) stack.push(e.to); });
    }
    graph.nodes.forEach((n) => {
      if (!visited.has(n.stageSlug)) {
        issues.push({
          id: `unreach-${n.stageSlug}`,
          type: 'warning',
          message: t('FlowEditor.unreachableStage', { stage: n.stageSlug }),
          stageSlug: n.stageSlug,
        });
      }
    });
  }

  return issues;
};
