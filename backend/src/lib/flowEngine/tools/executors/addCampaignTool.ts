import { ToolExecutor } from '../types';
import { prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig } from '../../../../utils/getProjectConfig';
import { flowHelpers } from '../../flowHelpers';
import { getChocoAuthToken } from '../helpers/getChocoAuthToken';

/**
 * Creates a new campaign for an organization and then extends it with full data
 *
 * Required fields: currency, start_date, primary_goal, org_id
 * Optional fields: end_date, title, bonus_goal
 */
export const addCampaignTool: ToolExecutor = async (payload, { conversationId }) => {
  const { logger } = await import('../../../../utils/logger');
  logger.info(`[addCampaignTool] Starting campaign creation for conversation ${conversationId}`, { payload });

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });
    if (!conversation) throw new Error('Conversation not found');
    if (!conversation.userId) throw new Error('User not found in conversation');

    const { user } = conversation;
    if (!user) throw new Error('User not found');

    // Get flowId from userFlow
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: user.id },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get jwt_token from userData (required for authenticated requests)
    const jwtToken = await flowHelpers.getJwtToken(user.id, flowId);
    if (!jwtToken) {
      return {
        success: false,
        errorCode: 'JWT_MISSING',
        error: 'JWT token not found. Please complete login first.',
      };
    }

    // Get organization ID from payload or userData
    const userData = await flowHelpers.getUserData(user.id, flowId);
    const orgId = (payload.org_id as string)
      || (payload.org_customer_id as string)
      || (userData.org_id as string)
      || (userData.org_customer_id as string);

    if (!orgId) {
      return {
        success: false,
        error: 'Organization ID is required. Please create or select an organization first.',
      };
    }

    // Get action (create, update, delete) - default to create
    const action = ((payload.action as string)
      || (payload.campaign_action as string)
      || (userData.campaign_action as string)
      || 'create')?.toLowerCase();
    const validActions = ['create', 'update', 'delete'];
    if (!validActions.includes(action)) {
      return { success: false, error: `Invalid action '${action}'. Must be one of: ${validActions.join(', ')}` };
    }

    const campaignId = (payload.campaign_id as string)
      || (payload.id as string)
      || (userData.campaign_id as string);
    if ((action === 'update' || action === 'delete') && !campaignId) {
      return { success: false, error: `Campaign ID is required for action '${action}'` };
    }

    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;

    if (projectConfig.backendMode === 'mock') {
      // ... (simplified mock return)
      return { success: true, data: { mock: true, action }, status: 200 };
    }

    // Prepare variables
    let currency, startDate, primaryGoal, endDate, title, bonusGoal;

    // Step 1: Execute Action (Create/Update/Delete)
    let apiPayload: any = {};
    let endpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/campaigns`; // Base create endpoint

    if (action !== 'delete') {
      // Accept both tool-style fields (currency/start_date/...) and flow-style fields (campaign_currency/campaign_start_date/...)
      currency = ((payload.currency as string) || (payload.campaign_currency as string) || (userData.campaign_currency as string))?.trim()?.toUpperCase();
      startDate = (payload.start_date as number)
        ?? (payload.campaign_start_date as number)
        ?? (userData.campaign_start_date as unknown as number);
      primaryGoal = (payload.primary_goal as number)
        ?? (payload.campaign_primary_goal as number)
        ?? (userData.campaign_primary_goal as unknown as number);
      endDate = (payload.end_date as number)
        ?? (payload.campaign_end_date as number)
        ?? (userData.campaign_end_date as unknown as number)
        ?? null;
      title = ((payload.title as string) || (payload.campaign_title as string) || (userData.campaign_title as string) || '').trim();
      bonusGoal = (payload.bonus_goal as number)
        ?? (payload.campaign_bonus_goal as number)
        ?? (userData.campaign_bonus_goal as unknown as number)
        ?? 0;

      // Validation only for create
      if (action === 'create') {
        if (!currency) return { success: false, error: 'Campaign currency is required' };
        if (!startDate || typeof startDate !== 'number') return { success: false, error: 'Campaign start_date required' };
        if (!primaryGoal || typeof primaryGoal !== 'number' || primaryGoal <= 0) return { success: false, error: 'Campaign primary_goal required' };
      }

      apiPayload = {
        data: {
          // ID required for update? API usually creates new one on POST to collection.
          // For Update, usually PUT/PATCH to specific resource.
          // Assuming standard REST for update: .../campaigns/{id} or .../campaign/{id}
          // addCampaignTool previously used .../organization/{orgId}/campaigns for CREATE.
          // extendCampaign used .../organization/{orgId}/campaign/{campaignId} for GET.
          // Likely UPDATE/DELETE is also on .../campaign/{campaignId}.
          type: 'campaign',
          id: campaignId || undefined,
          attributes: {
            currency: currency ? currency.toLowerCase() : undefined,
            start_date: startDate,
            end_date: endDate,
            title,
            primary_goal: primaryGoal,
            bonus_goal: bonusGoal > 0 ? bonusGoal : undefined,
          },
        },
      };

      // Clean undefined
      Object.keys(apiPayload.data.attributes).forEach((key) =>
        apiPayload.data.attributes[key] === undefined && delete apiPayload.data.attributes[key],
      );
    }

    // Determine correct endpoint for method
    if (action === 'update' || action === 'delete') {
      endpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/campaign/${campaignId}`;
    }

    logger.info(`[addCampaignTool] Executing ${action} on campaign`, { endpoint, orgId });

    const response = await trackApiCall(
      conversationId,
      'CharidyAPI',
      `campaign-${action}`,
      {
        payload: apiPayload,
        meta: {
          method: action === 'delete' ? 'DELETE' : (action === 'update' ? 'PUT' : 'POST'),
          endpoint,
          providerMode: 'choco',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        let res;
        if (action === 'delete') {
          res = await fetch(endpoint, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
          });
        } else if (action === 'update') {
          res = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
            body: JSON.stringify(apiPayload),
          });
        } else {
          // Create uses POST to /campaigns
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
            body: JSON.stringify(apiPayload),
          });
        }

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({})) as any;
          throw new Error(errorData.error || errorData.message || `HTTP ${res.status}`);
        }

        return await res.json();
      },
    );

    if (!response || response.error) {
      return { success: false, error: response?.error || 'Failed to process campaign action' };
    }

    // Step 2: Validation / Extension
    // For CREATE, we do what we did before (extend).
    // For UPDATE, we should also validate (GET).
    // For DELETE, success is enough.

    const resultingCampaignId = campaignId || response.data?.id || response.data?.data?.id;

    if (action !== 'delete' && resultingCampaignId) {
      logger.info('[addCampaignTool] Validating/Extending campaign data', { resultingCampaignId });
      const extendEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/campaign/${resultingCampaignId}?extend=campaign_stats&extend=content&extend=media&extend=meta&extend=matchers&extend=donation_levels&extend=donation_streams&extend=campaign_roles&extend=url_alias`;

      const extendResponse = await trackApiCall(
        conversationId, 'CharidyAPI', 'validate-campaign',
        { payload: {}, meta: { method: 'GET', endpoint: extendEndpoint } },
        async () => {
          const r = await fetch(extendEndpoint, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
          });
          if (!r.ok) throw new Error(`Validation failed: ${r.status}`);
          return await r.json();
        },
      );

      if (extendResponse && !extendResponse.error) {
        // Save to user data
        const campaignData = extendResponse.data || response.data;
        // ... (keeping existing logic to save to userData)
        if (campaignData?.id) {
          await flowHelpers.setUserData(user.id, flowId, {
            campaign_id: String(campaignData.id),
            campaign_title: campaignData.attributes?.title || title,
            campaign_currency: campaignData.attributes?.currency || currency?.toLowerCase(),
            campaign_start_date: campaignData.attributes?.start_date || startDate,
            campaign_end_date: campaignData.attributes?.end_date || endDate,
            campaign_primary_goal: campaignData.attributes?.primary_goal || primaryGoal,
            campaign_bonus_goal: campaignData.attributes?.bonus_goal || bonusGoal,
            campaign_short_link: campaignData.attributes?.short_link || '',
            campaign_status: campaignData.attributes?.status || 'active',
            campaign_url: campaignData.attributes?.url || campaignData.attributes?.short_link || '',
          }, conversationId);
        }

        return {
          success: true,
          data: {
            campaign: response,
            extended: extendResponse,
            validated: true,
          },
        };
      }
    }

    return {
      success: true,
      data: {
        campaign: response,
        status: 'success',
      },
    };
  } catch (error: any) {
    const { logger } = await import('../../../../utils/logger');
    logger.error('[addCampaignTool] Error creating campaign:', error);
    return {
      success: false,
      error: error?.message || 'Failed to create campaign',
    };
  }
};
