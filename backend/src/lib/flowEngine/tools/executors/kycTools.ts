import { ToolExecutor } from '../types';
import { prisma } from '../../../../core/prisma';
import { config as envConfig } from '../../../../core/config';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig, ProjectConfigData } from '../../../../utils/getProjectConfig';
import { OrganisationRegion } from '../../../../types/kycOrganisation';
import { normalizeGatewayName, getDefaultGateways, findSimilarGateways, getProviderDisplayName } from '../../utils/paymentGateways';
import { flowHelpers } from '../../flowHelpers';
import { logger } from '../../../../utils/logger';

/**
 * Builds a canonical entity object from collected fields and organization data
 */
export const buildEntityTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        user: {
          include: {
            UserOrganisation: {
              include: {
                organisation: true,
              },
            },
          },
        },
      },
    });

    if (!conversation?.userId || !conversation.user) {
      return { success: false, error: 'User not found' };
    }

    const { user } = conversation;

    // Get flowId from userFlow
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: user.id },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';
    // Infer entity_type if not provided
    let entityType = payload.entity_type as string; // 'PRIMARY_ORG' or 'OTHER_ENTITY'

    // Get user data early to populate fields
    // CRITICAL: Always scope to the active flowId (never read cross-flow values like OTP).
    const userData = await prisma.userData.findMany({
      where: { userId: user.id, flowId },
      select: { key: true, value: true },
    });

    if (!entityType) {
      const entitySelection = userData.find((d) => d.key === 'entity_selection')?.value;
      if (entitySelection === 'new') {
        entityType = 'OTHER_ENTITY';
      } else {
        // Default to PRIMARY_ORG for existing entities or unspecified
        entityType = 'PRIMARY_ORG';
      }
    }

    // CRITICAL: entity_type must be set (now inferred)
    if (!entityType || (entityType !== 'PRIMARY_ORG' && entityType !== 'OTHER_ENTITY')) {
      return { success: false, error: 'entity_type must be set to PRIMARY_ORG or OTHER_ENTITY before building entity' };
    }

    const isPrimaryOrg = entityType === 'PRIMARY_ORG';

    // Helper to get value from payload or userData
    const getValue = (key: string) => {
      const payloadVal = payload[key];
      if (payloadVal) return payloadVal;
      const userVal = userData.find((d) => d.key === key)?.value;
      return userVal || '';
    };

    // Get organization data if available
    const userOrg = user?.UserOrganisation?.[0]?.organisation;
    const orgData = userOrg?.data as any;
    const orgRegion = userOrg?.region;
    const currentOrgRegNum = orgData?.regNum || orgData?.tax_id || orgData?.ein || '';

    // Log organization data availability for debugging
    const { logger } = await import('../../../../utils/logger');
    logger.info('[buildEntityTool] Organization data check', {
      hasUserOrg: !!userOrg,
      hasOrgData: !!orgData,
      orgRegion,
      orgDataKeys: orgData ? Object.keys(orgData) : [],
      isPrimaryOrg,
      entityType,
    });

    // Build canonical entity object
    const entity: any = {
      id: '',
      type: 'org_legal_entity',
      name: '',
      address_line_1: '',
      address_line_2: getValue('entity_address_line_2'),
      city: '',
      state: getValue('entity_state'),
      zip: '',
      country: '',
      lat: 0,
      lng: 0,
      tax_id: '',
      tax_deductible_receipt: getValue('entity_tax_deductible_receipt') === 'true' || getValue('entity_tax_deductible_receipt') === true,
      section_46: false,
      receipt_config_il: { section_46: false },
      receipt_config_ca: getValue('entity_receipt_config_ca') ? JSON.parse(getValue('entity_receipt_config_ca')) : null,
      receipt_config_fr: getValue('entity_receipt_config_fr') ? JSON.parse(getValue('entity_receipt_config_fr')) : null,
      receipt_config_ge: getValue('entity_receipt_config_ge') ? JSON.parse(getValue('entity_receipt_config_ge')) : null,
      receipt_config_nz: getValue('entity_receipt_config_nz') ? JSON.parse(getValue('entity_receipt_config_nz')) : null,
      receipt_config_za: getValue('entity_receipt_config_za') ? JSON.parse(getValue('entity_receipt_config_za')) : null,
      receipt_logo: getValue('entity_receipt_logo') || null,
      primary: isPrimaryOrg,
      org_customer_id: 0, // Will be set from user data
      created_at: Math.floor(Date.now() / 1000),
    };

    // If PRIMARY_ORG, use organization data from signup/lookup
    if (isPrimaryOrg) {
      // IMPORTANT:
      // PRIMARY_ORG does NOT require external enrichment. If orgData exists, use it.
      // Otherwise build a minimal entity from what the user already provided in KYC.

      const selectedOrgName = getValue('selected_org_name') || getValue('single_org_name') || '';

      // entity_name
      entity.name = (orgData?.name || getValue('entity_name') || orgData?.organizationName || orgData?.legalName || selectedOrgName || '').trim();

      // entity_tax_id
      entity.tax_id = (orgData?.regNum || getValue('entity_tax_id') || orgData?.tax_id || orgData?.ein || '').trim();
      if (!entity.tax_id) {
        return {
          success: false,
          errorCode: 'TAX_ID_MISSING',
          error: 'Missing registration number for the receiving organization/entity.',
        };
      }

      // entity_country
      const countryInput = String(getValue('entity_country') || '').trim();
      const phone = String(getValue('phone') || '').trim();
      const isLikelyIsrael = orgRegion === OrganisationRegion.Israel
        || countryInput === 'IL'
        || countryInput === 'ישראל'
        || phone.startsWith('+972')
        || /^0\d{8,10}$/.test(phone);
      const isLikelyUsa = orgRegion === OrganisationRegion.USA || countryInput === 'US' || countryInput === 'USA';

      if (isLikelyIsrael) entity.country = 'IL';
      else if (isLikelyUsa) entity.country = 'US';
      else entity.country = countryInput;

      // Check for address fields in org data (different structure for Israel vs US)
      if (orgData && orgRegion === OrganisationRegion.Israel) {
        // Guidestar structure mapping:
        // entity_address_line_1: use "fullAddress" (not addressStreet first)
        entity.address_line_1 = orgData.fullAddress || getValue('entity_address_line_1') || orgData.addressStreet || orgData.address || '';
        // entity_city: use "addressCity"
        entity.city = orgData.addressCity || getValue('entity_city') || orgData.city || '';
        // entity_zip: use "addressZipCode"
        entity.zip = orgData.addressZipCode || getValue('entity_zip') || orgData.zip || orgData.postalCode || '';
        // entity_state and entity_address_line_2: leave blank for Israel
        entity.state = ''; // Explicitly empty for IL
        entity.address_line_2 = ''; // Explicitly empty for IL

        // Map section_46 from approval46 (Guidestar)
        // Guidestar typically returns boolean or "true"/"false" string
        if (orgData.approval46 === true || orgData.approval46 === 'true') {
          entity.section_46 = true;
          entity.receipt_config_il = { section_46: true };
        } else {
          entity.section_46 = false;
          entity.receipt_config_il = { section_46: false };
        }

        // Log address mapping for debugging
        logger.info('[buildEntityTool] Address mapping (Israel)', {
          fullAddress: orgData.fullAddress,
          addressCity: orgData.addressCity,
          addressZipCode: orgData.addressZipCode,
          mappedAddress: entity.address_line_1,
          mappedCity: entity.city,
          mappedZip: entity.zip,
        });
      } else if (orgData) {
        // CharityAPI structure: street, city, zip
        entity.address_line_1 = orgData.street || getValue('entity_address_line_1') || orgData.address || '';
        entity.city = orgData.city || getValue('entity_city') || '';
        entity.zip = orgData.zip || getValue('entity_zip') || orgData.postalCode || '';
        entity.state = orgData.state || getValue('entity_state') || '';

        // Log address mapping for debugging
        logger.info('[buildEntityTool] Address mapping (US)', {
          street: orgData.street,
          city: orgData.city,
          zip: orgData.zip,
          mappedAddress: entity.address_line_1,
          mappedCity: entity.city,
          mappedZip: entity.zip,
        });
      } else {
        // No enrichment data: keep what user provided (optional)
        entity.address_line_1 = getValue('entity_address_line_1');
        entity.city = getValue('entity_city');
        entity.zip = getValue('entity_zip');
        entity.state = getValue('entity_state');
      }
    } else {
      // OTHER_ENTITY - use collected fields from payload OR userData
      entity.name = getValue('entity_name');
      entity.tax_id = getValue('entity_tax_id');
      entity.country = getValue('entity_country');
      entity.address_line_1 = getValue('entity_address_line_1');
      entity.city = getValue('entity_city');
      entity.zip = getValue('entity_zip');
      entity.state = getValue('entity_state');

      // Validation for same-entity removed as per user request (allow pushing duplicate entity to API)
      /*
      if (entity.tax_id && currentOrgRegNum) {
        // Normalize both numbers (remove non-digits)
        const normalizedEntityTaxId = entity.tax_id.replace(/\D/g, '');
        const normalizedCurrentRegNum = currentOrgRegNum.replace(/\D/g, '');

        if (normalizedEntityTaxId === normalizedCurrentRegNum) {
           // Skip validation
        }
      }
      */
    }

    // Override with explicitly provided fields (user input takes precedence)
    if (payload.entity_name) entity.name = payload.entity_name;
    if (payload.entity_tax_id) entity.tax_id = payload.entity_tax_id;
    if (payload.entity_country) entity.country = payload.entity_country;
    if (payload.entity_address_line_1) entity.address_line_1 = payload.entity_address_line_1;
    if (payload.entity_city) entity.city = payload.entity_city;
    if (payload.entity_zip) entity.zip = payload.entity_zip;
    if (payload.entity_state) entity.state = payload.entity_state;

    // Get org_customer_id from user data (should be set after signup or org selection)
    // userData is already fetched above

    // Check if user selected a specific organization
    const selectedOrgIdData = userData.find((d) => d.key === 'selected_org_id');
    const orgCustomerIdData = userData.find((d) => d.key === 'org_customer_id');

    // Use selected_org_id if available, otherwise fall back to org_customer_id
    if (selectedOrgIdData?.value) {
      entity.org_customer_id = Number(selectedOrgIdData.value);
    } else if (orgCustomerIdData?.value) {
      entity.org_customer_id = Number(orgCustomerIdData.value);
    }

    // Check if user selected an existing entity
    const selectedEntityIdData = userData.find((d) => d.key === 'selected_entity_id');
    if (selectedEntityIdData?.value && selectedEntityIdData.value !== '') {
      // User selected an existing entity - return early without building new entity
      return {
        success: true,
        data: {
          selected_entity_id: selectedEntityIdData.value,
          skip_build: true,
        },
        saveResults: {
          entity_id: selectedEntityIdData.value,
        },
      };
    }

    // SIMPLIFIED: Allow building entity even with missing fields
    // Fill in defaults for missing required fields to prevent errors
    if (!entity.name || entity.name === '') {
      entity.name = payload.entity_name || 'Unknown Entity';
    }
    if (!entity.tax_id || entity.tax_id === '') {
      entity.tax_id = payload.entity_tax_id || '';
    }
    if (!entity.country || entity.country === '') {
      entity.country = payload.entity_country || 'IL'; // Default to IL for Israeli orgs
    }
    // Removed TBD defaults to enforce correct data collection
    if (payload.entity_address_line_1) entity.address_line_1 = payload.entity_address_line_1;
    if (payload.entity_city) entity.city = payload.entity_city;
    if (payload.entity_zip) entity.zip = payload.entity_zip;

    // Log missing fields and validate for PRIMARY_ORG
    const requiredFields = ['name', 'address_line_1', 'city', 'zip', 'country', 'tax_id'];
    const missingFields = requiredFields.filter((field) => !entity[field] || entity[field] === '' || entity[field] === 'TBD');

    if (missingFields.length > 0) {
      logger.warn('[buildEntityTool] Entity being built with missing/incomplete fields:', {
        missingFields,
        isPrimaryOrg,
        hasOrgData: !!orgData,
        orgRegion,
        entity: {
          name: entity.name,
          tax_id: entity.tax_id,
          country: entity.country,
          address_line_1: entity.address_line_1,
          city: entity.city,
          zip: entity.zip,
        },
        userId: user.id,
        conversationId,
      });

      // Strict Mode: Fail if fields are missing so flow redirects to manual collection
      return {
        success: false,
        errorCode: 'ENTITY_VALIDATION_FAILED',
        error: `Missing required entity fields: ${missingFields.join(', ')}`,
        data: { missingFields },
      };

      // For PRIMARY_ORG, if orgData exists but fields are still missing, this is a problem
      if (isPrimaryOrg && orgData && missingFields.length > 0) {
        logger.error('[buildEntityTool] PRIMARY_ORG entity missing fields despite orgData being available', {
          missingFields,
          orgDataKeys: Object.keys(orgData),
          orgDataAddressFields: {
            fullAddress: orgData.fullAddress,
            addressCity: orgData.addressCity,
            addressZipCode: orgData.addressZipCode,
            addressStreet: orgData.addressStreet,
          },
        });
      }
    }
    logger.info('[buildEntityTool] Entity built successfully with all required fields', {
      entityName: entity.name,
      entityTaxId: entity.tax_id,
      entityCountry: entity.country,
    });

    // Save entity to userData for later use
    // CRITICAL: Convert null/undefined to empty string to avoid saving "null" or "undefined" strings
    const entityDataEntries = Object.entries(entity).map(([key, value]) => ({
      userId: user.id,
      flowId: flowId,
      key: `entity_${key}`,
      value: value === null || value === undefined ? '' : String(value),
    }));

    logger.info('[buildEntityTool] Saving entity fields to userData', {
      fieldsCount: entityDataEntries.length,
      keyFields: entityDataEntries
        .filter((e) => ['entity_name', 'entity_tax_id', 'entity_country', 'entity_address_line_1', 'entity_city', 'entity_zip'].includes(e.key))
        .map((e) => ({ key: e.key, value: e.value })),
    });

    // Use upsert for each entry to handle duplicates
    for (const entry of entityDataEntries) {
      await prisma.userData.upsert({
        where: {
          key_userId_flowId: {
            userId: entry.userId,
            key: entry.key,
            flowId: entry.flowId,
          },
        },
        update: { value: entry.value },
        create: {
          userId: entry.userId,
          flowId: entry.flowId,
          key: entry.key,
          value: entry.value,
          type: 'string',
        },
      });
    }

    // Log the buildEntity operation using trackApiCall for visibility
    const requestInfo = {
      payload: {
        entity_type: entityType,
        entity_name: entity.name,
        entity_tax_id: entity.tax_id,
        entity_country: entity.country,
        entity_address_line_1: entity.address_line_1,
        entity_city: entity.city,
        entity_zip: entity.zip,
      },
      meta: {
        method: 'BUILD',
        endpoint: 'internal:build-entity',
        providerMode: 'internal',
        headers: {},
      },
    };

    return trackApiCall(
      conversationId,
      'Internal',
      'buildEntity',
      requestInfo,
      async () => ({
        success: true,
        data: entity,
        saveResults: {
          entity_built: true,
          entity_name: entity.name,
          entity_country: entity.country,
          entity_tax_id: entity.tax_id,
        },
      }),
    );
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to build entity',
    };
  }
};

