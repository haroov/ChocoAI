import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';

/**
 * Login link user data tool - links and merges user data from the API with local user record.
 * This should be called after `choco.login-complete` has fetched all data.
 */
export const loginLinkUserDataTool: ToolExecutor = async (
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
    const { user } = conversation;

    if (!user) {
      return {
        success: false,
        error: 'User not found',
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

    // Get userData from login flow (should have JWT token and all fetched data)
    const loginUserData = await flowHelpers.getUserData(userId, currentUserFlow.flowId);

    // Check if JWT token exists (required for linking)
    const jwtToken = loginUserData.jwt_token;
    if (!jwtToken) {
      logger.warn('[loginLinkUserDataTool] No JWT token found - login may not be complete');
      // Still proceed, but log warning
    }

    // Update User model with data from API (if available)
    const updateData: Record<string, unknown> = {};

    // Update email if available from signin data
    if (loginUserData.user_email) {
      updateData.email = loginUserData.user_email;
    } else if (loginUserData.email) {
      updateData.email = loginUserData.email;
    }

    // Mark as registered since we have JWT token
    updateData.registered = true;

    // Update user record
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
      logger.info(`[loginLinkUserDataTool] Updated user record for ${userId}`, {
        updatedFields: Object.keys(updateData),
      });
    }

    // All user data is already saved to userData by `choco.login-complete`
    // We just need to ensure it's linked properly
    logger.info(`[loginLinkUserDataTool] Successfully linked user data for ${userId}`, {
      hasJwtToken: !!jwtToken,
      userId,
    });

    return {
      success: true,
      data: {
        userId,
        linked: true,
        hasJwtToken: !!jwtToken,
      },
    };
  } catch (error: any) {
    logger.error('[loginLinkUserDataTool] Error linking user data:', error);
    return {
      success: false,
      error: error?.message || 'Failed to link user data',
    };
  }
};
