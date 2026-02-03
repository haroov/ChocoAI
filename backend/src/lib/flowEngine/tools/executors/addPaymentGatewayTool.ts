import { ToolExecutor } from '../types';
import { prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig } from '../../../../utils/getProjectConfig';
import { flowHelpers } from '../../flowHelpers';
import { getChocoAuthToken } from '../helpers/getChocoAuthToken';

/**
 * Adds a payment gateway (Grow/meshulam for Israel, Stripe for rest of world)
 *
 * For Grow (meshulam):
 * - Handles iterative process for new users
 * - Calls repeatedly until status is ok
 * - Verifies gateway was saved at the end
 *
 * Required fields: org_id, gateway_type, entity_id
 * For Grow new users: new_user_business_number, new_user_phone, new_user_quote
 */
export const addPaymentGatewayTool: ToolExecutor = async (payload, { conversationId }) => {
  const { logger } = await import('../../../../utils/logger');
  logger.info(`[addPaymentGatewayTool] Starting payment gateway setup for conversation ${conversationId}`, { payload });

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

    // Get organization ID and entity ID from payload or userData
    const userData = await flowHelpers.getUserData(user.id, flowId);
    const orgId = (payload.org_id as string) || (userData.org_id as string) || (userData.org_customer_id as string);
    const entityId = (payload.entity_id as string) || (userData.entity_id as string);

    const isValidId = (id: any) => {
      if (!id) return false;
      const s = String(id).trim();
      return s.length > 0 && s !== ':' && !['undefined', 'null', 'nan'].includes(s.toLowerCase());
    };

    if (!isValidId(orgId)) {
      return {
        success: false,
        error: `Invalid Organization ID "${orgId}". Please create or select an organization first.`,
      };
    }

    if (!isValidId(entityId)) {
      return {
        success: false,
        error: `Invalid Entity ID "${entityId}". Please create an entity first.`,
      };
    }

    // Get gateway type (meshulam/grow for Israel, stripe for rest)
    const gatewayType = (payload.gateway_type as string)?.toLowerCase() ||
      (payload.gateway as string)?.toLowerCase() ||
      (payload.gateway_provider as string)?.toLowerCase() ||
      (userData.gateway_type as string)?.toLowerCase();

    if (!gatewayType || (gatewayType !== 'meshulam' && gatewayType !== 'grow' && gatewayType !== 'stripe')) {
      return {
        success: false,
        error: 'Gateway type is required. Must be "meshulam"/"grow" (for Israel) or "stripe" (for rest of world).',
      };
    }

    // Normalize gateway name (meshulam and grow are the same)
    const gatewaySlug = gatewayType === 'grow' ? 'meshulam' : gatewayType;

    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;

    if (projectConfig.backendMode === 'mock') {
      // Mock response
      return {
        success: true,
        data: {
          gateway: {
            data: {
              type: '',
              attributes: {
                status: true,
                legal_entity_id: Number(entityId),
                currency: gatewayType === 'meshulam' ? 'ILS' : 'USD',
              },
            },
          },
          verified: true,
        },
      };
    }

    // For meshulam/grow, handle iterative process
    if (gatewaySlug === 'meshulam') {
      const normalizedPayload = {
        ...payload,
        // Accept flow-style keys too (services / campaignManagement)
        api_key: (payload.api_key as string) || (payload.gateway_api_key as string),
        user_id: (payload.user_id as string) || (payload.gateway_user_id as string),
        org_custom_id: (payload.org_custom_id as string) || (payload.gateway_org_custom_id as string),
      };
      return await handleMeshulamGateway(
        conversationId,
        baseUrl,
        orgId,
        entityId,
        jwtToken,
        normalizedPayload,
        userData,
        user.id,
        flowId,
      );
    }

    // For Stripe, simpler process
    const normalizedPayload = {
      ...payload,
      // Accept flow-style keys too
      api_key: (payload.api_key as string) || (payload.gateway_api_key as string),
      user_id: (payload.user_id as string) || (payload.gateway_user_id as string),
      org_custom_id: (payload.org_custom_id as string) || (payload.gateway_org_custom_id as string),
    };
    return await handleStripeGateway(
      conversationId,
      baseUrl,
      orgId,
      entityId,
      jwtToken,
      normalizedPayload,
      userData,
      user.id,
      flowId,
    );
  } catch (error: any) {
    const { logger } = await import('../../../../utils/logger');
    logger.error('[addPaymentGatewayTool] Error adding payment gateway:', error);
    return {
      success: false,
      error: error?.message || 'Failed to add payment gateway',
    };
  }
};