/**
 * Pushes entity to Choco API
 */
export const pushEntityTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get flowId for reset_token retrieval
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get entity from userData
    const userData = await prisma.userData.findMany({
      where: { userId: conversation.userId },
      select: { key: true, value: true },
    });

    const entity: any = {};
    userData.forEach((d) => {
      if (d.key.startsWith('entity_')) {
        const fieldName = d.key.replace('entity_', '');
        // Parse JSON strings back to objects for receipt_config fields
        if (fieldName.startsWith('receipt_config_') && d.value && d.value !== '' && d.value !== 'null') {
          try {
            entity[fieldName] = JSON.parse(d.value);
          } catch {
            entity[fieldName] = d.value;
          }
        } else {
          entity[fieldName] = d.value;
        }
      }
    });

    logger.info('[pushEntityTool] Entity data loaded', {
      hasName: !!entity.name,
      hasTaxId: !!entity.tax_id,
      hasOrgCustomerId: !!entity.org_customer_id,
      orgCustomerId: entity.org_customer_id,
      userDataKeys: userData.map((d) => d.key), // Log ALL keys to debug missing context
    });

    // Ensure org_customer_id is set - try multiple sources
    if (!entity.org_customer_id) {
      const orgCustomerIdData = userData.find((d) => d.key === 'org_customer_id');
      if (orgCustomerIdData?.value) {
        entity.org_customer_id = orgCustomerIdData.value;
      } else {
        // Try simple org_id
        const orgIdData = userData.find((d) => d.key === 'org_id');
        if (orgIdData?.value) {
          entity.org_customer_id = orgIdData.value;
        } else {
          // Try single_org_id (set by checkAccountContext if user has only 1 org)
          const singleOrgId = userData.find((d) => d.key === 'single_org_id');
          if (singleOrgId?.value) {
            entity.org_customer_id = singleOrgId.value;
          } else {
            // FINAL FALLBACK: Try parsing organizations_json
            // This is used by other working tools (checkAccountContext, matchOrgAndSelectEntity)
            // FINAL FALLBACK: Try parsing organizations_json OR account_context_json
            // checkAccountContextTool saves to account_context_json, while others might use organizations_json
            const orgsJsonData = userData.find((d) => d.key === 'organizations_json');
            const accountContextData = userData.find((d) => d.key === 'account_context_json');

            let orgs: any[] = [];

            // Prefer account_context_json if available (fresher from login check)
            if (accountContextData?.value) {
              try {
                const ctx = JSON.parse(accountContextData.value);
                if (Array.isArray(ctx.organizations)) {
                  orgs = ctx.organizations; // structure is { id, name, ... } per checkAccountContextTool
                }
              } catch (e) { logger.warn('[pushEntityTool] Failed to parse account_context_json', e); }
            }

            // Fallback to older organizations_json if empty
            if (orgs.length === 0 && orgsJsonData?.value) {
              try {
                orgs = JSON.parse(orgsJsonData.value);
              } catch (e) {
                logger.warn('[pushEntityTool] Failed to parse organizations_json fallback', e);
              }
            }

            if (orgs.length > 0) {
              logger.info('[pushEntityTool] Debugging Name Lookup', {
                selectedName: userData.find((d) => d.key === 'org_selection')?.value,
                availableOrgs: orgs.map((o: any) => ({
                  id: o.id,
                  name: o.name,
                  orgName: o.organizationName,
                })),
              });

              if (Array.isArray(orgs) && orgs.length > 0) {
                // Try to find by selected name first
                const selectedName = userData.find((d) => d.key === 'org_selection')?.value;
                let matchedOrg = null;

                if (selectedName) {
                  matchedOrg = orgs.find((o: any) =>
                    (o.name && o.name.trim() === selectedName.trim()) ||
                    (o.organizationName && o.organizationName.trim() === selectedName.trim()) ||
                    (o.id && String(o.id) === selectedName),
                  );
                  if (matchedOrg) {
                    logger.info(`[pushEntityTool] Found Org ID by name match: "${selectedName}" -> ${matchedOrg.id}`);
                  } else {
                    logger.warn(`[pushEntityTool] Name match failed for "${selectedName}"`);
                  }
                }

                // Fallback to first org if no specific match found
                if (!matchedOrg) {
                  matchedOrg = orgs[0];
                  logger.info(`[pushEntityTool] Defaulting to first org: ${matchedOrg.id}`);
                }

                entity.org_customer_id = matchedOrg.id || matchedOrg;
              }
            } else { // Close if (orgs.length > 0) else
              logger.warn('[pushEntityTool] Organizations list is empty or invalid', {
                accountContextSize: accountContextData?.value?.length,
              });
            }

          }
        }
      }
    }

    // AGGRESSIVE FALLBACKS for Org ID
    if (!entity.org_customer_id || isNaN(Number(entity.org_customer_id))) {
      // 1. Try single_org_id
      const singleOrgId = userData.find((d) => d.key === 'single_org_id')?.value;
      if (singleOrgId) {
        entity.org_customer_id = singleOrgId;
        logger.info(`[pushEntityTool] Recovered ID from single_org_id: ${singleOrgId}`);
      } else {
        // 2. Try org_id
        const orgId = userData.find((d) => d.key === 'org_id')?.value;
        if (orgId) {
          entity.org_customer_id = orgId;
          logger.info(`[pushEntityTool] Recovered ID from org_id: ${orgId}`);
        } else {
          // 3. Try org_customer_id direct key again
          const directId = userData.find((d) => d.key === 'org_customer_id')?.value;
          if (directId) entity.org_customer_id = directId;
        }
      }
    }

    if (!entity.name || !entity.org_customer_id) {
      // Re-check single_org_id directly as final fallback before failing
      const singleOrgId = userData.find((d) => d.key === 'single_org_id')?.value;
      if (singleOrgId) {
        entity.org_customer_id = singleOrgId;
      } else {
        return { success: false, error: 'Entity not built or org_customer_id (Organization ID) is missing. Please ensure you have selected an organization.' };
      }
    }

    const projectConfig = await getProjectConfig();
    // Ensure org_customer_id is a number (convert from string if needed)
    let orgCustomerId = typeof entity.org_customer_id === 'string'
      ? Number(entity.org_customer_id)
      : entity.org_customer_id;
    // Validating orgCustomerId before building endpoint
    if (!orgCustomerId || isNaN(orgCustomerId)) {
      logger.warn('[pushEntityTool] Missing/invalid org id; attempting to create organization before entity push', {
        conversationId,
        orgCustomerId,
      });

      try {
        // Use the consolidated userData view to build an org payload from collected/enriched fields.
        const mergedUserData = await flowHelpers.getUserData(conversation.userId, flowId);
        const orgNameCandidate = (mergedUserData.organization_name as string)
          || (mergedUserData.single_org_name as string)
          || (mergedUserData.entity_name as string)
          || 'My Organization';
        const fullNameCandidate = [
          (mergedUserData.first_name as string) || '',
          (mergedUserData.last_name as string) || '',
        ].filter(Boolean).join(' ').trim()
          || 'Choco User';
        const phoneCandidate = (mergedUserData.phone as string)
          || (mergedUserData.user_phone as string)
          || (mergedUserData.org_phone as string)
          || '';
        const timezoneCandidate = (mergedUserData.timezone as string)
          || (mergedUserData.org_timezone as string)
          || 'UTC';
        const langCandidate = (mergedUserData.lang as string)
          || (mergedUserData.org_lang as string)
          || 'en';

        if (phoneCandidate) {
          const { createOrgTool } = await import('./createOrgTool');
          const createRes = await createOrgTool({
            name: orgNameCandidate,
            full_name: fullNameCandidate,
            phone: phoneCandidate,
            website: (mergedUserData.org_website as string) || (mergedUserData.website as string) || '',
            about: (mergedUserData.org_about as string) || '',
            timezone: timezoneCandidate,
            lang: langCandidate,
          }, { conversationId });

          if (createRes.success) {
            const refreshed = await flowHelpers.getUserData(conversation.userId, flowId);
            const newOrgId = (refreshed.org_customer_id as string) || (refreshed.org_id as string);
            if (newOrgId) {
              entity.org_customer_id = newOrgId;
              orgCustomerId = Number(newOrgId);
              logger.info('[pushEntityTool] Created organization; recovered org id for entity push', {
                conversationId,
                orgCustomerId,
              });
            }
          } else {
            logger.warn('[pushEntityTool] Failed to auto-create organization before entity push', {
              conversationId,
              error: createRes.error,
            });
          }
        } else {
          logger.warn('[pushEntityTool] Cannot auto-create organization (missing phone)', { conversationId });
        }
      } catch (e) {
        logger.warn('[pushEntityTool] Auto-create organization attempt failed', { conversationId });
      }

      if (!orgCustomerId || isNaN(orgCustomerId)) {
        logger.error(`[pushEntityTool] FATAL: Invalid Organization ID: ${orgCustomerId}. API Call will fail.`);
        return {
          success: false,
          error: `Organization ID Not Found (Value: ${orgCustomerId}). Please contact support or restart the flow logic.`,
          errorCode: 'MISSING_ORG_ID',
        };
      }
    }

    const endpoint = projectConfig.backendMode === 'choco'
      ? `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v1/organization/${orgCustomerId}/account/entities`
      : 'mock:entity';

    // Check if entities already exist for this organization - if so, set primary=false
    let hasExistingEntities = false;
    try {
      const entitiesJson = userData.find((d) => d.key === `entities_org_${orgCustomerId}`);
      if (entitiesJson?.value) {
        const existingEntities = JSON.parse(entitiesJson.value);
        hasExistingEntities = Array.isArray(existingEntities) && existingEntities.length > 0;
      }
    } catch {
      // Ignore parsing errors
    }

    // If no entities found in userData, try to fetch from API
    if (!hasExistingEntities) {
      try {
        const { getChocoAuthToken } = await import('../helpers/getChocoAuthToken');
        const authToken = await getChocoAuthToken(conversation.userId, flowId, true);
        if (authToken) {
          const entitiesEndpoint = `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v1/organization/${orgCustomerId}/account/entities`;
          const entitiesResponse = await fetch(entitiesEndpoint, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
            },
          });
          if (entitiesResponse.ok) {
            const entitiesData = await entitiesResponse.json();
            const entitiesArray = Array.isArray(entitiesData?.data) ? entitiesData.data : (entitiesData?.data ? [entitiesData.data] : []);
            hasExistingEntities = entitiesArray.length > 0;
          }
        }
      } catch {
        // Ignore fetch errors
      }
    }

    // Determine entity type based on country (nonprofit for IL, may vary for US)
    // For now, default to "nonprofit" for all entities
    const entityTypeInAttributes = entity.country === 'US' ? 'nonprofit' : 'nonprofit';

    // CRITICAL: If entities already exist, set primary=false
    const entityPrimary = hasExistingEntities ? false : (entity.primary === 'true' || entity.primary === true);

    logger.info('[pushEntityTool] Entity push configuration', {
      orgCustomerId,
      hasExistingEntities,
      entityPrimary,
      entityName: entity.name,
    });

    // Prepare payload for API in JSON:API format
    // Refined structure to match User's "Working" example exactly

    // Receipt Config IL Logic
    // Default to { section_46: false } if null/undefined
    let receiptConfigIl = { section_46: false };

    // If entity has explicitly mapped config, use it
    if (entity.receipt_config_il) {
      if (typeof entity.receipt_config_il === 'object') {
        receiptConfigIl = entity.receipt_config_il;
      } else if (typeof entity.receipt_config_il === 'string') {
        try { receiptConfigIl = JSON.parse(entity.receipt_config_il); } catch (e) { /* ignore */ }
      }
    } else if (entity.section_46 === true || entity.section_46 === 'true') {
      receiptConfigIl = { section_46: true };
    }

    const apiPayload: any = {
      data: {
        type: 'org_legal_entity',
        attributes: {
          type: 'nonprofit', // Fixed to "nonprofit" as per user example
          name: String(entity.name || '').trim().replace(/^"|"$/g, ''), // Normalize name, remove surrounding quotes
          tax_id: String(entity.tax_id || ''),
          address_line_1: String(entity.address_line_1 || ''),
          address_line_2: String(entity.address_line_2 || ''), // Should be empty string if not set
          city: String(entity.city || ''),
          state: String(entity.state || ''), // Should be empty string for IL
          zip: String(entity.zip || ''),
          country: String(entity.country || 'IL'),
          // lat/lng removed as requested
          tax_deductible_receipt: entity.tax_deductible_receipt === 'true' || entity.tax_deductible_receipt === true,
          receipt_config_il: receiptConfigIl,
          receipt_config_ca: entity.receipt_config_ca || null,
          receipt_config_fr: entity.receipt_config_fr || null,
          receipt_config_ge: entity.receipt_config_ge || null,
          receipt_config_nz: entity.receipt_config_nz || null,
          receipt_config_za: entity.receipt_config_za || null,
          receipt_logo: entity.receipt_logo || null,
          primary: false, // User example has primary: false (default for new entity usually, unless first)
        },
        id: '', // Matches User's "Working" payload structure placements
      },
      included: [],
    };

    // Override primary if it's the first entity (logic can stay, but default safe is false)
    if (!hasExistingEntities && (entity.primary === true || entity.primary === 'true')) {
      apiPayload.data.attributes.primary = true;
    }

    // Get jwt_token from userData for authenticated requests after login
    const { getChocoAuthToken } = await import('../helpers/getChocoAuthToken');
    const authToken = await getChocoAuthToken(conversation.userId, flowId, true);

    logger.info('[pushEntityTool] Validated Entity Push Payload', {
      orgCustomerId,
      endpoint,
      entityName: apiPayload.data.attributes.name,
      entityPrimary: apiPayload.data.attributes.primary,
      hasAuthToken: !!authToken,
    });

    const requestInfo = {
      payload: apiPayload,
      meta: {
        method: 'POST',
        endpoint,
        providerMode: projectConfig.backendMode,
        headers: { Authorization: `Bearer ${authToken}` },
      },
    };

    const result = await trackApiCall(
      conversationId,
      projectConfig.backendMode === 'choco' ? 'ChocoAPI' : 'Mock',
      'pushEntity',
      requestInfo,
      async () => {
        if (projectConfig.backendMode === 'choco') {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(apiPayload),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({})) as any;
            // Provide structured error codes so the flow can recover by collecting missing fields
            // instead of dead-ending with a generic "try again".
            const { status } = response;
            const errorCode =
              status === 401 || status === 403 ? 'JWT_INVALID'
                : (status === 400 || status === 422) ? 'ENTITY_VALIDATION_FAILED'
                  : undefined;
            return {
              success: false,
              error: errorData.error || `HTTP ${response.status}`,
              status: response.status,
              data: errorData, // Include error data for consistent return structure
              ...(errorCode ? { errorCode } : {}),
            };
          }

          const data = await response.json();

          // Get flowId
          const userFlow = await prisma.userFlow.findUnique({
            where: { userId: conversation.userId! }, // Non-null assertion: already checked above
            select: { flowId: true },
          });
          const flowIdRaw = userFlow?.flowId;
          if (!flowIdRaw) {
            return {
              success: false,
              error: 'Flow ID not found',
            };
          }
          const flowId: string = flowIdRaw; // Type assertion after null check

          // Extract entity_id from JSON:API response format: data.data.id
          // CRITICAL: Convert undefined to empty string to match buildEntityTool behavior (line 275)
          // This ensures consistent state handling and prevents undefined from being saved
          let entityIdValue = data?.data?.id ? String(data.data.id) : '';

          // Validate ID is not garbage
          if (entityIdValue === ':' || entityIdValue === 'null' || entityIdValue === 'undefined') {
            entityIdValue = '';
          }

          if (!entityIdValue) {
            logger.warn('[pushEntityTool] Entity created but entity_id not found in response', {
              responseData: data,
              responseStructure: {
                hasData: !!data?.data,
                hasId: !!data?.data?.id,
                dataKeys: data?.data ? Object.keys(data.data) : [],
              },
            });
            // Return error with errorCode if entity_id is missing
            return {
              success: false,
              error: 'Entity push failed - entity_id not returned from API',
              status: response.status,
              errorCode: 'ENTITY_PUSH_FAILED',
            };
          }
          logger.info(`[pushEntityTool] Entity created successfully, entity_id: ${entityIdValue}`);

          // Update entity.id with returned ID
          // CRITICAL: Always save as string (empty string if not found) to match buildEntityTool behavior
          await prisma.userData.upsert({
            where: {
              key_userId_flowId: {
                userId: conversation.userId!, // Non-null assertion: already checked above
                key: 'entity_id',
                flowId: flowId,
              },
            },
            update: { value: entityIdValue },
            create: {
              userId: conversation.userId!, // Non-null assertion: already checked above
              flowId: flowId,
              key: 'entity_id',
              value: entityIdValue, // Will be empty string if not found, not undefined
              type: 'string',
            },
          });

          return {
            success: true,
            data,
            status: response.status,
          };
        }
        // Mock response
        const userFlowMock = await prisma.userFlow.findUnique({
          where: { userId: conversation.userId! }, // Non-null assertion: already checked above
          select: { flowId: true },
        });
        const flowIdMockRaw = userFlowMock?.flowId;
        if (!flowIdMockRaw) {
          return {
            success: false,
            error: 'Flow ID not found',
          };
        }
        const flowIdMock: string = flowIdMockRaw; // Type assertion after null check

        const mockId = Math.floor(Math.random() * 100000).toString();
        await prisma.userData.upsert({
          where: {
            key_userId_flowId: {
              userId: conversation.userId!, // Non-null assertion: already checked above
              key: 'entity_id',
              flowId: flowIdMock,
            },
          },
          update: { value: mockId },
          create: {
            userId: conversation.userId!, // Non-null assertion: already checked above
            flowId: flowIdMock,
            key: 'entity_id',
            value: mockId,
            type: 'string',
          },
        });

        return {
          success: true,
          data: { id: mockId, ...apiPayload },
          status: 200,
        };

      },
    );

    logger.info(`[pushEntityTool] Completed. Result Success: ${result.success}`);

    if (result.success) {
      // Only log success, do not auto-select gateway here.
      // Gateway selection is handled in kycPaymentGatewayDiscovery stage / buildGatewayConfigTool.
      logger.info(`[pushEntityTool] Entity pushed successfully. Entity ID: ${result.data?.id || result.data?.data?.id}`);
    }

    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to push entity to API',
      errorCode: error?.errorCode,
    };
  }
};

