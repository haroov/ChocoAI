import { ToolExecutor } from '../types';
import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { getProjectConfig } from '../../../../utils/getProjectConfig';

type CampaignSummary = {
  id: string | number;
  title?: string;
  currency?: string;
  start_date?: number;
  end_date?: number | null;
};

type CampaignStatus = 'scheduled' | 'active' | 'ended' | 'unknown';

const isNumericId = (value: unknown): boolean => {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s);
};

const computeCampaignStatus = (c: CampaignSummary): CampaignStatus => {
  const now = Math.floor(Date.now() / 1000);
  const start = typeof c.start_date === 'number' ? c.start_date : Number(c.start_date);
  const end = c.end_date == null ? null : Number(c.end_date);

  if (Number.isFinite(start) && now < start) return 'scheduled';
  if (end != null && Number.isFinite(end) && now > end) return 'ended';
  if (Number.isFinite(start) || end == null) return 'active';
  return 'unknown';
};

const formatCampaignsList = (campaigns: CampaignSummary[]): string => {
  if (!campaigns.length) return '';
  return campaigns
    .map((c, idx) => {
      const title = (c.title || '').trim() || 'Campaign';
      const { id } = c;
      const status = computeCampaignStatus(c);
      // IMPORTANT: Do NOT show internal IDs to end users.
      // Users should choose by number or name; we resolve to campaign_id internally.
      void id;
      return `${idx + 1}. ${title} — ${status}`;
    })
    .join('\n');
};

const inferHasActiveCampaigns = (campaigns: CampaignSummary[]): boolean => {
  const now = Math.floor(Date.now() / 1000);
  return campaigns.some((c) => {
    if (c.end_date == null) return true;
    const end = Number(c.end_date);
    return Number.isFinite(end) && end > now;
  });
};

/**
 * Loads campaign context for the selected organization so campaignManagement can make
 * the right UX choice (auto-create when there are no campaigns).
 *
 * Strategy:
 * - Use cached `campaigns_org_{orgId}` if exists (from login complete tool)
 * - Otherwise fetch `GET /orgarea/api/v1/organization/{orgId}/campaigns` using jwt_token
 */
export const loadCampaignsContextTool: ToolExecutor = async (_payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation?.userId) return { success: false, error: 'User not found' };
    const { userId } = conversation;

    const userFlow = await prisma.userFlow.findUnique({
      where: { userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    const userData = await flowHelpers.getUserData(userId, flowId);
    const orgIdCandidate = userData.selected_org_id || userData.org_customer_id || userData.primary_org_id;
    const orgId = String(orgIdCandidate || '').trim();
    if (!isNumericId(orgId)) {
      return { success: false, errorCode: 'ORG_ID_MISSING', error: 'Organization ID missing' };
    }

    const key = `campaigns_org_${orgId}`;

    // Try cached campaigns from any flowId (login flow stores them)
    const cachedRow = await prisma.userData.findFirst({
      where: { userId, key },
      select: { value: true },
    });

    let campaigns: CampaignSummary[] = [];
    if (cachedRow?.value) {
      try {
        const parsed = JSON.parse(cachedRow.value);
        campaigns = Array.isArray(parsed) ? parsed : [];
      } catch {
        // fall back to live fetch
      }
    }

    if (!campaigns.length) {
      const jwtToken = await flowHelpers.getJwtToken(userId, flowId);
      if (!jwtToken) {
        return { success: false, errorCode: 'JWT_MISSING', error: 'JWT token missing' };
      }

      const projectConfig = await getProjectConfig();
      const baseUrl = projectConfig.chocoDashboardBaseUrl;
      const endpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/campaigns`;

      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        logger.warn('[loadCampaignsContextTool] Failed to fetch campaigns', {
          conversationId,
          orgId,
          status: res.status,
          body: txt.slice(0, 300),
        });
        if (res.status === 401 || res.status === 403) {
          return { success: false, errorCode: 'JWT_INVALID', error: 'Authorization failed' };
        }
        return { success: false, errorCode: 'CAMPAIGNS_FETCH_FAILED', error: 'Failed to load campaigns' };
      }

      const json = await res.json().catch(() => ({} as any));
      campaigns = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
    }

    // Normalize common formats into a simple list
    const normalized: CampaignSummary[] = campaigns.map((c: any) => {
      if (c?.attributes) {
        return {
          id: c.id,
          title: c.attributes.title,
          currency: c.attributes.currency,
          start_date: c.attributes.start_date,
          end_date: c.attributes.end_date ?? null,
        };
      }
      return {
        id: c.id,
        title: c.title,
        currency: c.currency,
        start_date: c.start_date,
        end_date: c.end_date ?? null,
      };
    });

    const hasAny = normalized.length > 0;
    const hasActive = inferHasActiveCampaigns(normalized);

    const saveResults = {
      campaigns_json: JSON.stringify(normalized),
      campaigns_list: formatCampaignsList(normalized),
      has_campaigns: hasAny,
      has_active_campaigns: hasActive,
      // UX helper: if no campaigns at all, default to create.
      campaign_action: hasAny ? '' : 'create',
    };

    return {
      success: true,
      data: {
        orgId,
        count: normalized.length,
        hasAny,
        hasActive,
      },
      saveResults,
    };
  } catch (error: any) {
    logger.error('[loadCampaignsContextTool] Error', error);
    return { success: false, error: error?.message || 'Failed to load campaigns' };
  }
};
