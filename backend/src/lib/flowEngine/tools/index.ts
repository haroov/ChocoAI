import type { ToolExecutionContext, ToolExecutor, ToolResult } from './types';

type ToolMeta = {
  name: string;
  description?: string;
  builtIn?: boolean;
  metadata?: any;
};

type RegisteredTool = {
  executor: ToolExecutor;
  meta: ToolMeta;
};

/**
 * In-memory tool registry.
 *
 * - Built-in tools are loaded lazily (on first execution) to avoid heavy imports on startup.
 * - Dynamic tools are registered at runtime via the Tools API.
 */
const dynamicTools = new Map<string, RegisteredTool>();
const builtInCache = new Map<string, RegisteredTool>();

type BuiltInLoader = () => Promise<RegisteredTool>;

const builtInLoaders: Record<string, BuiltInLoader> = {
  // Welcome
  'welcome.intentGate': async () => {
    const m = await import('./executors/welcomeIntentGateTool');
    return { executor: m.welcomeIntentGateTool, meta: { name: 'welcome.intentGate', description: 'Welcome intent gate', builtIn: true } };
  },
  'welcome.route': async () => {
    const m = await import('./executors/welcomeRouteTool');
    return { executor: m.welcomeRouteTool, meta: { name: 'welcome.route', description: 'Welcome router', builtIn: true } };
  },

  // Choco / onboarding
  'choco.signup': async () => {
    const m = await import('./executors/signupTool');
    return { executor: m.signupTool, meta: { name: 'choco.signup', description: 'Choco signup', builtIn: true } };
  },
  // Back-compat name used in admin list
  'choco.setup-organisation': async () => {
    const m = await import('./executors/createOrgTool');
    return { executor: m.createOrgTool, meta: { name: 'choco.setup-organisation', description: 'Create organisation', builtIn: true } };
  },

  // Nonprofit
  'nonprofit.lookup': async () => {
    const m = await import('./executors/nonprofitLookupTool');
    return { executor: m.nonprofitLookupTool, meta: { name: 'nonprofit.lookup', description: 'Nonprofit lookup', builtIn: true } };
  },

  // Insurance (Clal SMB topic split)
  'insurance.resolveSegment': async () => {
    const m = await import('./executors/insuranceResolveSegmentTool');
    return { executor: m.insuranceResolveSegmentTool, meta: { name: 'insurance.resolveSegment', description: 'Resolve segment from text', builtIn: true } };
  },
  'insurance.markProcessComplete': async () => {
    const m = await import('./executors/insuranceMarkProcessCompleteTool');
    return { executor: m.insuranceMarkProcessCompleteTool, meta: { name: 'insurance.markProcessComplete', description: 'Mark modular process complete and route', builtIn: true } };
  },

  // Legacy / compatibility tools referenced by old flows
  'insurance.questionnaire.init': async () => {
    const m = await import('./executors/insuranceQuestionnaireInitTool');
    return { executor: m.insuranceQuestionnaireInitTool, meta: { name: 'insurance.questionnaire.init', description: 'Legacy questionnaire init', builtIn: true } };
  },
  'insurance.questionnaire.answer': async () => {
    const m = await import('./executors/insuranceQuestionnaireAnswerTool');
    return { executor: m.insuranceQuestionnaireAnswerTool, meta: { name: 'insurance.questionnaire.answer', description: 'Legacy questionnaire answer', builtIn: true } };
  },
  'insurance.ensureCase': async () => {
    const m = await import('./executors/insuranceEnsureCaseTool');
    return { executor: m.insuranceEnsureCaseTool, meta: { name: 'insurance.ensureCase', description: 'Ensure insurance case exists', builtIn: true } };
  },
  'insurance.saveIntake': async () => {
    const m = await import('./executors/insuranceSaveIntakeTool');
    return { executor: m.insuranceSaveIntakeTool, meta: { name: 'insurance.saveIntake', description: 'Save insurance intake', builtIn: true } };
  },
  'insurance.generatePdfs': async () => {
    const m = await import('./executors/insuranceGeneratePdfsTool');
    return { executor: m.insuranceGeneratePdfsTool, meta: { name: 'insurance.generatePdfs', description: 'Generate insurance PDFs', builtIn: true } };
  },
  'insurance.enrichBusiness': async () => {
    const m = await import('./executors/insuranceEnrichBusinessTool');
    return { executor: m.insuranceEnrichBusinessTool, meta: { name: 'insurance.enrichBusiness', description: 'Enrich business data', builtIn: true } };
  },
  'insurance.setDefaultProductLine': async () => {
    const m = await import('./executors/insuranceSetDefaultProductLineTool');
    return { executor: m.insuranceSetDefaultProductLineTool, meta: { name: 'insurance.setDefaultProductLine', description: 'Set default product line', builtIn: true } };
  },
  'insurance.handoffToProposalForm': async () => {
    const m = await import('./executors/insuranceHandoffToProposalFormTool');
    return { executor: m.insuranceHandoffToProposalFormTool, meta: { name: 'insurance.handoffToProposalForm', description: 'Handoff to proposal form', builtIn: true } };
  },
};

async function resolveTool(name: string): Promise<RegisteredTool | null> {
  const n = String(name || '').trim();
  if (!n) return null;

  const dyn = dynamicTools.get(n);
  if (dyn) return dyn;

  const cached = builtInCache.get(n);
  if (cached) return cached;

  const loader = builtInLoaders[n];
  if (!loader) return null;

  const reg = await loader();
  builtInCache.set(n, reg);
  return reg;
}

export async function executeTool(
  name: string,
  payload: any,
  context: ToolExecutionContext,
): Promise<ToolResult<any>> {
  const tool = await resolveTool(name);
  if (!tool) {
    return { success: false, error: `Tool not found: ${String(name || '').trim()}`, errorCode: 'TOOL_NOT_FOUND' };
  }
  return tool.executor(payload, context);
}

export async function registerDynamicTool(
  name: string,
  executor: ToolExecutor,
  metadata?: any,
): Promise<void> {
  const n = String(name || '').trim();
  if (!n) throw new Error('Tool name is required');
  dynamicTools.set(n, {
    executor,
    meta: {
      name: n,
      builtIn: false,
      description: String(metadata?.description || ''),
      metadata,
    },
  });
}

export function getRegisteredTools(): ToolMeta[] {
  const res: ToolMeta[] = [];

  // Built-ins (from loaders) + those already cached
  for (const name of Object.keys(builtInLoaders)) {
    const cached = builtInCache.get(name);
    res.push(cached?.meta || { name, builtIn: true });
  }

  // Dynamic
  for (const t of dynamicTools.values()) {
    res.push(t.meta);
  }

  return res;
}

export type { ToolExecutionContext, ToolExecutor, ToolResult } from './types';