/**
 * Builds gateway configuration from user input
 */
export const buildGatewayConfigTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get entity_id from userData
    const userData = await prisma.userData.findMany({
      where: { userId: conversation.userId },
      select: { key: true, value: true },
    });

    const entityIdData = userData.find((d) => d.key === 'entity_id');
    const entityCountryData = userData.find((d) => d.key === 'entity_country');
    const orgCustomerIdData = userData.find((d) => d.key === 'org_customer_id');

    if (!entityIdData?.value) {
      return { success: false, error: 'Entity ID not found. Please complete entity setup first.' };
    }

    const entityId = Number(entityIdData.value);
    const country = entityCountryData?.value || 'US';
    const orgCustomerId = orgCustomerIdData?.value ? Number(orgCustomerIdData.value) : 0;

    // Parse gateway providers - can be comma-separated string or array
    let providers: string[] = [];
    if (typeof payload.gateway_providers === 'string') {
      providers = payload.gateway_providers.split(',').map((p: string) => p.trim());
    } else if (Array.isArray(payload.gateway_providers)) {
      providers = payload.gateway_providers.map((p: any) => String(p).trim());
    }

    // Normalize provider names to IDs using paymentGateways utility
    const normalizedProviders: string[] = [];
    const unsupportedProviders: string[] = [];

    for (const provider of providers) {
      const normalized = normalizeGatewayName(provider);
      if (normalized) {
        normalizedProviders.push(normalized);
      } else {
        unsupportedProviders.push(provider);
      }
    }

    // If no valid providers found, use defaults
    if (normalizedProviders.length === 0 && providers.length > 0) {
      // User provided unsupported gateway - use defaults
      const defaults = getDefaultGateways(country as 'IL' | 'US');
      normalizedProviders.push(...defaults);
    } else if (normalizedProviders.length === 0) {
      // No providers provided - use defaults
      const defaults = getDefaultGateways(country as 'IL' | 'US');
      normalizedProviders.push(...defaults);
    }

    // Map normalized provider IDs to gateway slugs (some providers need special mapping)
    const providerSlugMap: Record<string, string> = {
      stripe: 'stripe',
      paypal: 'paypal',
      authorize_net: 'authorize-net',
      authorizenet: 'authorize-net',
      meshulam: 'meshulam-v2',
      'meshulam-v2': 'meshulam-v2',
      cardcom: 'cardcom',
      // Add more mappings as needed
    };

    // Determine default currency based on country
    const defaultCurrency = country === 'IL' ? 'ils' : 'usd';

    const gateways: any[] = [];

    for (const providerId of normalizedProviders) {
      // Map to provider slug (use providerId if no mapping, or mapped value)
      const slug = providerSlugMap[providerId] || providerId;

      // Build gateway payload
      // Populate fields for Meshulam (Grow)
      const userPhone = userData.find((d) => d.key === 'phone')?.value || userData.find((d) => d.key === 'user_phone')?.value || '';
      const entityTaxId = userData.find((d) => d.key === 'entity_tax_id')?.value || '';

      const gatewayPayload = {
        legal_entity_id: entityId,
        user_id: payload.gateway_user_id || '',
        api_key: payload.gateway_api_key || '',
        currency: defaultCurrency,
        status: false, // Default to false for new setups (Meshulam requires validation)
        fallback_phone: userPhone,
        new_user: true, // Default to true as per requirements
        new_user_business_number: entityTaxId, // From entity regNum/tax_id
        new_user_phone: userPhone,
        new_user_quote: 'cc_bit', // Default quote type
        org_custom_id: payload.gateway_org_custom_id || String(orgCustomerId),
      };

      const displayName = getProviderDisplayName(providerId) || slug;

      gateways.push({
        provider_name: slug,
        provider_id: providerId,
        label: displayName,
        currency: defaultCurrency,
        primary_currency: defaultCurrency,
        org_custom_id: gatewayPayload.org_custom_id,
        user_id: gatewayPayload.user_id,
        status: 'PENDING_SETUP',
        api_key: gatewayPayload.api_key,
        fallback_phone: gatewayPayload.fallback_phone,
        new_user: false,
        raw_gateway_payload: gatewayPayload,
      });
    }

    const paymentConfig = {
      entity_id: String(entityId),
      gateways,
      unsupported_providers: unsupportedProviders, // Track unsupported providers
    };

    // Get flowId
    const userFlowForConfig = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowIdForConfigRaw = userFlowForConfig?.flowId;
    if (!flowIdForConfigRaw) {
      return { success: false, error: 'Flow ID not found' };
    }
    const flowIdForConfig: string = flowIdForConfigRaw;

    // Save payment config to userData
    await prisma.userData.upsert({
      where: {
        key_userId_flowId: {
          userId: conversation.userId,
          key: 'payment_config',
          flowId: flowIdForConfig,
        },
      },
      update: { value: JSON.stringify(paymentConfig) },
      create: {
        userId: conversation.userId,
        flowId: flowIdForConfig,
        key: 'payment_config',
        value: JSON.stringify(paymentConfig),
        type: 'string',
      },
    });

    // If there are unsupported providers, return a special flag
    if (unsupportedProviders.length > 0) {
      return {
        success: true,
        data: paymentConfig,
        saveResults: {
          gateway_config_built: true,
          gateway_count: gateways.length,
          unsupported_providers: unsupportedProviders,
          needs_email: true, // Flag to indicate email should be sent
        },
      };
    }

    return {
      success: true,
      data: paymentConfig,
      saveResults: {
        gateway_config_built: true,
        gateway_count: gateways.length,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to build gateway configuration',
    };
  }
};

