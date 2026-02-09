import fs from 'fs';
import path from 'path';
import { evaluateCondition } from '../questionnaire/conditions';
import { ToolExecutor, ToolResult } from '../../flowEngine/tools/types';

// Initialized on first load
let manifestCache: any = null;

function getManifest() {
  if (manifestCache) return manifestCache;

  // Canonical source-of-truth for PROD topic-split manifest lives under src/.
  // We still allow fallback candidates, but we ONLY use them if the canonical file is missing/broken.
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'backend', 'src', 'lib', 'flowEngine', 'builtInFlows', 'chocoClalSmbTopicSplit', 'MANIFEST.PROD.json'),
    // legacy fallbacks (dev convenience)
    path.join(cwd, 'backend', 'docs', 'MANIFEST.PROD.json'),
    path.join(cwd, 'docs', 'MANIFEST.PROD.json'),
  ];

  for (const jsonPath of candidates) {
    try {
      if (!fs.existsSync(jsonPath)) continue;
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.process_order) && Array.isArray(parsed.processes)) {
        manifestCache = parsed;
        return manifestCache;
      }
    } catch {
      // try next candidate
    }
  }

  // eslint-disable-next-line no-console
  console.error('MANIFEST.PROD.json not found/valid in candidates', candidates);
  return null;
}

function isNumeric0123ProcessKey(key: string): boolean {
  return /^(0[1-9]|1[0-9]|2[0-3])_/.test(String(key || ''));
}

/**
 * Tool: insurance.router.next
 *
 * Logic:
 * 1. Checks current progress (assumed stored in userData.completed_processes array).
 * 2. Iterates through MANIFEST.process_order.
 * 3. Evaluates ask_if for each process.
 * 4. Returns the slug of the first applicable, uncompleted process.
 * 5. If all applicable processes are done, transitions to 'flow_done' (or finalizes).
 */
export const insuranceRouterNextTool: { execute: ToolExecutor } = {
  execute: async (userData: any, { conversationId }: { conversationId: string }): Promise<ToolResult> => {
    // conversationId is currently unused, but we keep it in the signature for future telemetry.
    void conversationId;

    const manifest = getManifest();
    if (!manifest) {
      return { success: false, error: 'Manifest not loaded' };
    }

    const process_order = (manifest.process_order || []).filter(isNumeric0123ProcessKey);
    const processes = manifest.processes || [];
    const completedProcesses = Array.isArray(userData.completed_processes)
      ? new Set(userData.completed_processes)
      : new Set();

    // Create a map for quick lookup
    const processMap = new Map<string, any>();
    for (const p of processes) {
      processMap.set(p.process_key, p);
    }

    // Find the first process that:
    // 1. Is NOT in completedProcesses
    // 2. conditions (ask_if) evaluate to TRUE
    let nextProcessKey: string | null = null;

    for (const key of process_order) {
      // If already done, skip
      if (completedProcesses.has(key)) continue;

      const processDef = processMap.get(key);
      if (!processDef) continue; // Should not happen if manifest is valid

      // Check condition
      const isRelevant = evaluateCondition(processDef.ask_if, userData);

      if (isRelevant) {
        nextProcessKey = key;
        break; // Found our winner
      }
    }

    if (nextProcessKey) {
      // Found a process to run.
      // We need to return the SLUG of the flow.
      // Convention: flow_{process_key}
      const nextFlowSlug = `flow_${nextProcessKey}`;

      // eslint-disable-next-line no-console
      console.log(`[Router] Routing to ${nextFlowSlug} (Process: ${nextProcessKey})`);

      return {
        success: true,
        // We return data that the Flow Engine can use to transition.
        // Currently tools return `data`. The Flow Engine Action usually doesn't AUTO transition based on data
        // unless we use a specific "router" behavior or if we update a field that triggers a transition.

        // However, the "Router Flow" (which calls this tool) defines the logic.
        // Result will be stored in `router_next_slug`.
        data: {
          router_next_slug: nextFlowSlug,
          router_process_key: nextProcessKey,
          // also provide standard transition keys
          targetFlowSlug: nextFlowSlug,
          flow_complete: false,
        },
      };
    }

    // No more processes! We are done.
    // eslint-disable-next-line no-console
    console.log('[Router] All processes complete.');
    return {
      success: true,
      data: {
        router_next_slug: 'done', // Or a final summary flow
        flow_complete: true,
      },
    };
  },
};
