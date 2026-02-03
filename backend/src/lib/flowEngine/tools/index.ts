import { prisma } from '../../../core/prisma';
import { logger } from '../../../utils/logger';
// Memory imports removed
import {
  sendVerificationCodeTool,
  sendGatewayIntroEmailTool,
  sendDonorSupportEmailTool,
} from '../../notifications/notificationTools';
import { ToolExecutionContext, ToolResult, ToolExecutor } from './types';
import { signupTool } from './executors/signupTool';
import { setupOrgTool } from './executors/setupOrgTool';
import { nonprofitLookupTool } from './executors/nonprofitLookupTool';
import { verifyCodeTool } from './executors/verifyCodeTool';
import { chocoLoginOTPTool } from './executors/sendPhoneOTPTool';
import { chocoLoginCompleteTool } from './executors/chocoLoginCompleteTool';
import { createOrgTool } from './executors/createOrgTool';
import { addCampaignTool } from './executors/addCampaignTool';
import { addEntityTool } from './executors/addEntityTool';
import { addPaymentGatewayTool } from './executors/addPaymentGatewayTool';
import { handoffToLoginTool } from './executors/handoffToLoginTool';
import {
  buildEntityTool,
  pushEntityTool,
  buildGatewayConfigTool,
  addGatewayTool,
  verifyGatewaysTool,
  completeKycTool,
  checkOrgSetupTool,
  matchOrgAndSelectEntityTool,
  handleGatewayDiscoveryTool,
} from './executors/kycTools';
import { flowHandoffTool } from './executors/flowHandoffTool';
import { welcomeRouteTool } from './executors/welcomeRouteTool';
import { welcomeIntentGateTool } from './executors/welcomeIntentGateTool';
import { signUpTransitionToLoginTool } from './executors/signUpTransitionToLoginTool';
import { loginTransitionToSignUpTool } from './executors/loginTransitionToSignUpTool';
import { loginLinkUserDataTool } from './executors/loginLinkUserDataTool';
import { checkAccountContextTool } from './executors/checkAccountContextTool';
import { loadOrgEntitiesTool } from './executors/loadOrgEntitiesTool';
import { resolveEntitySelectionTool } from './executors/resolveEntitySelectionTool';
import { kycEnrichEntityTool } from './executors/kycEnrichEntityTool';
import { loginRouteAfterLoginTool } from './executors/loginRouteAfterLoginTool';
import { loginAutoFillIdentifierTool } from './executors/loginAutoFillIdentifierTool';
import { finalizeGatewayUpdateTool } from './executors/finalizeGatewayUpdateTool';
import { resetCampaignIntentTool } from './executors/resetCampaignIntentTool';
import { resetKeysTool } from './executors/resetKeysTool';
import { detectCampaignManagementIntentTool } from './executors/detectCampaignManagementIntentTool';
import { loadCampaignsContextTool } from './executors/loadCampaignsContextTool';
import { resolveCampaignSelectionTool } from './executors/resolveCampaignSelectionTool';
import { getCampaignWithContentTool } from './executors/getCampaignWithContentTool';
import { executeDynamicTool } from './dynamicToolExecutor';
import { insuranceEnsureCaseTool } from './executors/insuranceEnsureCaseTool';
import { insuranceSaveIntakeTool } from './executors/insuranceSaveIntakeTool';
import { insuranceGeneratePdfsTool } from './executors/insuranceGeneratePdfsTool';

const registry = new Map<string, ToolExecutor>();
// ... (omitted)

/**
 * Register a tool executor for use in flows
 *
 * Tools must be registered before they can be used in flow stage actions.
 * Register tools at module load time in this file.
 *
 * @param name - Tool name (format: 'scope.tool-name', e.g., 'choco.signup', 'nonprofit.lookup')
 * @param executor - Tool executor function
 *
 * @example
 * ```typescript
 * import { signupTool } from './executors/signupTool';
 * registerTool('choco.signup', signupTool);
 * ```
 */
function registerTool(name: string, executor: ToolExecutor) {
  registry.set(name, executor);
}

export async function registerDynamicTool(name: string, executor: ToolExecutor, metadata?: any) {
  registry.set(name, executor);
  // Optionally store in database for persistence
  if (metadata) {
    await prisma.tool.upsert({
      where: { name },
      update: {
        description: metadata.description || '',
        code: metadata.code || '',
        metadata: metadata as any,
      },
      create: {
        name,
        description: metadata.description || '',
        code: metadata.code || '',
        metadata: metadata as any,
      },
    });
  }
}

export async function loadDynamicTools() {
  const tools = await prisma.tool.findMany();
  for (const tool of tools) {
    try {
      // Register dynamic tool - in production, would need to compile/execute code
      // For now, we'll use executeDynamicTool at runtime
      registry.set(tool.name, async (payload, context) => executeDynamicTool(tool.code, payload, context));
    } catch (error) {
      logger.error(`Failed to load dynamic tool ${tool.name}:`, error);
    }
  }
}