/**
 * Adds payment gateway to API
 */
export const addGatewayTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const { logger } = await import('../../../../utils/logger');
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get payment config from userData
    const userData = await prisma.userData.findMany({
      where: { userId: conversation.userId },
      select: { key: true, value: true },
    });

    const paymentConfigData = userData.find((d) => d.key === 'payment_config');
    const orgCustomerIdData = userData.find((d) => d.key === 'org_customer_id');
    const entityIdData = userData.find((d) => d.key === 'entity_id') || userData.find((d) => d.key === 'selected_entity_id');
    const entityTaxIdData = userData.find((d) => d.key === 'entity_tax_id');
    const userPhoneData = userData.find((d) => d.key === 'phone') || userData.find((d) => d.key === 'user_phone');

    if (!paymentConfigData?.value) {
      return { success: false, error: 'Gateway configuration not found' };
    }

    const paymentConfig = JSON.parse(paymentConfigData.value);
    const orgCustomerId = orgCustomerIdData?.value ? String(orgCustomerIdData.value) : '';
    const entityId = entityIdData?.value ? String(entityIdData.value) : '';

    if (!orgCustomerId || !entityId) {
      return { success: false, error: 'Organization or Entity ID not found' };
    }

    // Import robust gateway tool
    const { addPaymentGatewayTool } = await import('./addPaymentGatewayTool');

    // Run addPaymentGatewayTool for each configured gateway
    const results: any[] = [];
    const gatewayResults: Record<string, any> = {};

    for (const gateway of paymentConfig.gateways) {
      const providerSlug = gateway.provider_name;
      const gatewayType = gateway.provider_name.includes('stripe') ? 'stripe' :
        (gateway.provider_name.includes('meshulam') || gateway.provider_name.includes('grow')) ? 'meshulam' :
          gateway.provider_name;

      // Construct robust payload for addPaymentGatewayTool
      // Ensure we pass all necessary fields including new_user fields
      const effectivePayload = {
        org_id: orgCustomerId,
        entity_id: entityId,
        gateway_type: gatewayType,
        // Pass Meshulam/Grow specific fields if present in raw payload
        new_user_business_number: gateway.raw_gateway_payload?.new_user_business_number || entityTaxIdData?.value || '',
        new_user_phone: gateway.raw_gateway_payload?.new_user_phone || userPhoneData?.value || '',
        new_user_quote: gateway.raw_gateway_payload?.new_user_quote || 'cc_bit',
        fallback_phone: gateway.raw_gateway_payload?.fallback_phone || userPhoneData?.value || '',
        // Override with any user-supplied payload values
        ...payload,
      };

      logger.info(`[addGatewayTool] Delegating to addPaymentGatewayTool for ${providerSlug}`, { effectivePayload });

      const result = await addPaymentGatewayTool(effectivePayload, { conversationId });
      results.push({ provider: providerSlug, ...result });

      if (result.success) {
        gatewayResults[providerSlug] = result.data;
      }
    }

    const allSuccess = results.every((r) => r.success);
    const failedGateways = results.filter((r) => !r.success).map((r) => r.provider);

    return {
      success: allSuccess,
      data: {
        results,
        gatewayResults,
      },
      error: allSuccess ? undefined : `Failed to add gateways: ${failedGateways.join(', ')}`,
      saveResults: {
        gateways_added: allSuccess,
        gateways_added_list: Object.keys(gatewayResults),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to add gateway',
    };
  }
};

