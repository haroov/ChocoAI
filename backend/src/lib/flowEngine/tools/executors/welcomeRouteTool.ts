import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { FlowDefinition } from '../../types';
import { ToolExecutor, ToolResult } from '../types';

/**
 * Welcome route tool - routes user to choco-smb-1-ident (new quote) or login based on intent_type
 */
export const welcomeRouteTool: ToolExecutor = async (
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

    // Get current flow's userData to read intent_type
    const currentUserData = await flowHelpers.getUserData(userId, currentUserFlow.flowId);
    const intentType = currentUserData.intent_type as string;
    const alreadyRegistered = currentUserData.already_registered as boolean;

    // Determine target flow (safe default: quote -> choco-smb-1-ident)
    let targetFlowSlug: string;
    if (intentType === 'login' || alreadyRegistered === true) {
      targetFlowSlug = 'login';
    } else {
      // Default assumption: new quote -> Router
      // UPDATED: Start the modular flow chain at Flow 01
      targetFlowSlug = 'flow_01_welcome_user';
    }

    // Find target flow
    const targetFlow = await prisma.flow.findUnique({
      where: { slug: targetFlowSlug },
    });

    if (!targetFlow) {
      return {
        success: false,
        error: `Flow with slug "${targetFlowSlug}" not found`,
      };
    }

    // Preserve relevant fields (intent_type, product_line, already_registered, etc.)
    const fieldsToPreserve: Record<string, unknown> = {};
    const fieldsToCopy = [
      'intent_type',
      'product_line',
      'already_registered',
      'intent_confirmed',
      // Basic identity (so downstream flows can avoid re-asking)
      'first_name',
      'last_name',
      'phone',
      'email',
      // Segmentation / insured hints
      'segment_description',
      // Telemetry / debug: preserve why the confirmation question was/wasn't asked
      'intent_confidence',
      'needs_account_confirmation',
      'confirmation_asked',
      'welcome_intent_gate_reason',
    ];
    for (const fieldKey of fieldsToCopy) {
      if (fieldKey in currentUserData && currentUserData[fieldKey] !== undefined && currentUserData[fieldKey] !== null && currentUserData[fieldKey] !== '') {
        fieldsToPreserve[fieldKey] = currentUserData[fieldKey];
      }
    }

    // Map Welcome flow keys to chocoClalSmbTopicSplit keys
    if (currentUserData.first_name) fieldsToPreserve['proposer_first_name'] = currentUserData.first_name;
    if (currentUserData.last_name) fieldsToPreserve['proposer_last_name'] = currentUserData.last_name;
    if (currentUserData.email) {
      fieldsToPreserve['proposer_email'] = currentUserData.email;
      fieldsToPreserve['business_email'] = currentUserData.email; // Assume business email matches for now
    }
    if (currentUserData.phone) {
      fieldsToPreserve['proposer_mobile_phone'] = currentUserData.phone;
      fieldsToPreserve['business_phone'] = currentUserData.phone;
    }

    // Save preserved fields to target flow
    if (Object.keys(fieldsToPreserve).length > 0) {
      await flowHelpers.setUserData(userId, targetFlow.id, fieldsToPreserve, conversationId);
      logger.info(`[welcomeRouteTool] Preserved ${Object.keys(fieldsToPreserve).length} fields during routing`, {
        preservedFields: Object.keys(fieldsToPreserve),
        fromFlowId: currentUserFlow.flowId,
        toFlowSlug: targetFlowSlug,
        userId,
      });
    }

    // Get target flow's initial stage
    const targetFlowDefinition = targetFlow.definition as FlowDefinition;
    const targetInitialStage = targetFlowDefinition.config.initialStage;

    // Mark current stage as completed in flow history
    const currentFlow = await prisma.flow.findUnique({
      where: { id: currentUserFlow.flowId },
    });

    if (currentFlow) {
      await prisma.flowHistory.create({
        data: {
          userId,
          flowId: currentUserFlow.flowId,
          stage: currentUserFlow.stage,
          sessionId: currentUserFlow.id,
        },
      });
    }

    // Update userFlow to point to target flow
    // Update userFlow to point to target flow
    // We create a NEW UserFlow record (new session ID) to separate the flows in history
    await prisma.$transaction([
      prisma.userFlow.delete({
        where: { id: currentUserFlow.id },
      }),
      prisma.userFlow.create({
        data: {
          userId,
          flowId: targetFlow.id,
          stage: targetInitialStage,
        },
      }),
    ]);

    logger.info(`[welcomeRouteTool] Successfully routed user ${userId} from welcome to ${targetFlowSlug}`, {
      fromFlowId: currentUserFlow.flowId,
      toFlowSlug: targetFlowSlug,
      toStage: targetInitialStage,
      intentType,
    });

    return {
      success: true,
      data: {
        targetFlowSlug,
        targetStage: targetInitialStage,
        preservedFields: Object.keys(fieldsToPreserve),
      },
    };
  } catch (error: any) {
    logger.error('[welcomeRouteTool] Error during routing:', error);
    return {
      success: false,
      error: error?.message || 'Failed to complete routing',
    };
  }
};
