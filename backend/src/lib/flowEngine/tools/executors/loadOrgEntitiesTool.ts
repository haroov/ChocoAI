import { ToolExecutor } from '../types';
import { flowHelpers } from '../../flowHelpers';
import { logger } from '../../../../utils/logger';
import { prisma } from '../../../../core';
import { httpService } from '../../../services/httpService';
import { getProjectConfig } from '../../../../utils/getProjectConfig';

export const loadOrgEntitiesTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    // Resolve User and Flow
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found in conversation' };
    }
    const { userId } = conversation;

    const userFlow = await prisma.userFlow.findUnique({
      where: { userId },
    });
    const flowId = userFlow?.flowId || '';

    const userData = await flowHelpers.getUserData(userId, flowId);

    const accountContextStr = userData.account_context_json as string;
    if (!accountContextStr) {
      return { success: false, errorCode: 'ACCOUNT_CONTEXT_MISSING', error: 'Account context not found' };
    }

    const accountContext = JSON.parse(accountContextStr);

    // Determine selected Org ID
    // 1. Payload org_selection (if user matched multiple)
    // 2. userData.single_org_id (if single org)
    // 3. userData.org_customer_id (legacy)
    const selectedOrgInput = (payload.org_selection as string)
      || (userData.single_org_id as string)
      || (userData.org_customer_id as string);

    let selectedOrgId = selectedOrgInput;

    if (!selectedOrgId && accountContext.organizations.length > 0) {
      // Fallback to first if only one
      if (accountContext.organizations.length === 1) {
        selectedOrgId = accountContext.organizations[0].id;
      }
    }

    if (!selectedOrgId) {
      return { success: false, errorCode: 'ORG_NOT_SELECTED', error: 'No organization selected' };
    }

    // Find org in context
    // Robust matching: Check ID as String/Number and Name fuzzy match
    let org = accountContext.organizations.find((o: any) => String(o.id) === String(selectedOrgId));

    // If not found by ID, try matching by Name (fuzzy/case-insensitive)
    if (!org) {
      const searchStr = String(selectedOrgId).trim().toLowerCase();

      // Index-based selection handling (e.g., "1", "2")
      // Check if input is a valid index integer
      const index = parseInt(searchStr, 10);
      if (!isNaN(index) && index > 0 && index <= accountContext.organizations.length) {
        // Valid 1-based index
        org = accountContext.organizations[index - 1];
        logger.info(`[loadOrgEntitiesTool] Selected org by index: ${index} -> ${org.name} (ID: ${org.id})`);
      } else {
        // Name/ID Match
        org = accountContext.organizations.find((o: any) => {
          const name = (o.name || '').toLowerCase();
          // Exact match preferred
          if (name === searchStr) return true;
          // ID match via search string if user passed ID as name?
          if (String(o.id) === searchStr) return true;

          return false;
        });
      }

      // If still not found, try fuzzy name match
      if (!org) {
        org = accountContext.organizations.find((o: any) => {
          const name = (o.name || '').toLowerCase();
          return name.includes(searchStr) || searchStr.includes(name);
        });
      }
    }

    if (!org) {
      return { success: false, errorCode: 'INVALID_ORG_SELECTION', error: 'Selected organization not found in context' };
    }

    // IMPORTANT: always use the resolved numeric ID for API calls and storage.
    // `selectedOrgId` may be a name/index from the user.
    const resolvedOrgId = String(org.id);

    // Lazy Load: If entities are missing, try to fetch them now
    if (!org.entities || org.entities.length === 0) {
      logger.info(
        `[loadOrgEntitiesTool] No entities found in context for org ${resolvedOrgId}. Attempting to fetch from API.`,
        { conversationId, selectedOrgInput, resolvedOrgId },
      );

      try {
        const projectConfig = await getProjectConfig();
        const baseUrl = projectConfig.chocoDashboardBaseUrl;
        const jwtToken = await flowHelpers.getJwtToken(userId, flowId);

        if (jwtToken) {
          const entitiesEndpoint = `${baseUrl}/orgarea/api/v1/organization/${resolvedOrgId}/account/entities`;
          const response = await httpService.get(entitiesEndpoint, {
            headers: {
              Authorization: `Bearer ${jwtToken}`,
              'Content-Type': 'application/json',
            },
            conversationId,
            operationName: 'Fetch Org Entities (Lazy Load)',
            providerName: 'CharidyAPI',
          });

          if (response.ok) {
            const data = await response.json();
            const fetchedEntities = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);

            if (fetchedEntities.length > 0) {
              logger.info(`[loadOrgEntitiesTool] Successfully fetched ${fetchedEntities.length} entities from API.`, { conversationId });
              org.entities = fetchedEntities;

              // Update accountContext in userData to persist this fix
              const orgIndex = accountContext.organizations.findIndex((o: any) => String(o.id) === String(resolvedOrgId));
              if (orgIndex !== -1) {
                accountContext.organizations[orgIndex].entities = fetchedEntities;
                await flowHelpers.setUserData(userId, flowId, {
                  account_context_json: JSON.stringify(accountContext),
                }, conversationId);
              }
            }
          } else {
            const body = await response.text().catch(() => '');
            logger.warn(
              `[loadOrgEntitiesTool] Failed to fetch entities from API. Status: ${response.status}`,
              { conversationId, resolvedOrgId, status: response.status, body: body.slice(0, 300) },
            );

            // Fail fast so the flow can recover by re-selecting org (or re-login if needed)
            if (response.status === 401 || response.status === 403) {
              return { success: false, errorCode: 'JWT_INVALID', error: 'Authorization failed while fetching entities' };
            }
            return { success: false, errorCode: 'ENTITIES_FETCH_FAILED', error: 'Failed to fetch entities for organization' };
          }
        } else {
          logger.warn('[loadOrgEntitiesTool] Cannot fetch entities: No JWT token available.', { conversationId });
          return { success: false, errorCode: 'JWT_MISSING', error: 'JWT token missing while fetching entities' };
        }
      } catch (fetchError) {
        logger.error('[loadOrgEntitiesTool] Error fetching entities from API', fetchError);
        return { success: false, errorCode: 'ENTITIES_FETCH_FAILED', error: 'Error fetching entities from API' };
      }
    }

    const entities = org.entities || [];
    const hasEntities = entities.length > 0;

    // Format for display? Or just save JSON
    // We save JSON for the flow prompt to use or for a selection tool

    // Generate formatted string for prompt
    // CHANGE: Use numbered list for user-friendly output
    const formattedList = entities.map((e: any, index: number) => {
      const taxId = e.attributes?.tax_id || e.id;
      const name = e.attributes?.name || e.name || 'Unknown Entity';
      // Hide internal ID in UI, tax ID is business relevant
      return `${index + 1}. ${name} (Tax ID: ${taxId})`;
    }).join('\n');

    const saveResults = {
      selected_org_id: resolvedOrgId,
      selected_org_name: org.name,
      selected_org_input: selectedOrgInput ?? selectedOrgId,
      available_entities_json: JSON.stringify(entities),
      formatted_entity_list: formattedList,
      has_entities: hasEntities,
    };

    return {
      success: true,
      data: {
        selectedOrgId,
        entityCount: entities.length,
        hasEntities,
      },
      saveResults,
    };

  } catch (error: any) {
    logger.error('[loadOrgEntitiesTool] Error', error);
    return {
      success: false,
      error: error.message,
    };
  }
};
