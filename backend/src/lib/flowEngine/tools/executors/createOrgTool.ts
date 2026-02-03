import { ToolExecutor } from '../types';
import { prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig } from '../../../../utils/getProjectConfig';
import { flowHelpers } from '../../flowHelpers';

/**
 * Creates a new organization in Choco
 *
 * Required fields: name, full_name, phone
 * Optional fields: website, timezone, lang
 */
export const createOrgTool: ToolExecutor = async (payload, { conversationId }) => {
  const { logger } = await import('../../../../utils/logger');
  logger.info(`[createOrgTool] Starting organization creation for conversation ${conversationId}`, { payload });

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
        error: 'JWT token not found. Please complete login first.',
      };
    }

    // Validate required fields
    const name = (payload.name as string)?.trim();
    const fullName = (payload.full_name as string)?.trim();
    const phone = (payload.phone as string)?.trim();
    // The API supports creating an organization with empty "about" (we may not have it yet during onboarding).
    const about = (payload.about as string)?.trim() || '';

    if (!name) {
      return {
        success: false,
        error: 'Organization name is required',
      };
    }

    if (!fullName) {
      return {
        success: false,
        error: 'Organization full name is required',
      };
    }

    if (!phone) {
      return {
        success: false,
        error: 'Organization phone is required',
      };
    }

    // Get optional fields
    const website = (payload.website as string)?.trim() || '';
    const timezone = (payload.timezone as string)?.trim() || 'UTC';
    const lang = (payload.lang as string)?.trim() || 'en';

    const projectConfig = await getProjectConfig();
    const endpoint = projectConfig.backendMode === 'choco'
      ? `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v2/organizations/additional`
      : 'mock:create-org';

    const requestPayload = {
      name,
      full_name: fullName,
      phone,
      about,
      ...(website && { website }),
      timezone,
      lang,
    };

    const requestInfo = {
      payload: requestPayload,
      meta: {
        method: 'POST',
        endpoint,
        providerMode: projectConfig.backendMode,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      },
    };

    return trackApiCall(
      conversationId,
      projectConfig.backendMode === 'choco' ? 'ChocoAPI' : 'Mock',
      'create-org',
      requestInfo,
      async () => {
        if (projectConfig.backendMode === 'mock') {
          // Mock response
          return {
            success: true,
            data: {
              status: 'success',
              code: 200,
              message: `Organization '${name}' created successfully`,
              data: {
                id: Math.floor(Math.random() * 100000),
                name,
                full_name: fullName,
                email: user.email || '',
                phone,
                website: website || '',
                about,
                timezone,
                lang,
                logo: '',
                created_at: new Date().toISOString(),
              },
            },
            status: 200,
          };
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
          body: JSON.stringify(requestPayload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          return {
            success: false,
            error: errorData.error || errorData.message || `HTTP ${response.status}`,
            status: response.status,
          };
        }

        const data = await response.json();

        // Save organization data to userData
        if (data.data?.id) {
          const orgId = String(data.data.id);
          await flowHelpers.setUserData(user.id, flowId, {
            org_id: orgId,
            org_customer_id: orgId, // Also save as org_customer_id for consistency
            org_name: data.data.name || name,
            org_full_name: data.data.full_name || fullName,
            org_phone: data.data.phone || phone,
            org_website: data.data.website || website,
            org_about: data.data.about || about,
            org_timezone: data.data.timezone || timezone,
            org_lang: data.data.lang || lang,
            org_primary: data.data.primary ? 'true' : 'false',
          }, conversationId);

          logger.info('[createOrgTool] Successfully created organization and saved to userData', {
            orgId,
            orgName: data.data.name,
          });
        }

        return {
          success: true,
          data,
          status: response.status,
        };
      },
    );
  } catch (error: any) {
    const { logger } = await import('../../../../utils/logger');
    logger.error('[createOrgTool] Error creating organization:', error);
    return {
      success: false,
      error: error?.message || 'Failed to create organization',
    };
  }
};
