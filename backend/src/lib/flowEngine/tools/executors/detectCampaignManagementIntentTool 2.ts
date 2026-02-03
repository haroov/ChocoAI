import { ToolExecutor } from '../types';
import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';

/**
 * Deterministic intent detector for Campaign Management dashboard.
 * This avoids the LLM occasionally misclassifying obvious requests (e.g. "אני רוצה להקים קמפיין")
 * as "general_inquiry", which causes out-of-context responses.
 */
export const detectCampaignManagementIntentTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const lastUserMessage = await prisma.message.findFirst({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });

    const text = String(lastUserMessage?.content || '').trim();
    const lower = text.toLowerCase();

    const hasAny = (patterns: RegExp[]) => patterns.some((p) => p.test(text) || p.test(lower));

    const wantsCampaign = hasAny([
      /קמפיין/,
      /הקמ(ה|ים).*קמפיין/,
      /\bcampaign\b/i,
      /\bfundrais/i,
    ]);
    const wantsEntity = hasAny([
      /ישות/,
      /ישות משפטית/,
      /\bentity\b/i,
      /\blegal entity\b/i,
    ]);
    const wantsGateway = hasAny([
      /סליק/i,
      /ספק סליקה/,
      /משולם/,
      /grow/i,
      /meshulam/i,
      /stripe/i,
      /\bgateway\b/i,
    ]);

    // "What's next?" type messages should default into campaign work (not a generic dashboard menu)
    const wantsCampaignByDefault = hasAny([
      /מה\s*הלאה/,
      /מה\s*עכשיו/,
      /אז\s*מה\s*הלאה/,
      /קדימה/,
      /בוא\s*נתחיל/,
      /let'?s\s*go/i,
      /what'?s\s*next/i,
    ]);

    let intent: 'manage_entity' | 'manage_campaign' | 'setup_gateway' | 'general_inquiry' = 'general_inquiry';
    if (wantsCampaign || wantsCampaignByDefault) intent = 'manage_campaign';
    else if (wantsEntity) intent = 'manage_entity';
    else if (wantsGateway) intent = 'setup_gateway';

    // Only override if the current extracted intent is missing/weak.
    const current = String((payload as any)?.cm_user_intent || '').trim();
    const shouldOverride = !current || current === 'general_inquiry';

    if (!shouldOverride) {
      return { success: true, data: { intent: current, overridden: false } };
    }

    logger.info('[detectCampaignManagementIntentTool] Overriding cm_user_intent', {
      conversationId,
      from: current || '(empty)',
      to: intent,
      lastUserMessage: text.slice(0, 180),
    });

    return {
      success: true,
      data: { intent, overridden: true },
      saveResults: {
        cm_user_intent: intent,
      },
    };
  } catch (error: any) {
    logger.error('[detectCampaignManagementIntentTool] Failed to detect intent', error);
    return { success: true, data: { intent: (payload as any)?.cm_user_intent || 'general_inquiry', overridden: false } };
  }
};