/**
 * Handles meshulam/grow gateway setup with iterative process for new users
 */
async function handleMeshulamGateway(
  conversationId: string,
  baseUrl: string,
  orgId: string,
  entityId: string,
  jwtToken: string,
  payload: any,
  userData: any,
  userId: string,
  flowId: string,
) {
  const { logger } = await import('../../../../utils/logger');
  const { trackApiCall } = await import('../../../../utils/trackApiCall');
  const { getProjectConfig } = await import('../../../../utils/getProjectConfig');

  const projectConfig = await getProjectConfig();
  const endpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateway/meshulam/add`;

  // Try to get user_id from various sources
  // 1. From payload
  // 2. From userData (saved from previous gateway calls)
  // 3. Try to extract from JWT token (user ID)
  let initialUserId = (payload.user_id as string) || (userData.gateway_user_id as string) || null;
  const initialApiKey = (payload.api_key as string) || (userData.gateway_api_key as string) || null;

  // If we don't have user_id, try to extract it from JWT token
  if (!initialUserId && jwtToken) {
    try {
      // JWT token format: base64 encoded JSON with 'id' field
      const parts = jwtToken.split('.');
      if (parts.length === 3) {
        const payloadPart = Buffer.from(parts[1], 'base64').toString('utf-8');
        const decoded = JSON.parse(payloadPart);
        if (decoded.id) {
          initialUserId = String(decoded.id);
          logger.info('[addPaymentGatewayTool] Extracted user_id from JWT token', { userId: initialUserId });
        }
      }
    } catch (e) {
      // If JWT decode fails, continue without user_id
      logger.warn('[addPaymentGatewayTool] Could not extract user_id from JWT token');
    }
  }

  // Fetch correct fields for new user registration
  const entityTaxId = (userData.entity_tax_id as string) || (userData.new_user_business_number as string) || '';
  const entityPhone = (userData.phone as string) || ''; // Use user's phone for new_user_phone

  const normalizeIsraeliLocalPhone = (raw: unknown): string => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    let d = digits;
    if (d.startsWith('972')) d = `0${d.slice(3)}`;
    // If user typed without leading 0 (e.g., 502440556), normalize to 0502440556
    if (!d.startsWith('0') && d.length === 9 && d.startsWith('5')) d = `0${d}`;
    // Keep only valid local formats for Meshulam (no +972).
    return /^0\d{8,9}$/.test(d) ? d : '';
  };

  // Construct payload focusing on "New User" flow as requested
  let currentPayload: any = {
    data: {
      attributes: {
        legal_entity_id: Number(entityId),
        currency: (payload.currency as string)?.toLowerCase() || 'ils',
        status: false,
        org_custom_id: (payload.org_custom_id as string) || '',
        fallback_phone: (payload.fallback_phone as string) || '',

        // Force new user flow
        new_user: true,
        new_user_business_number: /^\d+$/.test(payload.new_user_business_number as string)
          ? (payload.new_user_business_number as string)
          : entityTaxId,
        // Meshulam requires Israeli LOCAL phone format only (no +972).
        // Phone does NOT have to be the registration phone.
        new_user_phone: normalizeIsraeliLocalPhone(
          (payload.new_user_phone as string) ||
          (userData.meshulam_phone_local as string) ||
          entityPhone,
        ),
        new_user_quote: 'cc_bit', // Constant as requested

        // Ensure these are empty strings if not explicitly provided,
        // to match the "clean" payload structure
        user_id: '',
        api_key: '',
      },
    },
  };

  // Only include user_id and api_key if they have ACTUAL values (from previous successful attempts?),
  // but for the initial request, the user wants them empty/excluded.
  // The user's request explicitly showed them as empty strings in the "good" payload.
  // if (initialUserId && initialUserId.trim() !== '') {
  //   currentPayload.data.attributes.user_id = initialUserId;
  // }
  // if (initialApiKey && initialApiKey.trim() !== '') {
  //   currentPayload.data.attributes.api_key = initialApiKey;
  // }

  let attempts = 0;
  const maxAttempts = 10; // Prevent infinite loops
  let lastResponse: any = null;

  // Iterative process: keep calling until status is ok
  while (attempts < maxAttempts) {
    attempts++;
    logger.info(`[addPaymentGatewayTool] Meshulam attempt ${attempts}`, {
      new_user: currentPayload.data.attributes.new_user,
      status: currentPayload.data.attributes.status,
    });

    const response = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'add-meshulam-gateway',
      {
        payload: currentPayload,
        meta: {
          method: 'POST',
          endpoint,
          providerMode: 'choco',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        const apiResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
          body: JSON.stringify(currentPayload),
        });

        if (!apiResponse.ok) {
          const errorData = await apiResponse.json().catch(() => ({})) as any;
          // Do not throw: return the error object so the caller can extract onboarding links
          // (Meshulam sometimes returns a usable registration URL in the error message).
          return {
            error: errorData.error || errorData.message || `HTTP ${apiResponse.status}`,
          };
        }

        return await apiResponse.json();
      },
    );

    if (!response || response.error) {
      // Special handling for "Existing Process" error from Meshulam
      // Error msg: "ללקוח קיים תהליך הרשמה פתוח... https://..."
      const errorMsg = response?.error || '';
      const isPhoneError = /מספר הטלפון שהוכנס אינו תקין/i.test(errorMsg);
      const urlMatch = errorMsg.match(/(https?:\/\/[^\s]+)/);

      if (urlMatch && urlMatch[0]) {
        logger.info('[addPaymentGatewayTool] Found existing process link in error message');
        return {
          success: true,
          data: {
            gateway: {
              data: {
                attributes: {
                  url: urlMatch[0],
                  status: false, // It's not "active" yet, but we have the link
                },
              },
            },
            verified: false,
          },
        };
      }

      return {
        success: false,
        error: response?.error || 'Failed to add meshulam gateway',
        errorCode: isPhoneError ? 'MESHULAM_INVALID_PHONE' : undefined,
      };
    }

    lastResponse = response;
    const attributes = response.data?.attributes || {};

    // If status is ok, we're done
    if (attributes.status === true) {
      logger.info('[addPaymentGatewayTool] Meshulam gateway status is ok');
      break;
    }

    // If it's a new user and we have the required fields, populate and retry
    if (attributes.new_user === true) {
      const businessNumber = (payload.new_user_business_number as string) ||
        (userData.new_user_business_number as string);
      const phone = (payload.new_user_phone as string) ||
        (userData.new_user_phone as string) ||
        (userData.meshulam_phone_local as string) ||
        (userData.phone as string);
      const quote = (payload.new_user_quote as string) ||
        (userData.new_user_quote as string) ||
        'cc_bit'; // Default to 'cc_bit'

      const normalizedPhone = normalizeIsraeliLocalPhone(phone);

      if (businessNumber && normalizedPhone) {
        // Update payload with new user data, preserving user_id and api_key from response if present
        const updatedAttributes: any = {
          ...attributes, // Keep existing attributes from response (including user_id, api_key if present)
          new_user_business_number: businessNumber,
          new_user_phone: normalizedPhone,
          new_user_quote: quote,
        };

        // Only include user_id and api_key if they have values
        if (!updatedAttributes.user_id || updatedAttributes.user_id === '') {
          delete updatedAttributes.user_id;
        }
        if (!updatedAttributes.api_key || updatedAttributes.api_key === '') {
          delete updatedAttributes.api_key;
        }

        currentPayload = {
          data: {
            attributes: updatedAttributes,
          },
        };
        logger.info('[addPaymentGatewayTool] Retrying with new user data');
        continue;
      } else {
        // Need more information from user
        return {
          success: false,
          error: 'Meshulam setup needs a valid Israeli phone number in local format (no +972). Example: 0502440556',
          errorCode: 'MESHULAM_INVALID_PHONE',
          data: {
            response: lastResponse,
            requires: {
              new_user_business_number: !businessNumber,
              new_user_phone: !normalizedPhone,
              new_user_quote: !quote,
            },
          },
        };
      }
    }

    // If not new user and status is false, something went wrong
    if (attributes.status === false && attributes.new_user === false) {
      return {
        success: false,
        error: 'Failed to add meshulam gateway. Status remains false.',
        data: lastResponse,
      };
    }
  }

  if (attempts >= maxAttempts) {
    return {
      success: false,
      error: 'Maximum attempts reached for meshulam gateway setup',
      data: lastResponse,
    };
  }

  // Verify gateway was saved
  logger.info('[addPaymentGatewayTool] Verifying meshulam gateway was saved');
  const verifyResponse = await verifyGatewaySaved(conversationId, baseUrl, orgId, jwtToken, 'meshulam', entityId);

  // Save gateway data to userData
  if (verifyResponse.verified && verifyResponse.gateway) {
    const { gateway } = verifyResponse;
    await flowHelpers.setUserData(userId, flowId, {
      gateway_id: gateway.id,
      gateway_type: 'meshulam',
      gateway_status: gateway.attributes?.status ? 'true' : 'false',
      gateway_currency: gateway.attributes?.currency || 'ils',
      gateway_legal_entity_id: String(gateway.attributes?.legal_entity_id || entityId),
      gateway_user_id: gateway.attributes?.user_id || '',
      gateway_api_key: gateway.attributes?.api_key || '',
    }, conversationId);

    logger.info('[addPaymentGatewayTool] Saved gateway data to userData', {
      gatewayId: gateway.id,
      gatewayType: 'meshulam',
    });
  }

  return {
    success: true,
    data: {
      gateway: lastResponse,
      verified: verifyResponse.verified,
      verifiedGateway: verifyResponse.gateway,
    },
  };
}

/**
 * Handles Stripe gateway setup with custom account flow
 * 1. Get available entities
 * 2. Get Stripe account request fields for selected entity
 * 3. POST with required data
 */
async function handleStripeGateway(
  conversationId: string,
  baseUrl: string,
  orgId: string,
  entityId: string,
  jwtToken: string,
  payload: any,
  userData: any,
  userId: string,
  flowId: string,
) {
  const { logger } = await import('../../../../utils/logger');
  const { trackApiCall } = await import('../../../../utils/trackApiCall');

  // Step 1: Get available entities
  logger.info('[addPaymentGatewayTool] Step 1: Getting available entities for Stripe');
  const entitiesEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateway/stripe/custom/add/entities`;

  const entitiesResponse = await trackApiCall(
    conversationId,
    'ChocoAPI',
    'get-stripe-entities',
    {
      payload: {},
      meta: {
        method: 'GET',
        endpoint: entitiesEndpoint,
        providerMode: 'choco',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      },
    },
    async () => {
      const apiResponse = await fetch(entitiesEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json().catch(() => ({})) as any;
        throw new Error(errorData.error || errorData.message || `HTTP ${apiResponse.status}`);
      }

      return await apiResponse.json();
    },
  );

  if (!entitiesResponse || entitiesResponse.error) {
    return {
      success: false,
      error: entitiesResponse?.error || 'Failed to get available entities for Stripe',
    };
  }

  // Verify the requested entity is available
  // Response format: { data: [...] } where data is an array of entities
  const availableEntities = Array.isArray(entitiesResponse.data)
    ? entitiesResponse.data
    : (entitiesResponse.data ? [entitiesResponse.data] : []);

  const entityExists = availableEntities.some((ent: any) =>
    String(ent.id) === String(entityId) ||
    String(ent.attributes?.id) === String(entityId) ||
    String(ent.relationships?.available_legal_entity_list?.data?.[0]?.id) === String(entityId),
  );

  if (!entityExists && availableEntities.length > 0) {
    return {
      success: false,
      error: `Entity ${entityId} is not available for Stripe gateway setup`,
      data: {
        availableEntities: availableEntities.map((ent: any) => ({
          id: ent.id || ent.attributes?.id,
          name: ent.attributes?.name || ent.name,
        })),
      },
    };
  }

  // Step 2: Get Stripe account request fields
  logger.info('[addPaymentGatewayTool] Step 2: Getting Stripe account request fields');
  const requestFieldsEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateway/stripe/custom/add/entity/${entityId}`;

  const requestFieldsResponse = await trackApiCall(
    conversationId,
    'ChocoAPI',
    'get-stripe-request-fields',
    {
      payload: {},
      meta: {
        method: 'GET',
        endpoint: requestFieldsEndpoint,
        providerMode: 'choco',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      },
    },
    async () => {
      const apiResponse = await fetch(requestFieldsEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json().catch(() => ({})) as any;
        throw new Error(errorData.error || errorData.message || `HTTP ${apiResponse.status}`);
      }

      return await apiResponse.json();
    },
  );

  if (!requestFieldsResponse || requestFieldsResponse.error) {
    return {
      success: false,
      error: requestFieldsResponse?.error || 'Failed to get Stripe account request fields',
    };
  }

  // Extract required fields from response
  const requestData = requestFieldsResponse.data || {};
  const attributes = requestData.attributes || {};
  const relationships = requestData.relationships || {};
  const included = requestFieldsResponse.included || [];

  // Get available currencies
  const availableCurrencies = attributes.available_charge_currency_list || [];
  const selectedCurrency = (payload.currency as string)?.toLowerCase() ||
    (userData.gateway_currency as string)?.toLowerCase() ||
    'usd';

  if (availableCurrencies.length > 0 && !availableCurrencies.includes(selectedCurrency)) {
    return {
      success: false,
      error: `Currency ${selectedCurrency} is not available. Available currencies: ${availableCurrencies.join(', ')}`,
      data: {
        availableCurrencies,
        selectedCurrency,
      },
    };
  }

  // Get minimum required params (from included data)
  const minParamsCompany = included
    .filter((item: any) => relationships.stripe_min_params_company?.data?.some(
      (ref: any) => ref.id === item.id && ref.type === item.type,
    ))
    .map((item: any) => ({
      key: item.attributes?.key,
      value: item.attributes?.value,
      readonly: item.attributes?.readonly,
      visible: item.attributes?.visible,
    }));

  const minParamsIndividual = included
    .filter((item: any) => relationships.stripe_min_params_individual?.data?.some(
      (ref: any) => ref.id === item.id && ref.type === item.type,
    ))
    .map((item: any) => ({
      key: item.attributes?.key,
      value: item.attributes?.value,
      readonly: item.attributes?.readonly,
      visible: item.attributes?.visible,
    }));

  // Determine account type (company or individual) - default to company for nonprofits
  const accountType = (payload.stripe_account_type as string)?.toLowerCase() ||
    (userData.stripe_account_type as string)?.toLowerCase() ||
    'company';

  const minParams = accountType === 'individual' ? minParamsIndividual : minParamsCompany;

  // Build payload with required fields from user input
  // The POST payload should match the structure from GET but with populated values
  // Fallback to userData for standard fields to support collecting them via flow
  const apiPayload: any = {
    data: {
      type: 'stripe_custom_account_request',
      id: '0',
      attributes: {
        legal_entity_id: Number(entityId),
        country_code: (payload.country_code as string) || attributes.country_code || '',
        type: accountType || attributes.type || '',
        statement: (payload.statement as string) || (userData.statement as string) || attributes.statement || '',
        bank_account_currency: (payload.bank_account_currency as string) || (userData.bank_account_currency as string) || attributes.bank_account_currency || '',
        bank_account_number: (payload.bank_account_number as string) || (userData.bank_account_number as string) || attributes.bank_account_number || '',
        bank_account_routing_number: (payload.bank_account_routing_number as string) || (userData.bank_account_routing_number as string) || attributes.bank_account_routing_number || '',
        charge_currency_list: selectedCurrency ? [selectedCurrency] : null,
        available_charge_currency_list: availableCurrencies,
        available_currency_list: attributes.available_currency_list || null,
      },
    },
  };

  // Add minimum required params from payload (handle nested keys like "tos_acceptance.date")
  for (const param of minParams) {
    if (!param.readonly && param.key) {
      // Try multiple key formats: original, with underscores, with stripe_ prefix
      const payloadValue = payload[param.key] ||
        payload[param.key.replace(/\./g, '_')] ||
        payload[`stripe_${param.key.replace(/\./g, '_')}`] ||
        userData[`stripe_${param.key.replace(/\./g, '_')}`] ||
        userData[param.key.replace(/\./g, '_')]; // Also check without stripe_ prefix in userData

      if (payloadValue !== undefined && payloadValue !== null && payloadValue !== '') {
        // Handle nested keys like "tos_acceptance.date" or "legal_entity.personal_id_number"
        const keyParts = param.key.split('.');
        if (keyParts.length > 1) {
          // Create nested structure in attributes
          if (!apiPayload.data.attributes[keyParts[0]]) {
            apiPayload.data.attributes[keyParts[0]] = {};
          }
          apiPayload.data.attributes[keyParts[0]][keyParts[1]] = payloadValue;
        } else {
          // Flat key
          apiPayload.data.attributes[param.key] = payloadValue;
        }
      } else if (param.value && param.value !== '') {
        // Use default value from response if no user input
        const keyParts = param.key.split('.');
        if (keyParts.length > 1) {
          if (!apiPayload.data.attributes[keyParts[0]]) {
            apiPayload.data.attributes[keyParts[0]] = {};
          }
          apiPayload.data.attributes[keyParts[0]][keyParts[1]] = param.value;
        } else {
          apiPayload.data.attributes[param.key] = param.value;
        }
      }
    }
  }

  // VALIDATION: Check for missing fields before submitting
  const missingFields: string[] = [];
  const attrs = apiPayload.data.attributes;

  // Check top-level required fields (if not already present in attributes)
  if (!attrs.bank_account_number) missingFields.push('bank_account_number');
  if (!attrs.bank_account_routing_number) missingFields.push('bank_account_routing_number');
  if (!attrs.statement) missingFields.push('statement');
  // Currency is usually defaulted, but check if empty
  if (!attrs.bank_account_currency) missingFields.push('bank_account_currency');

  // Check minParams (dynamic required fields)
  for (const param of minParams) {
    if (!param.readonly && param.key) {
      const keyParts = param.key.split('.');
      let val;
      if (keyParts.length > 1) {
        val = attrs[keyParts[0]]?.[keyParts[1]];
      } else {
        val = attrs[param.key];
      }

      // If value is missing in the built payload
      if (val === undefined || val === null || val === '') {
        // Convert dotted key to underscore format for the prompt
        missingFields.push(`stripe_${param.key.replace(/\./g, '_')}`);
      }
    }
  }

  if (missingFields.length > 0) {
    logger.info('[addPaymentGatewayTool] Missing Stripe fields', { missingFields });
    // Join missing fields for the prompt string
    const missingFieldsStr = missingFields.join(', ');

    return {
      success: false,
      error: `Missing Stripe required fields: ${missingFieldsStr}`,
      errorCode: 'STRIPE_MISSING_FIELDS',
      data: {
        requires: missingFields.reduce((acc, field) => ({ ...acc, [field]: true }), {}),
        missing_fields: missingFieldsStr, // For prompt injection
      },
    };
  }

  // Step 3: POST with the required data
  logger.info('[addPaymentGatewayTool] Step 3: Submitting Stripe gateway data');
  const submitEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateway/stripe/custom/add/entity/${entityId}`;

  const response = await trackApiCall(
    conversationId,
    'ChocoAPI',
    'add-stripe-gateway',
    {
      payload: apiPayload,
      meta: {
        method: 'POST',
        endpoint: submitEndpoint,
        providerMode: 'choco',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      },
    },
    async () => {
      const apiResponse = await fetch(submitEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify(apiPayload),
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json().catch(() => ({})) as any;
        throw new Error(errorData.error || errorData.message || `HTTP ${apiResponse.status}`);
      }

      return await apiResponse.json();
    },
  );

  if (!response || response.error) {
    return {
      success: false,
      error: response?.error || 'Failed to add Stripe gateway',
      data: {
        requestFields: requestFieldsResponse,
      },
    };
  }

  // Verify gateway was saved
  logger.info('[addPaymentGatewayTool] Verifying Stripe gateway was saved');
  const verifyResponse = await verifyGatewaySaved(conversationId, baseUrl, orgId, jwtToken, 'stripe', entityId);

  // Save gateway data to userData
  if (verifyResponse.verified && verifyResponse.gateway) {
    const { gateway } = verifyResponse;
    await flowHelpers.setUserData(userId, flowId, {
      gateway_id: gateway.id,
      gateway_type: 'stripe',
      gateway_status: gateway.attributes?.status ? 'true' : 'false',
      gateway_currency: gateway.attributes?.currency || '',
      gateway_legal_entity_id: String(gateway.attributes?.legal_entity_id || entityId),
    }, conversationId);

    logger.info('[addPaymentGatewayTool] Saved gateway data to userData', {
      gatewayId: gateway.id,
      gatewayType: 'stripe',
    });
  }

  return {
    success: true,
    data: {
      gateway: response,
      verified: verifyResponse.verified,
      verifiedGateway: verifyResponse.gateway,
      requestFields: requestFieldsResponse, // Include for reference
    },
  };
}