export function getRegisteredTools(): Array<{ id: string; label: string }> {
  // For now, label equals id. In future, executors can export metadata with human-friendly labels.
  return Array.from(registry.keys()).map((id) => ({ id, label: id }));
}

/**
 * Execute a registered tool
 *
 * Looks up the tool by name and executes it with the provided input and context.
 * If the tool is not found in the registry, attempts to load it from the database
 * (for dynamic tools).
 *
 * @template TInput - Type of input payload
 * @template TResult - Type of result data
 * @param name - Tool name (e.g., 'choco.signup')
 * @param input - Input payload (typically userData)
 * @param context - Execution context with conversationId
 * @returns Promise resolving to tool result
 *
 * @example
 * ```typescript
 * const result = await executeTool('choco.signup', userData, { conversationId });
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function executeTool<TInput, TResult = any>(
  name: string,
  input: TInput,
  context: ToolExecutionContext,
): Promise<ToolResult<TResult>> {
  const executor = registry.get(name);
  if (!executor) {
    // Try to load from database if not in registry
    const tool = await prisma.tool.findUnique({ where: { name } });
    if (tool) {
      return executeDynamicTool(tool.code, input, context);
    }
    return { success: false, error: `Tool ${name} is not registered` };
  }

  return executor(input, context) as Promise<ToolResult<TResult>>;
}

registerTool('choco.signup', signupTool);
registerTool('choco.verify-code', verifyCodeTool);
registerTool('choco.login-otp', chocoLoginOTPTool);
registerTool('choco.login-complete', chocoLoginCompleteTool);
registerTool('choco.handoff-to-login', handoffToLoginTool);
registerTool('choco.create-org', createOrgTool);
registerTool('choco.add-campaign', addCampaignTool);
registerTool('choco.add-entity', addEntityTool);
registerTool('choco.add-payment-gateway', addPaymentGatewayTool);
registerTool('choco.setup-organisation', setupOrgTool);

registerTool('nonprofit.lookup', nonprofitLookupTool);

// KYC tools
import {
  validateGatewayProviderTool,
  saveGatewayCredentialsTool,
} from './executors/kycGatewayTools';

// KYC tools
registerTool('kyc.checkOrgSetup', checkOrgSetupTool);
registerTool('kyc.matchOrgAndSelectEntity', matchOrgAndSelectEntityTool);
registerTool('kyc.buildEntity', buildEntityTool);
registerTool('kyc.pushEntity', pushEntityTool);
registerTool('kyc.buildGatewayConfig', buildGatewayConfigTool);
registerTool('kyc.addGateway', addGatewayTool);
registerTool('kyc.verifyGateways', verifyGatewaysTool);
registerTool('kyc.completeKyc', completeKycTool);
registerTool('kyc.loadOrgEntities', loadOrgEntitiesTool);
registerTool('kyc.resolveEntitySelection', resolveEntitySelectionTool);
registerTool('kyc.enrichEntity', kycEnrichEntityTool);
registerTool('kyc.handleGatewayDiscovery', handleGatewayDiscoveryTool);
registerTool('kyc.validateGatewayProvider', validateGatewayProviderTool);
registerTool('kyc.saveGatewayCredentials', saveGatewayCredentialsTool);

// Memory tools removed (dead code)

// Notification tools
registerTool('notifications.sendVerificationCode', sendVerificationCodeTool);
registerTool('notifications.sendGatewayIntroEmail', sendGatewayIntroEmailTool);
registerTool('notifications.sendDonorSupportEmail', sendDonorSupportEmailTool);

// Flow orchestration tools
registerTool('flow.handoff', flowHandoffTool);
registerTool('welcome.route', welcomeRouteTool);
registerTool('welcome.intentGate', welcomeIntentGateTool);
registerTool('signUp.transitionToLogin', signUpTransitionToLoginTool);
registerTool('login.transitionToSignUp', loginTransitionToSignUpTool);
registerTool('login.linkUserData', loginLinkUserDataTool);
registerTool('login.checkAccountContext', checkAccountContextTool);
registerTool('login.routeAfterLogin', loginRouteAfterLoginTool);
registerTool('login.autoFillIdentifier', loginAutoFillIdentifierTool);
registerTool('flow.reset-campaign-intent', resetCampaignIntentTool);
registerTool('flow.resetKeys', resetKeysTool);
registerTool('flow.detectCampaignManagementIntent', detectCampaignManagementIntentTool);
registerTool('flow.loadCampaignsContext', loadCampaignsContextTool);
registerTool('flow.resolveCampaignSelection', resolveCampaignSelectionTool);
registerTool('choco.getCampaignWithContent', getCampaignWithContentTool);

// Insurance tools (MVP)
registerTool('insurance.ensureCase', insuranceEnsureCaseTool);
registerTool('insurance.saveIntake', insuranceSaveIntakeTool);
registerTool('insurance.generatePdfs', insuranceGeneratePdfsTool);
