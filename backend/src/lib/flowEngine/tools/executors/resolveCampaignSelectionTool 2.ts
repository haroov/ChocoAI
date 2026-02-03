import { ToolExecutor } from '../types';
import { prisma } from '../../../../core/prisma';
import { flowHelpers } from '../../flowHelpers';
import { logger } from '../../../../utils/logger';

type CampaignSummary = {
  id: string | number;
  title?: string;
  currency?: string;
  start_date?: number;
  end_date?: number | null;
};

const normalizeForMatch = (s: string): string => (
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const tokenize = (s: string): string[] => {
  const normalized = normalizeForMatch(s);
  if (!normalized) return [];
  return normalized.split(' ').filter((t) => t.length >= 2);
};

export const resolveCampaignSelectionTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation?.userId) return { success: false, error: 'User not found in conversation' };
    const { userId } = conversation;

    const userFlow = await prisma.userFlow.findUnique({
      where: { userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';
    if (!flowId) return { success: false, error: 'No active flow found for user' };

    const userData = await flowHelpers.getUserData(userId, flowId);
    const campaignsRaw = String(userData.campaigns_json || '').trim();
    if (!campaignsRaw) return { success: false, error: 'No campaigns context found' };

    const choiceRaw = String((payload as any)?.campaign_choice || '').trim();
    if (!choiceRaw) return { success: false, error: 'No campaign choice provided' };

    let campaigns: CampaignSummary[] = [];
    try {
      const parsed = JSON.parse(campaignsRaw);
      campaigns = Array.isArray(parsed) ? parsed : [];
    } catch {
      campaigns = [];
    }
    if (!campaigns.length) return { success: false, error: 'No campaigns available to select' };

    // 1) Numeric index choice (1-based)
    const idx = Number(choiceRaw);
    if (Number.isFinite(idx) && idx >= 1 && idx <= campaigns.length) {
      const chosen = campaigns[idx - 1];
      await flowHelpers.setUserData(userId, flowId, {
        campaign_id: String(chosen.id),
        campaign_title: chosen.title || '',
      }, conversationId);
      return { success: true, data: { campaignId: chosen.id, matchedBy: 'index' } };
    }

    // 2) Name-based match (token subset)
    const choiceNorm = normalizeForMatch(choiceRaw);
    const choiceTokens = tokenize(choiceRaw);

    const match = campaigns.find((c) => {
      const title = String(c.title || '').trim();
      if (!title) return false;
      const titleNorm = normalizeForMatch(title);
      if (!titleNorm) return false;
      if (titleNorm === choiceNorm) return true;
      if (titleNorm.includes(choiceNorm) || choiceNorm.includes(titleNorm)) return true;

      const titleTokens = tokenize(title);
      if (choiceTokens.length >= 2 && titleTokens.length >= 2) {
        return choiceTokens.every((t) => titleTokens.includes(t));
      }
      return false;
    });

    if (!match) {
      logger.warn('[resolveCampaignSelectionTool] No match for campaign_choice', {
        conversationId,
        choice: choiceRaw,
        campaignsCount: campaigns.length,
      });
      return { success: false, error: 'Could not match campaign selection' };
    }

    await flowHelpers.setUserData(userId, flowId, {
      campaign_id: String(match.id),
      campaign_title: match.title || '',
    }, conversationId);

    return { success: true, data: { campaignId: match.id, matchedBy: 'name' } };
  } catch (error: any) {
    logger.error('[resolveCampaignSelectionTool] Error', error);
    return { success: false, error: error?.message || 'Failed to resolve campaign selection' };
  }
};