/**
 * Verifies that a gateway was saved by fetching the gateways list
 */
async function verifyGatewaySaved(
  conversationId: string,
  baseUrl: string,
  orgId: string,
  jwtToken: string,
  gatewayType: string,
  entityId: string,
): Promise<{ verified: boolean; gateway?: any }> {
  const { logger } = await import('../../../../utils/logger');
  const { trackApiCall } = await import('../../../../utils/trackApiCall');

  const endpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateways`;

  try {
    const response = await trackApiCall(
      conversationId,
      'ChocoAPI',
      'verify-gateway-saved',
      {
        payload: {},
        meta: {
          method: 'GET',
          endpoint,
          providerMode: 'choco',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        },
      },
      async () => {
        const apiResponse = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwtToken}`,
          },
        });

        if (!apiResponse.ok) {
          const errorData = await apiResponse.json().catch(() => ({})) as any;
          throw new Error(errorData.error || errorData.message || `HTTP ${apiResponse.status}`);
        }

        return await apiResponse.json();
      },
    );

    if (!response || response.error) {
      logger.warn('[addPaymentGatewayTool] Failed to verify gateway', { error: response?.error });
      return { verified: false };
    }

    // Find the gateway in the list
    const gateways = response.data || [];
    const normalizedGatewayType = gatewayType === 'meshulam' ? 'meshulam' : gatewayType;

    const foundGateway = gateways.find((gw: any) => {
      const gwType = gw.attributes?.gateway || gw.type || '';
      const gwEntityId = gw.attributes?.legal_entity_id || gw.attributes?.entity_id;

      return (
        (gwType.toLowerCase().includes(normalizedGatewayType) ||
          gwType.toLowerCase().includes('grow')) &&
        (gwEntityId === Number(entityId) || gwEntityId === entityId)
      );
    });

    if (foundGateway) {
      logger.info('[addPaymentGatewayTool] Gateway verified successfully', {
        gatewayType,
        entityId,
        gatewayId: foundGateway.id,
      });
      return { verified: true, gateway: foundGateway };
    }

    logger.warn('[addPaymentGatewayTool] Gateway not found in verification list', {
      gatewayType,
      entityId,
      availableGateways: gateways.map((gw: any) => ({
        type: gw.attributes?.gateway || gw.type,
        entityId: gw.attributes?.legal_entity_id,
      })),
    });

    return { verified: false };
  } catch (error: any) {
    logger.error('[addPaymentGatewayTool] Error verifying gateway:', error);
    return { verified: false };
  }
}
