import { FlowGraphEdge, FlowGraphNode } from '../../types/flow';

const X_START = 30;
const Y_START = 40;
const X_GAP = 320;
const Y_GAP = 160;

function key(x: number, y: number) {
  return `${Math.round(x)}:${Math.round(y)}`;
}

const hasOverlaps = (nodes: FlowGraphNode[]): boolean => {
  const seen = new Set<string>();
  for (const n of nodes) {
    const k = key(n.x, n.y);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
};

const autoLayout = (
  nodes: FlowGraphNode[],
  edges: FlowGraphEdge[],
  initialStage: string,
): FlowGraphNode[] => {
  if (nodes.length === 0) return nodes;

  // Build adjacency and indegree for BFS layering from initial
  const out = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.stageSlug, []);
    inDeg.set(n.stageSlug, 0);
  }
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  }

  // BFS levels from start
  const level = new Map<string, number>();
  const q: string[] = [];
  q.push(initialStage);
  level.set(initialStage, 0);

  while (q.length) {
    const u = q.shift()!;
    const nexts = out.get(u) || [];
    for (const v of nexts) {
      if (!level.has(v)) {
        level.set(v, (level.get(u) || 0) + 1);
        q.push(v);
      }
    }
  }

  const maxLevel = Math.max(0, ...Array.from(level.values()));
  let extraIndex = 0;
  for (const n of nodes) {
    if (!level.has(n.stageSlug)) {
      level.set(n.stageSlug, maxLevel + 1 + Math.floor(extraIndex / 4));
      extraIndex += 1;
    }
  }

  // Group by level and place in grid rows within each column (level)
  const byLevel = new Map<number, FlowGraphNode[]>();
  for (const n of nodes) {
    const l = level.get(n.stageSlug) || 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(n);
  }

  // Sort stable by id for deterministic layout
  for (const arr of byLevel.values()) arr.sort((a, b) => a.stageSlug.localeCompare(b.stageSlug));

  const res: FlowGraphNode[] = nodes.map((n) => ({ ...n }));
  const idxById = new Map(res.map((n, i) => [n.stageSlug, i] as const));

  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
  levels.forEach((l, colIdx) => {
    const arr = byLevel.get(l)!;
    arr.forEach((n, rowIdx) => {
      const i = idxById.get(n.stageSlug)!;
      res[i] = {
        ...res[i],
        x: X_START + colIdx * X_GAP,
        y: Y_START + rowIdx * Y_GAP,
      };
    });
  });

  return res;
};

export const ensureGraphLayout = (
  nodes: FlowGraphNode[],
  edges: FlowGraphEdge[],
  initialStage: string,
): FlowGraphNode[] => {
  const allAtStart = nodes.length > 1 && nodes.every((n) => n.x === 0 && n.y === 0);
  if (allAtStart || hasOverlaps(nodes)) {
    return autoLayout(nodes, edges, initialStage);
  }
  return nodes;
};
