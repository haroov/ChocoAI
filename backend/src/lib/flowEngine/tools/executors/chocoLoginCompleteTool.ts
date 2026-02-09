import { ToolExecutor } from '../types';
import { prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig } from '../../../../utils/getProjectConfig';
import { flowHelpers } from '../../flowHelpers';

/**
 * Bundled login service that completes the full login flow after OTP verification.
 *
 * This tool should be called after `verifyCodeTool` successfully verifies the login OTP.
 * It performs the following steps:
 * 1. Call signin endpoint to get account details
 * 2. Get organizations
 * 3. Get currencies (store in global memory)
 * 4. Get org settings for each organization
 * 5. Get donor account info
 * 6. Get campaigns for each organization
 * 7. Get countries (store in global memory - single point of truth)
 * 8. Get entities for each organization
 * 9. Get gateways for each organization
 */
export const chocoLoginCompleteTool: ToolExecutor = async (payload, { conversationId }) => {
  const { logger } = await import('../../../../utils/logger');
  logger.info(`[chocoLoginCompleteTool] Starting complete login flow for conversation ${conversationId}`);

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

    // Get jwt_token from userData (should have been saved by verifyCodeTool)
    const jwtToken = await flowHelpers.getJwtToken(user.id, flowId);
    if (!jwtToken) {
      return {
        success: false,
        error: 'JWT token not found. Please complete login verification first.',
      };
    }

    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;

    if (projectConfig.backendMode === 'mock') {
      // Mock response
      return {
        success: true,
        data: {
          signin: { email: 'mock@example.com', phone: '+972501234567' },
          organizations: [],
          currencies: [],
          countries: [],
        },
      };
    }

    const results: Record<string, any> = {};

    // Step 1: Call signin endpoint
    logger.info('[chocoLoginCompleteTool] Step 1: Calling signin endpoint');
    const signinResponse = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'signin',
      {
        payload: {},
        meta: {
          method: 'GET',
          endpoint: `${baseUrl}/orgarea/api/v1/signin`,
          providerMode: 'choco',
          headers: {
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        const response = await fetch(`${baseUrl}/orgarea/api/v1/signin`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return await response.json();
      },
    );

    if (!signinResponse || signinResponse.error) {
      return {
        success: false,
        error: signinResponse?.error || 'Failed to call signin endpoint',
      };
    }

    results.signin = signinResponse.data?.attributes || signinResponse.data;

    // Save user profile data from signin
    const signinData = signinResponse.data?.attributes || signinResponse.data;
    if (signinData) {
      await flowHelpers.setUserData(user.id, flowId, {
        user_email: signinData.email || '',
        user_phone: signinData.phone || '',
        user_settings: JSON.stringify(signinData.settings || {}),
        user_twofa_active: signinData.twofa_active ? 'true' : 'false',
      }, conversationId);

      logger.info('[chocoLoginCompleteTool] Saved user profile data from signin');
    }

    // Step 2: Get organizations
    logger.info('[chocoLoginCompleteTool] Step 2: Getting organizations');
    const orgsResponse = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'get-organizations',
      {
        payload: {},
        meta: {
          method: 'GET',
          endpoint: `${baseUrl}/orgarea/api/v1/organizations`,
          providerMode: 'choco',
          headers: {
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        const response = await fetch(`${baseUrl}/orgarea/api/v1/organizations`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return await response.json();
      },
    );

    const organizations = orgsResponse?.data || [];
    results.organizations = organizations;

    // Save organizations data to userData for flow use
    if (organizations.length > 0) {
      const primaryOrg = organizations.find((org: any) => org.attributes?.primary === true) || organizations[0];
      const primaryOrgId = primaryOrg.id;

      // Save primary org ID
      await flowHelpers.setUserData(user.id, flowId, {
        primary_org_id: String(primaryOrgId),
        org_customer_id: String(primaryOrgId), // Backward compat field used by some flows
      }, conversationId);

      // Save organizations array as JSON (for org selection in flows)
      await flowHelpers.setUserData(user.id, flowId, {
        organizations_json: JSON.stringify(organizations.map((org: any) => ({
          id: org.id,
          name: org.attributes?.name || org.name,
          full_name: org.attributes?.full_name || org.full_name,
          primary: org.attributes?.primary || org.primary,
        }))),
      }, conversationId);

      logger.info('[chocoLoginCompleteTool] Saved organizations data to userData', {
        count: organizations.length,
        primaryOrgId,
      });
    }

    // Step 3: Get currencies and store in global memory (single point of truth)
    logger.info('[chocoLoginCompleteTool] Step 3: Getting currencies');
    const currenciesResponse = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'get-currencies',
      {
        payload: {},
        meta: {
          method: 'GET',
          endpoint: `${baseUrl}/orgarea/api/v1/account/currencies`,
          providerMode: 'choco',
          headers: {
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        const response = await fetch(`${baseUrl}/orgarea/api/v1/account/currencies`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return await response.json();
      },
    );

    const currencies = currenciesResponse?.data || [];
    results.currencies = currencies;

    // Store currencies in global memory (UPSERT - single point of truth)
    const existingCurrencies = await prisma.memory.findFirst({
      where: {
        scope: 'global',
        tenantId: null,
        userId: null,
        sessionId: null,
        key: 'choco_currencies',
      },
    });

    if (existingCurrencies) {
      await prisma.memory.update({
        where: { id: existingCurrencies.id },
        data: { value: currencies as any },
      });
    } else {
      await prisma.memory.create({
        data: {
          scope: 'global',
          tenantId: null,
          userId: null,
          sessionId: null,
          key: 'choco_currencies',
          value: currencies as any,
        },
      });
    }

    // Step 4: Get org settings for each organization
    logger.info('[chocoLoginCompleteTool] Step 4: Getting org settings');
    const orgSettings: Record<string, any> = {};
    for (const org of organizations) {
      const orgId = org.id;
      try {
        const settingsResponse = await trackApiCall(
          conversationId,
          'ChocoAPI',
          'get-org-settings',
          {
            payload: { organizationId: orgId },
            meta: {
              method: 'GET',
              endpoint: `${baseUrl}/orgarea/api/v1/organization/${orgId}/org_setting`,
              providerMode: 'choco',
              headers: {
                Authorization: `Bearer ${jwtToken}`,
              },
            },
          },
          async () => {
            const response = await fetch(`${baseUrl}/orgarea/api/v1/organization/${orgId}/org_setting`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwtToken}`,
              },
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({})) as any;
              throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
          },
        );

        orgSettings[orgId] = settingsResponse || [];
      } catch (error: any) {
        logger.warn(`[chocoLoginCompleteTool] Failed to get settings for org ${orgId}:`, error.message);
        orgSettings[orgId] = [];
      }
    }
    results.orgSettings = orgSettings;

    // Step 5: Get donor account info
    logger.info('[chocoLoginCompleteTool] Step 5: Getting donor account');
    const donorResponse = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'get-donor-account',
      {
        payload: {},
        meta: {
          method: 'GET',
          endpoint: `${baseUrl}/orgarea/api/v1/account/donor_account?extend=settings`,
          providerMode: 'choco',
          headers: {
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        const response = await fetch(`${baseUrl}/orgarea/api/v1/account/donor_account?extend=settings`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return await response.json();
      },
    );

    results.donorAccount = donorResponse?.data || null;

    // Save donor account data if available
    if (donorResponse?.data?.id) {
      const donorData = donorResponse.data;
      await flowHelpers.setUserData(user.id, flowId, {
        donor_account_id: String(donorData.id),
        donor_email: donorData.attributes?.email || '',
        donor_phone: donorData.attributes?.phone || '',
        donor_first_name: donorData.attributes?.first_name || '',
        donor_last_name: donorData.attributes?.last_name || '',
        donor_display_name: donorData.attributes?.display_name || '',
        donor_my_referral_link: donorData.attributes?.my_referral_link || '',
      }, conversationId);

      logger.info('[chocoLoginCompleteTool] Saved donor account data to userData');
    }

    // Step 6: Get campaigns for each organization
    logger.info('[chocoLoginCompleteTool] Step 6: Getting campaigns');
    const campaigns: Record<string, any[]> = {};
    for (const org of organizations) {
      const orgId = org.id;
      try {
        const campaignsResponse = await trackApiCall(
          conversationId,
          'ChocoAPI',
          'get-campaigns',
          {
            payload: { organizationId: orgId },
            meta: {
              method: 'GET',
              endpoint: `${baseUrl}/orgarea/api/v1/organization/${orgId}/campaigns`,
              providerMode: 'choco',
              headers: {
                Authorization: `Bearer ${jwtToken}`,
              },
            },
          },
          async () => {
            const response = await fetch(`${baseUrl}/orgarea/api/v1/organization/${orgId}/campaigns`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwtToken}`,
              },
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({})) as any;
              throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
          },
        );

        campaigns[orgId] = campaignsResponse?.data || [];
      } catch (error: any) {
        logger.warn(`[chocoLoginCompleteTool] Failed to get campaigns for org ${orgId}:`, error.message);
        campaigns[orgId] = [];
      }
    }
    results.campaigns = campaigns;

    // Save campaigns data to userData (per organization)
    for (const [orgId, campaignList] of Object.entries(campaigns)) {
      if (Array.isArray(campaignList) && campaignList.length > 0) {
        await flowHelpers.setUserData(user.id, flowId, {
          [`campaigns_org_${orgId}`]: JSON.stringify(campaignList.map((campaign: any) => ({
            id: campaign.id,
            title: campaign.attributes?.title || campaign.title,
            currency: campaign.attributes?.currency || campaign.currency,
            primary_goal: campaign.attributes?.primary_goal || campaign.primary_goal,
            start_date: campaign.attributes?.start_date || campaign.start_date,
            end_date: campaign.attributes?.end_date || campaign.end_date,
          }))),
        }, conversationId);
      }
    }

    if (Object.keys(campaigns).length > 0) {
      logger.info('[chocoLoginCompleteTool] Saved campaigns data to userData');
    }

    // Step 7: Get countries and store in global memory (single point of truth)
    logger.info('[chocoLoginCompleteTool] Step 7: Getting countries');
    const countriesResponse = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'get-countries',
      {
        payload: {},
        meta: {
          method: 'GET',
          endpoint: `${baseUrl}/orgarea/api/v1/account/countries`,
          providerMode: 'choco',
          headers: {
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        const response = await fetch(`${baseUrl}/orgarea/api/v1/account/countries`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return await response.json();
      },
    );

    const countries = countriesResponse?.data || [];
    results.countries = countries;

    // Store countries in global memory (UPSERT - single point of truth)
    const existingCountries = await prisma.memory.findFirst({
      where: {
        scope: 'global',
        tenantId: null,
        userId: null,
        sessionId: null,
        key: 'choco_countries',
      },
    });

    if (existingCountries) {
      await prisma.memory.update({
        where: { id: existingCountries.id },
        data: { value: countries as any },
      });
    } else {
      await prisma.memory.create({
        data: {
          scope: 'global',
          tenantId: null,
          userId: null,
          sessionId: null,
          key: 'choco_countries',
          value: countries as any,
        },
      });
    }

    // Step 8: Get entities for each organization
    logger.info('[chocoLoginCompleteTool] Step 8: Getting entities');
    const entities: Record<string, any[]> = {};
    for (const org of organizations) {
      const orgId = org.id;
      try {
        const entitiesResponse = await trackApiCall(
          conversationId,
          'ChocoAPI',
          'get-entities',
          {
            payload: { organizationId: orgId },
            meta: {
              method: 'GET',
              endpoint: `${baseUrl}/orgarea/api/v1/organization/${orgId}/account/entities`,
              providerMode: 'choco',
              headers: {
                Authorization: `Bearer ${jwtToken}`,
              },
            },
          },
          async () => {
            const response = await fetch(`${baseUrl}/orgarea/api/v1/organization/${orgId}/account/entities`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwtToken}`,
              },
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({})) as any;
              throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
          },
        );

        // Handle response format: { data: [...] } where data is an array
        const entitiesArray = Array.isArray(entitiesResponse?.data)
          ? entitiesResponse.data
          : (entitiesResponse?.data ? [entitiesResponse.data] : []);

        entities[orgId] = entitiesArray;
      } catch (error: any) {
        logger.warn(`[chocoLoginCompleteTool] Failed to get entities for org ${orgId}:`, error.message);
        entities[orgId] = [];
      }
    }
    results.entities = entities;

    // Save entities data to userData (per organization)
    for (const [orgId, entityList] of Object.entries(entities)) {
      if (Array.isArray(entityList) && entityList.length > 0) {
        await flowHelpers.setUserData(user.id, flowId, {
          [`entities_org_${orgId}`]: JSON.stringify(entityList.map((entity: any) => ({
            id: entity.id,
            name: entity.attributes?.name || entity.name,
            tax_id: entity.attributes?.tax_id || entity.tax_id,
            primary: entity.attributes?.primary || entity.primary,
            type: entity.attributes?.type || entity.type,
          }))),
        }, conversationId);
      }
    }

    if (Object.keys(entities).length > 0) {
      logger.info('[chocoLoginCompleteTool] Saved entities data to userData');
    }

    // Step 9: Get gateways for each organization
    logger.info('[chocoLoginCompleteTool] Step 9: Getting gateways');
    const gateways: Record<string, any[]> = {};
    for (const org of organizations) {
      const orgId = org.id;
      try {
        const gatewaysResponse = await trackApiCall(
          conversationId,
          'ChocoAPI',
          'get-gateways',
          {
            payload: { organizationId: orgId },
            meta: {
              method: 'GET',
              endpoint: `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateways`,
              providerMode: 'choco',
              headers: {
                Authorization: `Bearer ${jwtToken}`,
              },
            },
          },
          async () => {
            const response = await fetch(`${baseUrl}/orgarea/api/v1/organization/${orgId}/gateways`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwtToken}`,
              },
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({})) as any;
              throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
          },
        );

        gateways[orgId] = gatewaysResponse?.data || [];
      } catch (error: any) {
        logger.warn(`[chocoLoginCompleteTool] Failed to get gateways for org ${orgId}:`, error.message);
        gateways[orgId] = [];
      }
    }
    results.gateways = gateways;

    // Save gateways data to userData (per organization)
    for (const [orgId, gatewayList] of Object.entries(gateways)) {
      if (Array.isArray(gatewayList) && gatewayList.length > 0) {
        await flowHelpers.setUserData(user.id, flowId, {
          [`gateways_org_${orgId}`]: JSON.stringify(gatewayList.map((gateway: any) => ({
            id: gateway.id,
            type: gateway.attributes?.type || gateway.type,
            status: gateway.attributes?.status || gateway.status,
            currency: gateway.attributes?.currency || gateway.currency,
          }))),
        }, conversationId);
      }
    }

    if (Object.keys(gateways).length > 0) {
      logger.info('[chocoLoginCompleteTool] Saved gateways data to userData');
    }

    logger.info('[chocoLoginCompleteTool] Successfully completed all login steps');

    return {
      success: true,
      data: results,
    };
  } catch (error: any) {
    logger.error('[chocoLoginCompleteTool] Error in login flow:', error);
    return {
      success: false,
      error: error?.message || 'Failed to complete login flow',
    };
  }
};
