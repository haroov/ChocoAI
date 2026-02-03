import { ToolExecutor } from '../types';
import { logger } from '../../../../utils/logger';
import { prisma } from '../../../../core/prisma';

/**
 * Resets the campaign management intent field to allow the loop to continue.
 * Hardcoded to clear 'cm_user_intent'.
 */
export const resetCampaignIntentTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const fieldsToClear = ['cm_user_intent'];

    // Get conversation to find userId
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || !conversation.userId) {
      return { success: false, error: 'User not found in conversation' };
    }

    // Get active user flow
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
    });

    if (!userFlow) {
      return { success: false, error: 'Active flow not found' };
    }

    const updates: Record<string, any> = {};
    fieldsToClear.forEach((field) => {
      updates[field] = null; // Setting to null clears it
    });

    // We can use prisma directly to update, similar to flowHelpers.setUserData but simpler
    // Or just rely on the tool result to update userData via flowRouter?
    // flowRouter saves tool results. BUT it merges them.
    // If I return { cm_user_intent: null }, will it clear it?
    // flowRouter: Object.assign(userData, res.saveResults);
    // And flowHelpers.setUserData skips nulls!

    // So I MUST update DB directly here to ensure it is cleared.
    // But flowHelpers.setUserData implementation:
    // if (rawValue === null ... ) continue;

    // So I must delete the row or update value to empty string?
    // "value: fieldStringValue" where fieldStringValue = String(null) -> "null".

    // Best way: Delete the UserData entry.

    await prisma.userData.deleteMany({
      where: {
        userId: conversation.userId,
        flowId: userFlow.flowId,
        key: { in: fieldsToClear },
      },
    });

    logger.info('[resetCampaignIntentTool] Cleared intent field', {
      conversationId,
      userId: conversation.userId,
    });

    return {
      success: true,
      data: {
        cleared: fieldsToClear,
      },
    };
  } catch (error: any) {
    logger.error('[resetCampaignIntentTool] Error clearing context:', error);
    return {
      success: false,
      error: error.message || 'Failed to clear context',
    };
  }
};
