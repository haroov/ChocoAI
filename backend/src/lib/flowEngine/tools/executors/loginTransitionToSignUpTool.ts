import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { FlowDefinition } from '../../types';
import { ToolExecutor, ToolResult } from '../types';

/**
 * Login transition to signup tool - transitions user from login flow to signup flow
 * when they are not registered yet
 */
export const loginTransitionToSignUpTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    // Get conversation to find userId
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation || !conversation.userId) {
      return {
        success: false,
        error: 'Conversation or user not found',
      };
    }

    const { userId } = conversation;

    // Get current userFlow
    const currentUserFlow = await prisma.userFlow.findUnique({
      where: { userId },
    });

    if (!currentUserFlow) {
      return {
        success: false,
        error: 'No active flow found for user',
      };
    }

    // Find signup flow
    const signUpFlow = await prisma.flow.findUnique({
      where: { slug: 'sign-up' },
    });

    if (!signUpFlow) {
      return {
        success: false,
        error: 'Sign-up flow not found',
      };
    }

    // Get current flow's userData to preserve relevant fields
    const currentUserData = await flowHelpers.getUserData(userId, currentUserFlow.flowId);

    // CLEAR STALE DATA: Delete any existing data for the target sign-up flow
    // Also delete "role" from ALL flows to prevent inheritance of "user" role from previous sessions
    await prisma.userData.deleteMany({
      where: {
        userId,
        OR: [
          { flowId: signUpFlow.id },
          { key: 'role' },
        ],
      },
    });
    logger.info(`[loginTransitionToSignUpTool] Cleared stale data for flow ${signUpFlow.id} and purged global 'role'`);

    // Preserve relevant fields for signup
    const fieldsToPreserve: Record<string, unknown> = {};
    const fieldsToCopy = [
      'first_name',
      'last_name',
      'email',
      'phone',
      'login_identifier',
      // Telemetry: preserve why we offered signup from login
      'last_auth_error_code',
      'auth_handoff_reason',
    ];

    for (const fieldKey of fieldsToCopy) {
      if (fieldKey in currentUserData && currentUserData[fieldKey] !== undefined && currentUserData[fieldKey] !== null && currentUserData[fieldKey] !== '') {
        fieldsToPreserve[fieldKey] = currentUserData[fieldKey];
      }
    }

    // Check for confirm_signup field (from askToSignup stage)
    // If explicitly 'no' or negative intent, abort transition
    if (currentUserData.confirm_signup) {
      const confirm = String(currentUserData.confirm_signup).toLowerCase();
      const negativePattern = /^(no|false|nope|cancel|reject|wrong)/i;
      if (negativePattern.test(confirm)) {
        logger.info(`[loginTransitionToSignUpTool] User declined signup handoff (confirm_signup=${confirm})`);
        return {
          success: false,
          error: 'User declined to sign up',
          errorCode: 'USER_DECLINED',
        };
      }
    }

    // Explicitly set already_registered to false since we know they are not registered
    fieldsToPreserve.already_registered = 'false';

    // Note: We DO NOT set role or signup_status here.
    // We want them to be undefined so the flow forces their collection.
    // intent_confirmed is set to false to ensure the intent stage runs.
    fieldsToPreserve.intent_confirmed = 'false';

    // Save preserved fields to signup flow
    if (Object.keys(fieldsToPreserve).length > 0) {
      await flowHelpers.setUserData(userId, signUpFlow.id, fieldsToPreserve, conversationId);
      logger.info(`[loginTransitionToSignUpTool] Preserved ${Object.keys(fieldsToPreserve).length} fields during transition`, {
        preservedFields: Object.keys(fieldsToPreserve),
        fromFlowId: currentUserFlow.flowId,
        toFlowSlug: 'sign-up',
        userId,
      });
    }

    // Get signup flow's initial stage, or specific entry point for donors/cold start
    // We'll target the 'intent' stage but pre-filled data might skip parts of it if logic allows
    const signUpFlowDefinition = signUpFlow.definition as FlowDefinition;
    const signUpInitialStage = signUpFlowDefinition.config.initialStage;

    // Update userFlow to point to signup flow
    await prisma.userFlow.update({
      where: { id: currentUserFlow.id },
      data: {
        flowId: signUpFlow.id,
        stage: signUpInitialStage,
      },
    });

    logger.info(`[loginTransitionToSignUpTool] Successfully transitioned user ${userId} from login to sign-up`, {
      fromFlowId: currentUserFlow.flowId,
      toFlowSlug: 'sign-up',
      toStage: signUpInitialStage,
    });

    return {
      success: true,
      data: {
        targetFlowSlug: 'sign-up',
        targetStage: signUpInitialStage,
        preservedFields: Object.keys(fieldsToPreserve),
      },
    };
  } catch (error: any) {
    logger.error('[loginTransitionToSignUpTool] Error during transition:', error);
    return {
      success: false,
      error: error?.message || 'Failed to complete transition to sign-up',
    };
  }
};