/**
 * Verifies gateways by listing them from API
 */
export const verifyGatewaysTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get entity_id and org_customer_id from userData
    const userData = await prisma.userData.findMany({
      where: { userId: conversation.userId },
      select: { key: true, value: true },
    });

    const entityIdData = userData.find((d) => d.key === 'entity_id');
    const orgCustomerIdData = userData.find((d) => d.key === 'org_customer_id');

    if (!entityIdData?.value) {
      return { success: false, error: 'Entity ID not found' };
    }

    const entityId = Number(entityIdData.value);
    const orgCustomerId = orgCustomerIdData?.value ? Number(orgCustomerIdData.value) : 0;

    // Get flowId for jwt_token retrieval
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId! },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get jwt_token from userData for authenticated requests after login
    const { getChocoAuthToken } = await import('../helpers/getChocoAuthToken');
    const authToken = await getChocoAuthToken(conversation.userId!, flowId, true);

    const projectConfig = await getProjectConfig();
    const endpoint = projectConfig.backendMode === 'choco'
      ? `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v1/organization/${orgCustomerId}/gateways`
      : 'mock:gateways';

    const requestInfo = {
      payload: {},
      meta: {
        method: 'GET',
        endpoint,
        providerMode: projectConfig.backendMode,
        headers: { Authorization: `Bearer ${authToken}` },
      },
    };

    const result = await trackApiCall(
      conversationId,
      projectConfig.backendMode === 'choco' ? 'ChocoAPI' : 'Mock',
      'listGateways',
      requestInfo,
      async () => {
        if (projectConfig.backendMode === 'choco') {
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
            },
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({})) as any;
            return {
              success: false,
              error: errorData.error || `HTTP ${response.status}`,
              status: response.status,
            };
          }

          const data = await response.json();

          // Filter gateways by entity_id
          const entityGateways = (data.data || []).filter(
            (gw: any) => gw.attributes?.entity_id === entityId,
          );

          // Update payment config with verification results
          const paymentConfigData = userData.find((d) => d.key === 'payment_config');
          if (paymentConfigData?.value) {
            const paymentConfig = JSON.parse(paymentConfigData.value);
            paymentConfig.gateways = paymentConfig.gateways.map((gw: any) => {
              const verifiedGw = entityGateways.find(
                (vgw: any) => vgw.attributes?.gateway === gw.provider_name,
              );
              if (verifiedGw) {
                return {
                  ...gw,
                  status: verifiedGw.attributes?.active ? 'ACTIVE' : 'INACTIVE',
                  primary_currency: verifiedGw.attributes?.primary_currency || gw.primary_currency,
                  verified: verifiedGw.attributes?.verified || false,
                  gateway_id: verifiedGw.id,
                };
              }
              return gw;
            });

            const userFlow = await prisma.userFlow.findUnique({
              where: { userId: conversation.userId! }, // Non-null assertion: already checked above
              select: { flowId: true },
            });
            const flowIdRaw = userFlow?.flowId;
            if (!flowIdRaw) {
              return {
                success: false,
                error: 'Flow ID not found',
              };
            }
            const flowId: string = flowIdRaw; // Type assertion after null check

            await prisma.userData.updateMany({
              where: {
                userId: conversation.userId!, // Non-null assertion: already checked above
                key: 'payment_config',
                flowId: flowId,
              },
              data: { value: JSON.stringify(paymentConfig) },
            });
          }

          return {
            success: true,
            data: {
              gateways: entityGateways,
              count: entityGateways.length,
            },
            status: response.status,
          };
        }
        // Mock response
        return {
          success: true,
          data: {
            gateways: [
              {
                id: '1',
                attributes: {
                  active: true,
                  entity_id: entityId,
                  gateway: 'stripe',
                  primary_currency: 'usd',
                  verified: false,
                },
              },
            ],
            count: 1,
          },
          status: 200,
        };

      },
    );

    // Post-process to compute deterministic flags for routing/completion.
    if (result.success) {
      const gateways = (result.data as any)?.gateways
        ? (result.data as any).gateways
        : (result.data as any)?.data?.gateways
        || (result.data as any)?.data?.data?.gateways;

      const arr = Array.isArray(gateways) ? gateways : [];
      const isActive = (g: any): boolean => {
        const attrs = g.attributes || g;
        if (attrs.active === true) return true;
        if (typeof attrs.status === 'string' && attrs.status.toLowerCase() === 'active') return true;
        return false;
      };

      const activeGateways = arr.filter((g: any) => isActive(g));
      return {
        ...(result as any),
        saveResults: {
          has_active_gateway: activeGateways.length > 0,
          active_gateway_count: activeGateways.length,
          gateways_json: JSON.stringify(arr),
          active_gateways_json: JSON.stringify(activeGateways),
        },
      };
    }

    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to verify gateways',
    };
  }
};

