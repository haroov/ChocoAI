import { ToolExecutor } from '../types';
import { logger } from '../../../../utils/logger';
import { prisma } from '../../../../core/prisma';
import { flowHelpers } from '../../flowHelpers';

const parseKeys = (raw: unknown): string[] => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((k) => String(k || '').trim())
      .filter(Boolean);
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    // JSON array string
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .map((k) => String(k || '').trim())
            .filter(Boolean);
        }
      } catch {
        // Fall through to CSV parsing
      }
    }

    // CSV
    return trimmed
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  return [];
};

/**
 * Deletes selected userData keys for the current user's active flow.
 * Useful for recovery flows (re-select org/entity, retry lookups, etc).
 *
 * Accepts keys from:
 * - payload.keys (array or csv/json string)
 * - payload.reset_keys / payload.recovery_reset_keys
 */
export const resetKeysTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found in conversation' };
    }

    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });

    if (!userFlow?.flowId) {
      return { success: false, error: 'Active flow not found' };
    }

    const keys = parseKeys(
      (payload as any).keys
      || (payload as any).reset_keys
      || (payload as any).recovery_reset_keys,
    );

    if (!keys.length) {
      return { success: true, data: { cleared: [] } };
    }

    await prisma.userData.deleteMany({
      where: {
        userId: conversation.userId,
        flowId: userFlow.flowId,
        key: { in: keys },
      },
    });

    // Also clear from in-memory userData for this proceed cycle
    const saveResults: Record<string, string> = {};
    for (const k of keys) saveResults[k] = '';

    // Clear common recovery helper keys if present
    saveResults.recovery_reset_keys = '';
    saveResults.recovery_reason = '';

    await flowHelpers.setUserData(conversation.userId, userFlow.flowId, saveResults, conversationId);

    logger.info('[resetKeysTool] Cleared userData keys', { conversationId, userId: conversation.userId, keys });

    return {
      success: true,
      data: { cleared: keys },
      saveResults,
    };
  } catch (error: any) {
    logger.error('[resetKeysTool] Error clearing keys', error);
    return {
      success: false,
      error: error?.message || 'Failed to clear keys',
    };
  }
};
