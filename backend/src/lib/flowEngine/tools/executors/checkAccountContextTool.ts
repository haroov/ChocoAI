import { ToolExecutor } from '../types';
import { prisma } from '../../../../core';
import { flowHelpers } from '../../flowHelpers';
import { getProjectConfig } from '../../../../utils/getProjectConfig';
import { logger } from '../../../../utils/logger';
import { httpService } from '../../../services/httpService';
import { createOrgTool } from './createOrgTool';
import { asJsonObject, getString, isJsonObject, type JsonObject, type JsonValue } from '../../../../utils/json';
import { JsonValueSchema } from '../../../../utils/zodJson';

type CheckAccountContextInput = JsonObject;

type OrgContext = {
  id: string;
  name: string;
  entities: JsonObject[];
  gateways: JsonObject[];
  hasActiveGateway: boolean;
  hasVerifiedGateway: boolean;
  hasEntities: boolean;
  hasGateways: boolean;
};

type AccountContext = {
  organizations: OrgContext[];
  hasActiveGateway: boolean;
  hasActiveVerifiedGateway: boolean;
  hasAnyEntities: boolean;
  hasAnyGateways: boolean;
  hasCampaignReadyOrg: boolean;
  nextFlow: 'kyc' | 'campaignManagement';
};

type CheckAccountContextResult = {
  accountContext: AccountContext;
  nextFlow: AccountContext['nextFlow'];
};