/**
 * Completes KYC flow and marks status as COMPLETED
 */
export const completeKycTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get flowId
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId ?? '';

    // Guardrail (D1): do not mark KYC completed unless we have an active gateway.
    const mergedUserData = await flowHelpers.getUserData(conversation.userId, flowId);
    const hasActiveGateway = mergedUserData.has_active_gateway === true || String(mergedUserData.has_active_gateway).toLowerCase() === 'true';
    if (!hasActiveGateway) {
      return {
        success: false,
        errorCode: 'NO_ACTIVE_GATEWAY',
        error: 'No active gateway yet',
      };
    }

    // Mark KYC as completed
    await prisma.userData.upsert({
      where: {
        key_userId_flowId: {
          userId: conversation.userId,
          key: 'kyc_status',
          flowId: flowId,
        },
      },
      update: { value: 'COMPLETED' },
      create: {
        userId: conversation.userId,
        flowId: flowId,
        key: 'kyc_status',
        value: 'COMPLETED',
        type: 'string',
      },
    });

    return {
      success: true,
      data: { kyc_status: 'COMPLETED' },
      saveResults: {
        kyc_status: 'COMPLETED',
        kyc_completed: true,
        has_active_gateway: true,
        workspace_has_active_gateway: true,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to complete KYC',
    };
  }
};

/**
 * Matches signup organization with organizations from GET /organizations
 * and lists entities for the selected organization
 */
export const matchOrgAndSelectEntityTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get flowId
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get userData
    const userData = await flowHelpers.getUserData(conversation.userId, flowId);

    // Get signup organization name
    const signupOrgName = (userData.organization_name as string) || '';

    // Get organizations from login-complete
    let organizations: any[] = [];
    if (userData.organizations_json) {
      try {
        const orgsData = JSON.parse(userData.organizations_json as string);
        organizations = orgsData.map((org: any) => ({
          id: org.id,
          name: org.name || org.attributes?.name || '',
          full_name: org.full_name || org.attributes?.full_name || '',
        }));
      } catch {
        logger.warn('[matchOrgAndSelectEntityTool] Failed to parse organizations_json');
      }
    }

    if (organizations.length === 0) {
      return {
        success: false,
        error: 'No organizations found. Please complete login first.',
      };
    }

    // Match signup org name with organizations (partial match)
    const normalizeName = (name: string) => name.toLowerCase().trim().replace(/[^\w\s]/g, '');
    const signupNormalized = normalizeName(signupOrgName);

    let matchedOrg: any = null;
    let matchType: 'exact' | 'partial' | 'none' = 'none';

    for (const org of organizations) {
      const orgNormalized = normalizeName(org.name);
      if (orgNormalized === signupNormalized) {
        matchedOrg = org;
        matchType = 'exact';
        break;
      } else if (orgNormalized.includes(signupNormalized) || signupNormalized.includes(orgNormalized)) {
        if (!matchedOrg || matchType === 'none') {
          matchedOrg = org;
          matchType = 'partial';
        }
      }
    }

    // Get jwt_token for API calls
    const { getChocoAuthToken } = await import('../helpers/getChocoAuthToken');
    const authToken = await getChocoAuthToken(conversation.userId, flowId, true);

    if (!authToken) {
      return {
        success: false,
        error: 'Authentication token not found. Please complete login first.',
      };
    }

    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;

    // Get entities for all organizations
    const orgsWithEntities: Array<{ org: any; entities: any[] }> = [];

    for (const org of organizations) {
      const orgId = String(org.id);
      let entities: any[] = [];

      try {
        const entitiesJson = userData[`entities_org_${orgId}`] as string;
        if (entitiesJson) {
          entities = JSON.parse(entitiesJson);
        } else {
          // Fetch entities if not in userData
          const entitiesEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/account/entities`;

          const requestInfo = {
            payload: {},
            meta: {
              method: 'GET',
              endpoint: entitiesEndpoint,
              providerMode: projectConfig.backendMode,
              headers: { Authorization: `Bearer ${authToken}` },
            },
          };

          const result = await trackApiCall(
            conversationId,
            projectConfig.backendMode === 'choco' ? 'ChocoAPI' : 'Mock',
            'listEntities',
            requestInfo,
            async () => {
              const entitiesResponse = await fetch(entitiesEndpoint, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${authToken}`,
                },
              });

              if (entitiesResponse.ok) {
                const entitiesData = await entitiesResponse.json();
                return { success: true, data: entitiesData };
              }
              const errorData = await entitiesResponse.json().catch(() => ({})) as any;
              return {
                success: false,
                error: errorData.error || `HTTP ${entitiesResponse.status}`,
                status: entitiesResponse.status,
              };
            },
          );

          if (result.success) {
            const entitiesData = result.data;
            entities = Array.isArray(entitiesData?.data) ? entitiesData.data : (entitiesData?.data ? [entitiesData.data] : []);
            // Save to userData using standardized key
            await flowHelpers.setUserData(conversation.userId, flowId, {
              [`entities_org_${orgId}`]: JSON.stringify(entities),
            }, conversationId);
          }
        }
      } catch (error: any) {
        logger.warn(`[matchOrgAndSelectEntityTool] Failed to get entities for org ${orgId}:`, error.message);
      }

      orgsWithEntities.push({ org, entities });
    }

    // Determine if user needs to select organization
    const needsOrgSelection = organizations.length > 1 && (matchType === 'none' || matchType === 'partial');

    // If exact match and single org, use that org
    if (!needsOrgSelection && matchedOrg) {
      const selectedOrg = matchedOrg;
      const selectedOrgEntities = orgsWithEntities.find((o) => o.org.id === selectedOrg.id)?.entities || [];

      return {
        success: true,
        data: {
          selectedOrgId: String(selectedOrg.id),
          selectedOrgName: selectedOrg.name,
          matchType,
          entities: selectedOrgEntities.map((e: any) => ({
            id: e.id || e.attributes?.id,
            name: e.attributes?.name || e.name || '',
            tax_id: e.attributes?.tax_id || e.tax_id || '',
          })),
          hasEntities: selectedOrgEntities.length > 0,
          needsEntitySelection: selectedOrgEntities.length > 0,
          // Explicitly guide LLM if no entities or user wants new one
          needsEntityCreation: selectedOrgEntities.length === 0,
          // Suggest fields to ask if creating new entity
          newEntityFields: ['entity_name', 'entity_tax_id', 'entity_country', 'entity_address_line_1', 'entity_city', 'entity_zip'],
        },
        saveResults: {
          selected_org_id: String(selectedOrg.id),
          selected_org_name: selectedOrg.name,
          has_existing_entities: selectedOrgEntities.length > 0,
        },
      };
    }

    // Multiple orgs or no match - return all orgs with their entities
    return {
      success: true,
      data: {
        needsOrgSelection: true,
        organizations: organizations.map((org) => ({
          id: String(org.id),
          name: org.name,
          full_name: org.full_name,
          entities: orgsWithEntities.find((o) => o.org.id === org.id)?.entities.map((e: any) => ({
            id: e.id || e.attributes?.id,
            name: e.attributes?.name || e.name || '',
            tax_id: e.attributes?.tax_id || e.tax_id || '',
          })) || [],
        })),
        signupOrgName,
        matchType,
        matchedOrg: matchedOrg ? { id: String(matchedOrg.id), name: matchedOrg.name } : null,
      },
    };
  } catch (error: any) {
    logger.error('[matchOrgAndSelectEntityTool] Error:', error);
    return {
      success: false,
      error: error?.message || 'Failed to match organization and select entity',
    };
  }
};

