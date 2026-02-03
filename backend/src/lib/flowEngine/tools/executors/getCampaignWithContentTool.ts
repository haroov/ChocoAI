import { ToolExecutor } from '../types';
import { prisma } from '../../../../core/prisma';
import { flowHelpers } from '../../flowHelpers';
import { getProjectConfig } from '../../../../utils/getProjectConfig';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { logger } from '../../../../utils/logger';

const isNumericId = (value: unknown): boolean => {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s);
};

type ContentBlock = {
  id: string | number;
  language?: string;
  tag?: string;
  title?: string;
  content?: string;
};

/**
 * Fetch a campaign with extend=content and save primary story HTML to userData.
 *
 * Endpoint (per API docs):
 * GET /orgarea/api/v1/organization/{orgId}/campaign/{campaignId}?extend=content
 */
export const getCampaignWithContentTool: ToolExecutor = async (payload, { conversationId }) => {
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
    if (!flowId) return { success: false, error: 'No active flow found for user' };

    const userData = await flowHelpers.getUserData(userId, flowId);
    const orgIdCandidate = userData.selected_org_id || userData.org_customer_id || userData.primary_org_id;
    const orgId = String(orgIdCandidate || '').trim();
    if (!isNumericId(orgId)) {
      return { success: false, errorCode: 'ORG_ID_MISSING', error: 'Organization ID missing' };
    }

    const campaignIdCandidate =
      (payload as any)?.campaign_id ||
      (payload as any)?.campaignId ||
      userData.upcoming_campaign_id ||
      userData.campaign_id;
    const campaignId = String(campaignIdCandidate || '').trim();
    if (!isNumericId(campaignId)) {
      return { success: false, errorCode: 'CAMPAIGN_ID_MISSING', error: 'Campaign ID missing' };
    }

    const jwtToken = await flowHelpers.getJwtToken(userId, flowId);
    if (!jwtToken) {
      return { success: false, errorCode: 'JWT_MISSING', error: 'JWT token missing' };
    }

    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;
    const endpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/campaign/${campaignId}?extend=content`;

    const json = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'get-campaign-with-content',
      { payload: { orgId, campaignId }, meta: { method: 'GET', endpoint } },
      async () => {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          logger.warn('[getCampaignWithContentTool] Failed to fetch campaign content', {
            conversationId,
            orgId,
            campaignId,
            status: res.status,
            body: body.slice(0, 300),
          });
          if (res.status === 401 || res.status === 403) {
            return { errorCode: 'JWT_INVALID', error: 'Authorization failed' } as any;
          }
          return { errorCode: 'CAMPAIGN_FETCH_FAILED', error: `HTTP ${res.status}` } as any;
        }
        return await res.json();
      },
    );

    if ((json as any)?.errorCode === 'JWT_INVALID') return { success: false, errorCode: 'JWT_INVALID', error: 'Authorization failed' };
    if ((json as any)?.errorCode === 'CAMPAIGN_FETCH_FAILED') return { success: false, errorCode: 'CAMPAIGN_FETCH_FAILED', error: 'Failed to fetch campaign' };

    const campaign = (json as any)?.data;
    const included = Array.isArray((json as any)?.included) ? (json as any).included : [];
    const contentBlocks: ContentBlock[] = included
      .filter((x: any) => x?.type === 'content' && x?.attributes)
      .map((x: any) => ({
        id: x.id,
        language: x.attributes?.language,
        tag: x.attributes?.tag,
        title: x.attributes?.title,
        content: x.attributes?.content,
      }));

    // Prefer "default" tag (empty string) if available; otherwise first content block.
    const primary = contentBlocks.find((b) => String(b.tag ?? '').trim() === '') || contentBlocks[0];
    const storyHtml = primary?.content || '';

    await flowHelpers.setUserData(userId, flowId, {
      campaign_id: String(campaignId),
      campaign_title: campaign?.attributes?.title || userData.upcoming_campaign_title || userData.campaign_title || '',
      campaign_story_html: storyHtml,
      campaign_content_blocks_json: JSON.stringify(contentBlocks),
      campaign_primary_content_id: primary ? String(primary.id) : '',
      campaign_primary_content_language: primary?.language || '',
    }, conversationId);

    return {
      success: true,
      data: {
        orgId,
        campaignId,
        contentBlocksCount: contentBlocks.length,
        primaryContentId: primary ? String(primary.id) : null,
      },
      saveResults: {
        campaign_story_html: storyHtml,
      },
    };
  } catch (error: any) {
    logger.error('[getCampaignWithContentTool] Error', error);
    return { success: false, error: error?.message || 'Failed to fetch campaign content' };
  }
};
