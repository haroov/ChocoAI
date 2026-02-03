import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';

/**
 * Login auto-fill identifier tool - automatically extracts login_identifier from email or phone
 * if they already exist in userData (e.g., when transitioning from signUp flow)
 */
export const loginAutoFillIdentifierTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const { prisma } = await import('../../../../core/prisma');

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
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId },
    });

    if (!userFlow) {
      return {
        success: false,
        error: 'No active flow found for user',
      };
    }

    // Get userData to check for email or phone
    const userData = await flowHelpers.getUserData(userId, userFlow.flowId);

    const email = userData.email as string | undefined;
    const phone = userData.phone as string | undefined;
    const existingLoginIdentifier = userData.login_identifier as string | undefined;

    // If login_identifier already exists, nothing to do
    if (existingLoginIdentifier) {
      return {
        success: true,
        data: { login_identifier: existingLoginIdentifier },
      };
    }

    // Prefer phone over email, but use either if available
    const loginIdentifier = phone || email;

    if (!loginIdentifier) {
      // No email or phone available - user needs to provide it
      return {
        success: true,
        data: { login_identifier: null },
      };
    }

    // Save login_identifier to userData
    await flowHelpers.setUserData(userId, userFlow.flowId, {
      login_identifier: loginIdentifier,
    }, conversationId);

    return {
      success: true,
      data: { login_identifier: loginIdentifier },
      saveResults: {
        login_identifier: loginIdentifier,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to auto-fill login identifier',
    };
  }
};