/**
 * Checks organizations, gateways, and entities after login
 * This should be called at the start of KYC flow to determine what needs to be set up
 */
export const checkOrgSetupTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get flowId
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get userData to check organizations, gateways, entities from login-complete
    const userData = await flowHelpers.getUserData(conversation.userId, flowId);

    // Get organizations from userData (saved by login-complete)
    let organizations: any[] = [];
    if (userData.organizations_json) {
      try {
        organizations = JSON.parse(userData.organizations_json as string);
      } catch {
        logger.warn('[checkOrgSetupTool] Failed to parse organizations_json');
      }
    }

    // If no organizations in userData, try to get from org_customer_id
    if (organizations.length === 0 && userData.org_customer_id) {
      organizations = [{ id: userData.org_customer_id }];
    }

    // If still no organizations, check if we have org_id from signup
    if (organizations.length === 0 && userData.org_id) {
      organizations = [{ id: userData.org_id }];
    }

    logger.info('[checkOrgSetupTool] Found organizations', {
      count: organizations.length,
      orgIds: organizations.map((o: any) => o.id || o),
    });

    // If more than 1 organization, we can't auto-proceed (user needs to select)
    if (organizations.length > 1) {
      return {
        success: true,
        data: {
          hasMultipleOrgs: true,
          orgCount: organizations.length,
          organizations: organizations.map((o: any) => ({
            id: o.id || o,
            name: o.attributes?.name || o.name,
          })),
        },
      };
    }

    // If no organizations, return graceful failure so flow can handle it (e.g. ask for org name)
    if (organizations.length === 0) {
      return {
        success: true,
        data: {
          hasOrganizations: false,
          needsOrganization: true,
          needsEntity: true,
          needsGateway: true,
          hasEntities: false,
          canUseExistingGateway: false,
          // If we have an organization name in userData (from signup), pass it along
          potentialOrgName: userData.organization_name,
        },
      };
    }

    // Single organization - proceed to check gateways and entities
    const orgId = organizations[0].id || organizations[0];
    const orgCustomerId = String(orgId);

    // Get jwt_token for API calls
    const { getChocoAuthToken } = await import('../helpers/getChocoAuthToken');
    const authToken = await getChocoAuthToken(conversation.userId, flowId, true);

    if (!authToken) {
      return {
        success: false,
        error: 'Authentication token not found. Please complete login first.',
      };
    }

    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;

    // Check gateways for this organization
    let gateways: any[] = [];
    try {
      const gatewaysJson = userData[`gateways_org_${orgCustomerId}`] as string;
      if (gatewaysJson) {
        gateways = JSON.parse(gatewaysJson);
      } else {
        // Fetch gateways if not in userData
        const gatewaysEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgCustomerId}/gateways`;

        const requestInfo = {
          payload: {},
          meta: {
            method: 'GET',
            endpoint: gatewaysEndpoint,
            providerMode: projectConfig.backendMode,
            headers: { Authorization: `Bearer ${authToken}` },
          },
        };

        const result = await trackApiCall(
          conversationId,
          projectConfig.backendMode === 'choco' ? 'ChocoAPI' : 'Mock',
          'checkGateways',
          requestInfo,
          async () => {
            const gatewaysResponse = await fetch(gatewaysEndpoint, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
            });

            if (gatewaysResponse.ok) {
              const gatewaysData = await gatewaysResponse.json();
              return { success: true, data: gatewaysData };
            }
            const errorData = await gatewaysResponse.json().catch(() => ({})) as any;
            return {
              success: false,
              error: errorData.error || `HTTP ${gatewaysResponse.status}`,
              status: gatewaysResponse.status,
            };
          },
        );

        if (result.success && result.data?.data) {
          gateways = result.data.data;
          // Save to userData
          await flowHelpers.setUserData(conversation.userId, flowId, {
            [`gateways_org_${orgCustomerId}`]: JSON.stringify(gateways),
          }, conversationId);
        }
      }
    } catch (error: any) {
      logger.warn(`[checkOrgSetupTool] Failed to get gateways for org ${orgCustomerId}:`, error.message);
    }

    // Check entities for this organization
    let entities: any[] = [];
    try {
      const entitiesJson = userData[`entities_org_${orgCustomerId}`] as string;
      if (entitiesJson) {
        entities = JSON.parse(entitiesJson);
      } else {
        // Fetch entities if not in userData
        const entitiesEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgCustomerId}/account/entities`;

        const requestInfo = {
          payload: {},
          meta: {
            method: 'GET',
            endpoint: entitiesEndpoint,
            providerMode: projectConfig.backendMode,
            headers: { Authorization: `Bearer ${authToken}` },
          },
        };

        const result = await trackApiCall(
          conversationId,
          projectConfig.backendMode === 'choco' ? 'ChocoAPI' : 'Mock',
          'checkEntities',
          requestInfo,
          async () => {
            const entitiesResponse = await fetch(entitiesEndpoint, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
            });

            if (entitiesResponse.ok) {
              const entitiesData = await entitiesResponse.json();
              return { success: true, data: entitiesData };
            }
            const errorData = await entitiesResponse.json().catch(() => ({})) as any;
            return {
              success: false,
              error: errorData.error || `HTTP ${entitiesResponse.status}`,
              status: entitiesResponse.status,
            };
          },
        );

        if (result.success && result.data?.data) {
          entities = Array.isArray(result.data.data) ? result.data.data : (result.data.data ? [result.data.data] : []);
          // Save to userData
          await flowHelpers.setUserData(conversation.userId, flowId, {
            [`entities_org_${orgCustomerId}`]: JSON.stringify(entities),
          }, conversationId);
        }
      }
    } catch (error: any) {
      logger.warn(`[checkOrgSetupTool] Failed to get entities for org ${orgCustomerId}:`, error.message);
    }

    // Save org_customer_id if not already saved
    if (!userData.org_customer_id) {
      await flowHelpers.setUserData(conversation.userId, flowId, {
        org_customer_id: orgCustomerId,
      }, conversationId);
    }

    logger.info('[checkOrgSetupTool] Check complete', {
      orgId: orgCustomerId,
      gatewayCount: gateways.length,
      entityCount: entities.length,
    });

    return {
      success: true,
      data: {
        hasMultipleOrgs: false,
        orgId: orgCustomerId,
        orgName: organizations[0].attributes?.name || organizations[0].name,
        hasGateways: gateways.length > 0,
        gateways,
        hasEntities: entities.length > 0,
        entities,
        // Determine next step
        needsEntity: entities.length === 0,
        needsGateway: gateways.length === 0,
        canUseExistingGateway: gateways.length > 0,
      },
      saveResults: {
        org_customer_id: orgCustomerId,
        [`gateways_org_${orgCustomerId}`]: JSON.stringify(gateways),
        [`entities_org_${orgCustomerId}`]: JSON.stringify(entities),
      },
    };
  } catch (error: any) {
    logger.error('[checkOrgSetupTool] Error:', error);
    return {
      success: false,
      error: error?.message || 'Failed to check organization setup',
    };
  }
};

// --- KYC Payment Gateway Discovery Logic ---

export const handleGatewayDiscoveryTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const { logger } = await import('../../../../utils/logger');
    const { flowHelpers } = await import('../../flowHelpers');
    const { prisma } = await import('../../../../core/prisma');

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });
    if (!conversation?.userId) throw new Error('User not found');

    // Resolve flowId for correct userData access (avoid using slug strings).
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    const userData = await flowHelpers.getUserData(conversation.userId, flowId);

    // Check if user has existing gateway
    // The prompt extracts has_existing_gateway (boolean) or gateway_providers (string)
    // If providers is present and not empty, has_existing is likely true
    const providersRaw = (payload.gateway_providers as string) || (userData.gateway_providers as string) || '';
    const providers = (() => {
      const raw = String(providersRaw || '').trim();
      const lower = raw.toLowerCase();
      if (!raw) return '';
      if (['null', 'none', 'undefined', 'n/a', 'na'].includes(lower)) return '';
      // Guard against the model returning the field slug or generic words.
      if (['gateway_providers', 'has_existing_gateway', 'retry', 'again', 'yes', 'no'].includes(lower)) return '';
      return raw;
    })();

    const hasExisting = payload.has_existing_gateway === true || payload.has_existing_gateway === 'true';

    // Correction: If user mentioned a *real* provider, it's ambiguous.
    // Spec: If user input confirms NO existing gateway, we should trust hasExisting=false.
    // The provider name is likely a preference for the new gateway (handled in Branch 2).
    /*
    if (!hasExisting && providers) {
      const p = providers.toLowerCase();
      const looksLikeRealProvider = ['stripe', 'meshulam', 'grow', 'cardcom', 'paypal', 'authorize'].some((k) => p.includes(k));
      if (looksLikeRealProvider) {
        hasExisting = true;
      }
    }
    */

    // Branch 1: Has Gateway -> Email logic
    if (hasExisting) {
      // If they said "Yes" but didn't give a name, we assume the prompt loop handles it or we default
      const providerName = providers || 'your provider';

      // Mock Email
      const msg = `Ok, I'll email ${providerName} a request for the payment gateway details and will cc you.`;
      logger.info(`[handleGatewayDiscoveryTool] Mocking email to ${providerName} for user ${conversation.userId}`);

      return {
        success: true,
        data: { action: 'email_sent', provider: providerName },
        saveResults: {
          gateway_existing_provider: providerName,
        },
        message: msg,
      };
    }

    // Branch 2: No Gateway -> API logic
    const normalizeCountry = (raw: unknown): string => {
      const s = typeof raw === 'string' ? raw.trim() : '';
      if (!s) return '';
      const lower = s.toLowerCase();
      // Treat common "null-ish" strings (including weird artifacts like ": null") as missing
      if (['null', 'none', 'undefined', 'n/a', 'na', '-', ': null', ':null'].includes(lower)) return '';
      if (/^:?\s*null$/i.test(s)) return '';
      // Hebrew country value
      if (s.includes('ישראל')) return 'IL';
      if (lower === 'israel' || lower === 'il' || lower === 'isr') return 'IL';
      if (lower === 'us' || lower === 'usa' || lower === 'united states') return 'US';
      // If already looks like ISO alpha-2
      if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase();
      return s;
    };

    const phone = String(userData.phone || payload.phone || '').trim();
    const inferredByPhone = phone.startsWith('+972') || /^0\d{8,10}$/.test(phone.replace(/\D/g, ''));
    const inferredByRegion = String(userData.lookup_preferred_region || '').toLowerCase() === 'israel';
    const countryNormalized = normalizeCountry(userData.entity_country);
    const effectiveCountry = countryNormalized || (inferredByPhone || inferredByRegion ? 'IL' : 'IL');

    // Prefer explicit user selection when provided.
    const providersLower = providers.toLowerCase();
    let gatewayType: 'stripe' | 'grow' = 'stripe';
    if (providersLower.includes('meshulam') || providersLower.includes('grow')) {
      gatewayType = 'grow';
    } else if (providersLower.includes('stripe')) {
      gatewayType = 'stripe';
    } else if (effectiveCountry === 'IL') {
      gatewayType = 'grow';
    }

    logger.info('[handleGatewayDiscoveryTool] User needs new gateway.', {
      conversationId,
      entityCountry: userData.entity_country,
      effectiveCountry,
      phonePrefix: phone ? phone.slice(0, 4) : '',
      selected: gatewayType,
    });

    // Call the Add Gateway Logic
    const { addPaymentGatewayTool } = await import('./addPaymentGatewayTool');

    // Construct payload for addPaymentGatewayTool
    const idCandidate = (userData.entity_id as string) ||
      (userData.built_entity_id as string) ||
      (payload.entity_id as string);

    // Validate ID
    const entityId = (idCandidate && idCandidate !== ':' && idCandidate !== 'null' && idCandidate !== 'undefined') ? idCandidate : '';

    if (!entityId) throw new Error('Entity ID not found. Cannot create gateway setup link.');

    const orgId = (userData.single_org_id as string) ||
      (userData.org_id as string) ||
      (userData.org_customer_id as string);

    const normalizeIsraeliLocalPhone = (raw: unknown): string | null => {
      const digits = String(raw || '').replace(/\D/g, '');
      if (!digits) return null;
      let d = digits;
      // Convert international forms to local: 9725XXXXXXXX -> 05XXXXXXXX
      if (d.startsWith('972')) d = `0${d.slice(3)}`;
      // If user typed without leading 0 (e.g., 502440556), normalize to 0502440556
      if (!d.startsWith('0') && d.length === 9 && d.startsWith('5')) d = `0${d}`;
      // Accept 9-10 digits total: 0 + 8/9 digits
      if (!/^0\d{8,9}$/.test(d)) return null;
      return d;
    };

    const addPayload = {
      gateway_type: gatewayType,
      org_id: orgId,
      entity_id: entityId,
      currency: gatewayType === 'grow' ? 'ILS' : 'USD',
      new_user_business_number: userData.entity_tax_id as string,
      // Meshulam/Grow requires Israeli local format (no +972).
      // Use user-provided local phone when available; otherwise normalize userData.phone.
      new_user_phone: gatewayType === 'grow'
        ? (userData.meshulam_phone_local as string) || (normalizeIsraeliLocalPhone(userData.phone) || '')
        : (userData.phone as string),
    };

    // If we're in Israel/Grow flow and we still don't have a valid local phone, ask for it.
    if (gatewayType === 'grow' && (!addPayload.new_user_phone || !normalizeIsraeliLocalPhone(addPayload.new_user_phone))) {
      return {
        success: false,
        errorCode: 'MESHULAM_INVALID_PHONE',
        error: 'Need an Israeli phone number in local format (no +972). Example: 0502440556',
      };
    }

    let result = await addPaymentGatewayTool(addPayload, { conversationId });

    // Smart fallback: if Stripe isn't eligible but user is Israeli, retry once with Grow/Meshulam.
    if (!result.success && gatewayType === 'stripe') {
      const err = String(result.error || '');
      const shouldFallbackToGrow = effectiveCountry === 'IL' &&
        /not available for stripe/i.test(err);

      if (shouldFallbackToGrow) {
        logger.warn('[handleGatewayDiscoveryTool] Stripe not available; retrying with Grow/Meshulam', {
          conversationId,
          entityId,
          orgId,
          error: err,
        });
        gatewayType = 'grow';
        const retryPayload = {
          ...addPayload,
          gateway_type: 'grow',
          currency: 'ILS',
        };
        result = await addPaymentGatewayTool(retryPayload, { conversationId });
      }
    }

    if (!result.success) {
      const errMsg = String(result.error || '');
      const errorCode = (result as any).errorCode as string | undefined;
      const looksLikeBusinessError = /מספר עסק לא תקין|business number|tax id/i.test(errMsg);
      const looksLikePhoneError = /מספר הטלפון שהוכנס אינו תקין|טלפון|phone/i.test(errMsg);

      let finalErrorCode = errorCode;
      if (!finalErrorCode) {
        if (looksLikePhoneError) finalErrorCode = 'MESHULAM_INVALID_PHONE';
        if (looksLikeBusinessError) finalErrorCode = 'INVALID_BUSINESS_NUMBER';
      }

      return {
        success: false,
        errorCode: finalErrorCode,
        error: looksLikePhoneError
          ? 'The phone number was rejected by the provider. Please provide an Israeli phone in local format (no +972), e.g. 0502440556'
          : (result.error || 'Failed to generate gateway setup link.'),
      };
    }

    // Extract URL
    const attributes = result.data?.gateway?.data?.attributes || {};
    // Check known fields for URL
    const url = attributes.url ||
      attributes.redirect_url ||
      attributes.onboarding_url ||
      attributes.link;

    if (!url || String(url).trim() === '') {
      return {
        success: false,
        errorCode: 'MISSING_GATEWAY_SETUP_URL',
        error: 'I didn’t receive the setup link from the API. Please say "retry" or provide an Israeli phone (local format, no +972) so I can try again.',
      };
    }

    const msg = `Please fill in the form here to set up your ${gatewayType === 'grow' ? 'Grow (Meshulam)' : 'Stripe'} account: ${url}\nOnce you complete it, tell me and I’ll help you connect it in Choco.`;

    return {
      success: true,
      data: { action: 'gateway_link', url, gatewayType },
      saveResults: {
        gateway_setup_url: url,
        // Alias: protects against accidental template typos in generated copy.
        gatewaysetupurl: url,
        gateway_selected_type: gatewayType,
        gateway_selected_label: gatewayType === 'grow' ? 'Grow' : 'Stripe',
      },
      message: msg,
    };

  } catch (err: any) {
    return { success: false, error: err.message || 'Error in Gateway Discovery' };
  }
};