export const checkAccountContextTool: ToolExecutor<CheckAccountContextInput, CheckAccountContextResult> = async (_payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    const { userId } = conversation;

    // Get flowId for userData access
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get current userData
    const userData = await flowHelpers.getUserData(userId, flowId);

    // 1. Get Organizations
    let organizations: JsonObject[] = [];
    let organizationsJsonUsable = false;
    if (userData.organizations_json) {
      try {
        const parsedVal = JsonValueSchema.parse(JSON.parse(String(userData.organizations_json)));
        organizations = Array.isArray(parsedVal) ? (parsedVal.filter(isJsonObject) as JsonObject[]) : [];
        organizationsJsonUsable = Array.isArray(parsedVal);
      } catch (e) {
        logger.warn('[checkAccountContextTool] Failed to parse organizations_json', e);
      }
    }

    // 2. Prepare for API calls
    const { getChocoAuthToken } = await import('../helpers/getChocoAuthToken');
    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;

    // New signups may enter KYC without organizations cached in userData.
    // Fetch organizations from the API and persist so later tools have org IDs.
    // We do this whenever organizations_json isn't present/usable (even if org_customer_id exists),
    // because other stages rely on having canonical org name + id.
    if (!organizationsJsonUsable || organizations.length === 0) {
      const organizationsEndpoint = `${baseUrl}/orgarea/api/v1/organizations`;
      const jwtToken = await flowHelpers.getJwtToken(userId, flowId);
      const resetToken = await flowHelpers.getResetToken(userId, flowId);
      const captchaToken = await getChocoAuthToken(userId, flowId, false);

      const normalizeBearerToken = (t: string) => t.trim().replace(/^Bearer\s+/i, '').trim();
      const jwtSegmentsCount = (t: string) => normalizeBearerToken(t).split('.').filter(Boolean).length;

      // NOTE: /organizations expects a JWT (3 segments). A reset_token is often NOT a JWT (UUID),
      // and will fail with "token contains an invalid number of segments".
      const candidates: Array<{ source: 'jwt_token' | 'captchaToken' | 'reset_token'; token: string | null }> = [
        { source: 'jwt_token', token: jwtToken },
        { source: 'captchaToken', token: captchaToken },
        { source: 'reset_token', token: resetToken },
      ];

      const candidateTokens = candidates
        .map(({ source, token }) => ({
          source,
          raw: (typeof token === 'string' ? token : '').trim(),
        }))
        .filter((t) => t.raw.length > 0)
        .map((t) => ({ ...t, normalized: normalizeBearerToken(t.raw) }))
        .filter((t) => {
          const segments = jwtSegmentsCount(t.normalized);
          if (segments !== 3) {
            logger.warn('[checkAccountContextTool] Skipping non-JWT token for /organizations', {
              conversationId,
              source: t.source,
              segments,
              length: t.normalized.length,
              prefix: t.normalized.slice(0, 12),
            });
            return false;
          }
          return true;
        });

      for (const t of candidateTokens) {
        try {
          logger.info('[checkAccountContextTool] Trying /organizations token', {
            conversationId,
            source: t.source,
            segments: jwtSegmentsCount(t.normalized),
            length: t.normalized.length,
            prefix: t.normalized.slice(0, 12),
          });

          const response = await httpService.get(organizationsEndpoint, {
            headers: {
              Authorization: `Bearer ${t.normalized}`,
              'Content-Type': 'application/json',
            },
            conversationId,
            operationName: 'Fetch Organizations',
            providerName: 'ChocoAPI',
          });

          if (!response.ok) {
            logger.warn('[checkAccountContextTool] /organizations returned non-OK', {
              conversationId,
              source: t.source,
              status: response.status,
              statusText: response.statusText,
            });
            continue;
          }

          const dataVal = JsonValueSchema.parse(await response.json().catch(() => ({})));
          const dataObj = asJsonObject(dataVal) || {};
          const orgsVal = dataObj.data;
          const orgs = Array.isArray(orgsVal) ? (orgsVal.filter(isJsonObject) as JsonObject[]) : (Array.isArray(dataVal) ? (dataVal.filter(isJsonObject) as JsonObject[]) : []);
          if (orgs.length === 0) {
            // If the token is valid but the user has no orgs yet, we'll create one below.
            organizations = [];
            break;
          }

          organizations = orgs;

          // Persist organizations and primary org id for later calls.
          const primaryOrg = orgs.find((org) => (asJsonObject(org.attributes as JsonValue) || {}).primary === true) || orgs[0];
          const primaryOrgId = String(primaryOrg?.id || '').trim();
          await flowHelpers.setUserData(userId, flowId, {
            org_customer_id: primaryOrgId ? primaryOrgId : null,
            primary_org_id: primaryOrgId ? primaryOrgId : null,
            organizations_json: JSON.stringify(orgs.map((org) => {
              const attrs = asJsonObject(org.attributes as JsonValue) || {};
              return ({
                id: String(org.id || '').trim(),
                attributes: {
                  name: getString(attrs, 'name') || getString(org, 'name') || '',
                  primary: attrs.primary === true,
                },
                name: getString(attrs, 'name') || getString(org, 'name') || '',
              });
            })),
          }, conversationId);

          logger.info('[checkAccountContextTool] Loaded organizations from API', {
            count: orgs.length,
            primaryOrgId: primaryOrgId ? String(primaryOrgId) : null,
          });

          break;
        } catch (e) {
          // Try next token
        }
      }
    }

    // If the API returns an empty org list, create an org from collected/enriched onboarding data.
    // This is needed for brand-new nonprofit accounts so KYC can proceed with a valid orgId.
    if (organizations.length === 0) {
      try {
        const mergedUserData = await flowHelpers.getUserData(userId, flowId);
        const orgNameCandidate = (mergedUserData.organization_name as string)
          || (mergedUserData.single_org_name as string)
          || (mergedUserData.entity_name as string)
          || 'My Organization';
        const fullNameCandidate = [
          (mergedUserData.first_name as string) || '',
          (mergedUserData.last_name as string) || '',
        ].filter(Boolean).join(' ').trim()
          || (conversation.user?.firstName ? [conversation.user.firstName, conversation.user.lastName].filter(Boolean).join(' ') : 'Choco User');
        const phoneCandidate = (mergedUserData.phone as string)
          || (mergedUserData.user_phone as string)
          || (mergedUserData.org_phone as string)
          || (mergedUserData.raw_phone as string)
          || (mergedUserData.contact_phone as string)
          || '';
        const timezoneCandidate = (mergedUserData.timezone as string)
          || (mergedUserData.org_timezone as string)
          || 'UTC';
        const langCandidate = (mergedUserData.lang as string)
          || (mergedUserData.org_lang as string)
          || 'en';

        if (phoneCandidate) {
          logger.warn('[checkAccountContextTool] No organizations found; creating a new organization', {
            conversationId,
            orgName: orgNameCandidate,
          });

          const createRes = await createOrgTool({
            name: orgNameCandidate,
            full_name: fullNameCandidate,
            phone: phoneCandidate,
            website: (mergedUserData.org_website as string) || (mergedUserData.website as string) || '',
            about: (mergedUserData.org_about as string) || '',
            timezone: timezoneCandidate,
            lang: langCandidate,
          }, { conversationId });

          if (!createRes.success) {
            logger.warn('[checkAccountContextTool] Failed to auto-create organization', {
              conversationId,
              error: createRes.error,
            });
          } else {
            // After creating, try to fetch organizations again using the newly saved jwt_token.
            const organizationsEndpoint = `${baseUrl}/orgarea/api/v1/organizations`;
            const jwtAfterCreate = await flowHelpers.getJwtToken(userId, flowId);
            if (jwtAfterCreate) {
              const response = await httpService.get(organizationsEndpoint, {
                headers: {
                  Authorization: `Bearer ${jwtAfterCreate}`,
                  'Content-Type': 'application/json',
                },
                conversationId,
                operationName: 'Fetch Organizations (after create)',
                providerName: 'ChocoAPI',
              });
              if (response.ok) {
                const dataVal = JsonValueSchema.parse(await response.json().catch(() => ({})));
                const dataObj = asJsonObject(dataVal) || {};
                const orgsVal = dataObj.data;
                const orgs = Array.isArray(orgsVal) ? (orgsVal.filter(isJsonObject) as JsonObject[]) : (Array.isArray(dataVal) ? (dataVal.filter(isJsonObject) as JsonObject[]) : []);
                organizations = orgs;
              }
            }
          }
        } else {
          logger.warn('[checkAccountContextTool] No organizations found and cannot create org (missing phone)', {
            conversationId,
          });
        }
      } catch (e) {
        logger.warn('[checkAccountContextTool] Auto-create organization flow failed', {
          conversationId,
        });
      }
    }

    // Fallback: Check if single org context exists (e.g. from signup)
    if (organizations.length === 0 && userData.org_customer_id) {
      organizations = [({
        id: String(userData.org_customer_id || '').trim(),
        attributes: {
          name: getString(userData, 'organization_name') || 'My Organization',
          primary: true,
        },
      }) satisfies JsonObject];
    }

    // Persist commonly-used primary org context for KYC prompts/tools.
    if (organizations.length > 0) {
      const primaryOrg = organizations.find((org) => (asJsonObject(org.attributes as JsonValue) || {}).primary === true) || organizations[0];
      const primaryOrgId = String(primaryOrg?.id || '').trim();
      const primaryOrgName = getString(asJsonObject(primaryOrg?.attributes as JsonValue) || {}, 'name') || getString(primaryOrg || {}, 'name');

      await flowHelpers.setUserData(userId, flowId, {
        // Keep existing org_customer_id if already set; otherwise use the primary org we found.
        org_customer_id: userData.org_customer_id ? String(userData.org_customer_id) : (primaryOrgId ? primaryOrgId : null),
        primary_org_id: primaryOrgId ? primaryOrgId : null,
        single_org_id: primaryOrgId ? primaryOrgId : null,
        single_org_name: primaryOrgName ? String(primaryOrgName) : null,
      }, conversationId);
    }

    const authToken = await getChocoAuthToken(userId, flowId, true);

    const accountContext: AccountContext = {
      organizations: [],
      // C1 routing signal: active gateway (do NOT require verified)
      hasActiveGateway: false,
      hasActiveVerifiedGateway: false,
      hasAnyEntities: false,
      hasAnyGateways: false,
      hasCampaignReadyOrg: false,
      nextFlow: 'kyc', // Default
    };

    // 3. Iterate Orgs and fetch details
    for (const org of organizations) {
      const orgId = String(org.id || org);
      const orgAttrs = asJsonObject(org.attributes as JsonValue) || {};
      const orgName = getString(orgAttrs, 'name') || getString(org, 'name') || 'Unknown Org';

      const orgContext: OrgContext = {
        id: orgId,
        name: orgName,
        entities: [],
        gateways: [],
        hasActiveGateway: false,
        hasVerifiedGateway: false,
        hasEntities: false,
        hasGateways: false,
      };

      if (authToken) {
        // Fetch Entities
        try {
          const entitiesEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/account/entities`;

          const entitiesResponse = await httpService.get(entitiesEndpoint, {
            headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            conversationId,
            operationName: 'Fetch Org Entities',
            providerName: 'ChocoAPI',
          });

          if (entitiesResponse.ok) {
            const dataVal = JsonValueSchema.parse(await entitiesResponse.json().catch(() => ({})));
            const dataObj = asJsonObject(dataVal) || {};
            const listVal = dataObj.data;
            orgContext.entities = Array.isArray(listVal) ? (listVal.filter(isJsonObject) as JsonObject[]) : (isJsonObject(listVal) ? [listVal] : []);
            orgContext.hasEntities = orgContext.entities.length > 0;
            if (orgContext.hasEntities) accountContext.hasAnyEntities = true;
          }
        } catch (e) {
          logger.warn(`[checkAccountContextTool] Failed to fetch entities for org ${orgId}`, e);
        }

        // Fetch Gateways
        try {
          const gatewaysEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateways`;
          const gatewaysResponse = await httpService.get(gatewaysEndpoint, {
            headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            conversationId,
            operationName: 'Fetch Org Gateways',
            providerName: 'ChocoAPI',
          });

          if (gatewaysResponse.ok) {
            const dataVal = JsonValueSchema.parse(await gatewaysResponse.json().catch(() => ({})));
            const dataObj = asJsonObject(dataVal) || {};
            const listVal = dataObj.data;
            orgContext.gateways = Array.isArray(listVal) ? (listVal.filter(isJsonObject) as JsonObject[]) : (isJsonObject(listVal) ? [listVal] : []);
            orgContext.hasGateways = orgContext.gateways.length > 0;
            if (orgContext.hasGateways) accountContext.hasAnyGateways = true;
          }
        } catch (e) {
          logger.warn(`[checkAccountContextTool] Failed to fetch gateways for org ${orgId}`, e);
        }
      }

      const isGatewayActive = (g: JsonObject): boolean => {
        const attrs = asJsonObject(g.attributes as JsonValue) || g;
        if (attrs.active === true) return true;
        if (typeof attrs.status === 'string' && attrs.status.toLowerCase() === 'active') return true;
        return false;
      };

      const isGatewayVerified = (g: JsonObject): boolean => {
        const attrs = asJsonObject(g.attributes as JsonValue) || g;
        return attrs.verified === true;
      };

      const hasActiveGateway = orgContext.gateways.some((g) => isGatewayActive(g));
      if (hasActiveGateway) {
        orgContext.hasActiveGateway = true;
        accountContext.hasActiveGateway = true;
      }

      const activeVerified = orgContext.gateways.some((g) => isGatewayActive(g) && isGatewayVerified(g));
      if (activeVerified) {
        orgContext.hasVerifiedGateway = true;
        accountContext.hasActiveVerifiedGateway = true;
      }

      // C1: Campaign-ready routing uses ACTIVE gateway only (not verified).
      if (orgContext.hasActiveGateway) {
        accountContext.hasCampaignReadyOrg = true;
      }

      accountContext.organizations.push(orgContext);
    }

    // 4. Determine Routing
    if (accountContext.hasCampaignReadyOrg) {
      accountContext.nextFlow = 'campaignManagement'; // User defined name
    } else {
      accountContext.nextFlow = 'kyc';
    }

    // 5. Save Context with additional routing flags
    // Generate simple text list for LLM usage
    // CHANGE: Use numbered list instead of IDs for user-friendly output
    const orgsListText = accountContext.organizations
      .map((o, index: number) => `${index + 1}. ${o.name}`)
      .join('\n');

    await flowHelpers.setUserData(userId, flowId, {
      account_context_json: JSON.stringify(accountContext),
      next_flow_slug: accountContext.nextFlow,
      has_multiple_orgs: accountContext.organizations.length > 1,
      org_count: accountContext.organizations.length,
      account_organizations_list: orgsListText, // Formatted list for prompts
      // C1: active gateway is the routing signal (not verified)
      workspace_has_active_gateway: accountContext.hasActiveGateway,
      // Keep this for optional warnings/telemetry
      workspace_has_active_verified_gateway: accountContext.hasActiveVerifiedGateway,
      workspace_has_entities: accountContext.hasAnyEntities,
      workspace_has_gateways: accountContext.hasAnyGateways,
      workspace_is_campaign_ready: accountContext.hasCampaignReadyOrg,
      // If single org, save its ID for easy access
      single_org_id: accountContext.organizations.length === 1 ? accountContext.organizations[0].id : null,
      single_org_name: accountContext.organizations.length === 1 ? accountContext.organizations[0].name : null,
    }, conversationId);

    logger.info('[checkAccountContextTool] Context built', {
      orgCount: accountContext.organizations.length,
      hasActiveGateway: accountContext.hasActiveGateway,
      hasActiveVerifiedGateway: accountContext.hasActiveVerifiedGateway,
      hasAnyEntities: accountContext.hasAnyEntities,
      hasAnyGateways: accountContext.hasAnyGateways,
      hasCampaignReadyOrg: accountContext.hasCampaignReadyOrg,
      nextFlow: accountContext.nextFlow,
    });

    return {
      success: true,
      data: {
        accountContext,
        nextFlow: accountContext.nextFlow,
      },
    };

  } catch (error) {
    logger.error('[checkAccountContextTool] Error', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error || 'Error in checkAccountContext'),
    };
  }
};
