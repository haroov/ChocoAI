import { prisma } from '../../../../core';
import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';

function isTruthyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function inferProductLine(userData: Record<string, unknown>): 'business_package' | 'cyber' | 'med_pi' {
  // Default: Clal SMB business package (includes optional cyber annex via gating later).
  // We only pick something else on strong signals already captured in userData.
  const segment = String(userData.segment_description || userData.industry || userData.activity_description || '').toLowerCase();

  // Very conservative heuristics (avoid misrouting professionals like עורכי דין to para-medical).
  if (/(סייבר|cyber)/i.test(segment)) return 'cyber';
  if (/(פרא|פרה|מטפל|טיפול|קליניקה|physio|פיזיו|ריפוי|שיקום|דיאטנ|קלינאית|פסיכולוג)/i.test(segment)) return 'med_pi';

  return 'business_package';
}

/**
 * insurance.setDefaultProductLine
 * Ensures product_line has a reasonable default without asking the user.
 * This prevents confusing "choose product" questions mid-conversation.
 */
export const insuranceSetDefaultProductLineTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!convo?.userId) {
      return { success: false, error: 'Conversation or user not found', errorCode: 'CONVERSATION_NOT_FOUND' };
    }

    const userFlow = await prisma.userFlow.findUnique({ where: { userId: convo.userId } });
    if (!userFlow?.flowId) {
      return { success: false, error: 'No active flow', errorCode: 'NO_ACTIVE_FLOW' };
    }

    const current = payload.product_line;
    if (isTruthyString(current)) {
      return { success: true, data: { product_line: String(current) } };
    }

    const inferred = inferProductLine(payload);
    const saveResults: Record<string, unknown> = {
      product_line: inferred,
      product_line_source: 'default_inferred',
    };

    await flowHelpers.setUserData(convo.userId, userFlow.flowId, saveResults, conversationId);
    return { success: true, data: { product_line: inferred }, saveResults };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to set default product line' };
  }
};
