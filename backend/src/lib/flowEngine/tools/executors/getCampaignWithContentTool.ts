import { ToolExecutor } from '../types';
import { prisma } from '../../../../core/prisma';
import { flowHelpers } from '../../flowHelpers';
import { getProjectConfig } from '../../../../utils/getProjectConfig';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { logger } from '../../../../utils/logger';
import { asJsonObject, getString, isJsonObject, type JsonObject, type JsonValue } from '../../../../utils/json';
import { JsonValueSchema } from '../../../../utils/zodJson';

const isNumericId = (value: JsonValue): boolean => {
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
type GetCampaignWithContentInput = JsonObject;
type GetCampaignWithContentResult = JsonObject & {
  orgId: string;
  campaignId: string;
  contentBlocksCount: number;
  primaryContentId: string | null;
};

export const getCampaignWithContentTool: ToolExecutor<GetCampaignWithContentInput, GetCampaignWithContentResult> = async (payload, { conversationId }) => {
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
    const orgId = String(
      getString(userData, 'selected_org_id')
      || getString(userData, 'org_customer_id')
      || getString(userData, 'primary_org_id')
      || '',
    ).trim();
    if (!isNumericId(orgId)) {
      return { success: false, errorCode: 'ORG_ID_MISSING', error: 'Organization ID missing' };
    }

    const campaignId = String(
      getString(payload, 'campaign_id')
      || getString(payload, 'campaignId')
      || getString(userData, 'upcoming_campaign_id')
      || getString(userData, 'campaign_id')
      || '',
    ).trim();
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

    const jsonVal = await trackApiCall(
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
            return { errorCode: 'JWT_INVALID', error: 'Authorization failed' } satisfies JsonObject;
          }
          return { errorCode: 'CAMPAIGN_FETCH_FAILED', error: `HTTP ${res.status}` } satisfies JsonObject;
        }
        return JsonValueSchema.parse(await res.json());
      },
    );

    const jsonObj = asJsonObject(jsonVal as JsonValue) || {};
    const errCode = getString(jsonObj, 'errorCode') || '';
    if (errCode === 'JWT_INVALID') return { success: false, errorCode: 'JWT_INVALID', error: 'Authorization failed' };
    if (errCode === 'CAMPAIGN_FETCH_FAILED') return { success: false, errorCode: 'CAMPAIGN_FETCH_FAILED', error: 'Failed to fetch campaign' };

    const campaign = asJsonObject(jsonObj.data as JsonValue) || {};
    const includedVal = jsonObj.included;
    const included: JsonObject[] = Array.isArray(includedVal) ? (includedVal.filter(isJsonObject) as JsonObject[]) : [];
    const contentBlocks: ContentBlock[] = included
      .filter((x) => String(x.type || '').trim() === 'content' && isJsonObject(x.attributes))
      .map((x) => {
        const attrs = asJsonObject(x.attributes as JsonValue) || {};
        const id = String(x.id || '').trim();
        return ({
          id: id || String(attrs.id || '').trim(),
          language: getString(attrs, 'language') || undefined,
          tag: getString(attrs, 'tag') || undefined,
          title: getString(attrs, 'title') || undefined,
          content: getString(attrs, 'content') || undefined,
        });
      });

    // Prefer "default" tag (empty string) if available; otherwise first content block.
    const primary = contentBlocks.find((b) => String(b.tag ?? '').trim() === '') || contentBlocks[0];
    const storyHtml = primary?.content || '';

    await flowHelpers.setUserData(userId, flowId, {
      campaign_id: String(campaignId),
      campaign_title: getString(asJsonObject(campaign.attributes as JsonValue) || {}, 'title')
        || getString(userData, 'upcoming_campaign_title')
        || getString(userData, 'campaign_title')
        || '',
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
  } catch (error) {
    logger.error('[getCampaignWithContentTool] Error', error);
    return { success: false, error: error instanceof Error ? error.message : String(error || 'Failed to fetch campaign content') };
  }
};
