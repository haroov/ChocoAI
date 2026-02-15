import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { FlowDefinition } from '../../types';
import { ToolExecutor, ToolResult } from '../types';
import type { JsonObject, JsonValue } from '../../../../utils/json';

/**
 * Flow handoff tool executor
 *
 * Transitions from current flow to a target flow, optionally preserving specified fields.
 * This tool can be used programmatically within a flow stage action to trigger a handoff.
 *
 * @param payload - Must contain:
 *   - targetFlowSlug: string - Slug of the flow to transition to
 *   - preserveFields?: string[] - Optional array of field keys to copy to the new flow
 * @param context - Tool execution context with conversationId
 * @returns ToolResult indicating success or failure
 */
type FlowHandoffInput = {
  targetFlowSlug: string;
  preserveFields?: string[];
};

type FlowHandoffOutput = {
  targetFlowSlug: string;
  targetStage: string;
  preservedFields: string[];
};

export const flowHandoffTool: ToolExecutor<FlowHandoffInput, FlowHandoffOutput> = async (
  payload: { targetFlowSlug: string; preserveFields?: string[] },
  { conversationId },
): Promise<ToolResult<FlowHandoffOutput>> => {
  try {
    const { targetFlowSlug, preserveFields } = payload;

    if (!targetFlowSlug) {
      return {
        success: false,
        error: 'targetFlowSlug is required',
      };
    }

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

    // Get current flow's userData
    const currentUserData = await flowHelpers.getUserData(userId, currentUserFlow.flowId);

    // Preserve specified fields (or all fields if preserveFields is not specified)
    const fieldsToPreserve: JsonObject = {};
    if (preserveFields && preserveFields.length > 0) {
      // Preserve only specified fields
      for (const fieldKey of preserveFields) {
        if (fieldKey in currentUserData && currentUserData[fieldKey] !== undefined && currentUserData[fieldKey] !== null && currentUserData[fieldKey] !== '') {
          fieldsToPreserve[fieldKey] = currentUserData[fieldKey] as JsonValue;
        }
      }
    } else {
      // Preserve all fields if preserveFields is not specified
      Object.assign(fieldsToPreserve, currentUserData);
    }

    // Save preserved fields to target flow
    if (Object.keys(fieldsToPreserve).length > 0) {
      await flowHelpers.setUserData(userId, targetFlow.id, fieldsToPreserve, conversationId);
      logger.info(`[flowHandoffTool] Preserved ${Object.keys(fieldsToPreserve).length} fields during handoff`, {
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

    logger.info(`[flowHandoffTool] Successfully transitioned user ${userId} from flow ${currentUserFlow.flowId} to ${targetFlowSlug}`, {
      fromFlowId: currentUserFlow.flowId,
      toFlowSlug: targetFlowSlug,
      toStage: targetInitialStage,
      preservedFieldsCount: Object.keys(fieldsToPreserve).length,
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
    logger.error('[flowHandoffTool] Error during flow handoff:', error);
    return {
      success: false,
      error: error?.message || 'Failed to complete flow handoff',
    };
  }
};
