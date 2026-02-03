import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { FlowDefinition } from '../../types';
import { ToolExecutor, ToolResult } from '../types';

/**
 * SignUp transition to login tool - transitions user from signUp flow to login flow
 * when they are already registered
 */
export const signUpTransitionToLoginTool: ToolExecutor = async (
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

    // Find login flow
    const loginFlow = await prisma.flow.findUnique({
      where: { slug: 'login' },
    });

    if (!loginFlow) {
      return {
        success: false,
        error: 'Login flow not found',
      };
    }

    // Get current flow's userData to preserve relevant fields
    const currentUserData = await flowHelpers.getUserData(userId, currentUserFlow.flowId);

    // Preserve relevant fields for login
    const fieldsToPreserve: Record<string, unknown> = {};
    const fieldsToCopy = ['first_name', 'last_name', 'email', 'phone', 'organization_name', 'regNum', 'already_registered', 'role'];
    for (const fieldKey of fieldsToCopy) {
      if (fieldKey in currentUserData && currentUserData[fieldKey] !== undefined && currentUserData[fieldKey] !== null && currentUserData[fieldKey] !== '') {
        fieldsToPreserve[fieldKey] = currentUserData[fieldKey];
      }
    }

    // Save preserved fields to login flow
    if (Object.keys(fieldsToPreserve).length > 0) {
      await flowHelpers.setUserData(userId, loginFlow.id, fieldsToPreserve, conversationId);
      logger.info(`[signUpTransitionToLoginTool] Preserved ${Object.keys(fieldsToPreserve).length} fields during transition`, {
        preservedFields: Object.keys(fieldsToPreserve),
        fromFlowId: currentUserFlow.flowId,
        toFlowSlug: 'login',
        userId,
      });
    }

    // Get login flow's initial stage
    const loginFlowDefinition = loginFlow.definition as FlowDefinition;
    const loginInitialStage = loginFlowDefinition.config.initialStage;

    // Mark ALL completed stages of signUp flow in flow history
    // This ensures the signUp flow appears in completedFlows after transition
    const currentFlow = await prisma.flow.findUnique({
      where: { id: currentUserFlow.flowId },
    });

    if (currentFlow) {
      const flowDefinition = currentFlow.definition as FlowDefinition;

      // Create FlowHistory entries for all stages that have been completed (have data collected)
      // This ensures the entire signUp flow history is preserved
      for (const [stageSlug, stage] of Object.entries(flowDefinition.stages)) {
        // Check if this stage has been completed (all fields collected)
        const stageFieldsCollected = stage.fieldsToCollect.every((fieldSlug) =>
          fieldSlug in currentUserData &&
          currentUserData[fieldSlug] !== undefined &&
          currentUserData[fieldSlug] !== null &&
          currentUserData[fieldSlug] !== '',
        );

        // Also check if stage has no fields (like route stage) - consider it completed if we've moved past it
        const isCompleted = stageFieldsCollected || stage.fieldsToCollect.length === 0;

        if (isCompleted) {
          // Check if FlowHistory entry already exists
          const existing = await prisma.flowHistory.findFirst({
            where: {
              userId,
              flowId: currentUserFlow.flowId,
              stage: stageSlug,
              sessionId: currentUserFlow.id,
            },
          });

          if (!existing) {
            await prisma.flowHistory.create({
              data: {
                userId,
                flowId: currentUserFlow.flowId,
                stage: stageSlug,
                sessionId: currentUserFlow.id,
              },
            });
          }
        }
      }
    }

    // Update userFlow to point to login flow
    await prisma.userFlow.update({
      where: { id: currentUserFlow.id },
      data: {
        flowId: loginFlow.id,
        stage: loginInitialStage,
      },
    });

    logger.info(`[signUpTransitionToLoginTool] Successfully transitioned user ${userId} from signUp to login`, {
      fromFlowId: currentUserFlow.flowId,
      toFlowSlug: 'login',
      toStage: loginInitialStage,
    });

    return {
      success: true,
      data: {
        targetFlowSlug: 'login',
        targetStage: loginInitialStage,
        preservedFields: Object.keys(fieldsToPreserve),
      },
    };
  } catch (error: any) {
    logger.error('[signUpTransitionToLoginTool] Error during transition:', error);
    return {
      success: false,
      error: error?.message || 'Failed to complete transition to login',
    };
  }
};
