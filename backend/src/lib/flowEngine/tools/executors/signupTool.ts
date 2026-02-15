import { ToolExecutor } from '../types';
import { config as envConfig, prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig, ProjectConfigData } from '../../../../utils/getProjectConfig';
import { getUserTimezone, formatCampaignDate } from '../../utils/dateTimeUtils';
import { OrganisationRegion } from '../../../../types/kycOrganisation';
import { getChocoAuthToken } from '../helpers/getChocoAuthToken';

// performSignup helper removed in favor of httpService

/**
 * Detects conversation language and returns ISO 639-1 language code
 */
async function detectConversationLanguage(conversationId: string): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { conversationId, role: 'user' },
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: { content: true },
  });

  if (messages.length === 0) return 'en';

  // Check if any user message contains Hebrew characters
  const hasHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));
  return hasHebrew ? 'he' : 'en';
}

/**
 * Gets organization country code based on organization data
 */
async function getOrganizationCountry(userId: string): Promise<string | null> {
  try {
    const userOrg = await prisma.userOrganisation.findFirst({
      where: { userId },
      include: { organisation: true },
    });

    if (userOrg?.organisation) {
      const { region } = userOrg.organisation;
      if (region === OrganisationRegion.Israel) {
        return 'IL';
      } else if (region === OrganisationRegion.USA) {
        return 'US';
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return null;
}

export const signupTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: true, events: true, apiCalls: true },
    });
    if (!conversation) throw new Error('Conversation not found');

    const user = await prisma.user.findUnique({
      where: { id: conversation.userId || '' },
      include: {
        UserOrganisation: {
          include: {
            organisation: true,
          },
        },
      },
    });
    if (!user) throw new Error('User not found');

    // Resolve flowId for consistent tool auth + persistence
    const currentUserFlow = await prisma.userFlow.findUnique({
      where: { userId: user.id },
      select: { flowId: true },
    });
    const flowId = currentUserFlow?.flowId;

    const verificationToken = crypto.randomUUID();
    await prisma.tokens.create({
      data: {
        type: 'email-verification',
        userId: user.id,
        value: verificationToken,
      },
    });
    // Choco API requires HTTPS URLs for webhooks and doesn't allow localhost
    // For local development, use the production webhook endpoint
    let webhookUrl = envConfig.rootUrl;
    if (webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) {
      // Use production webhook endpoint for localhost
      webhookUrl = 'https://www.chocoinsurance.com';
    } else if (webhookUrl.startsWith('http://')) {
      // For non-localhost HTTP URLs, convert to HTTPS
      webhookUrl = webhookUrl.replace('http://', 'https://');
    }
    payload.activation_webhook_url = `${webhookUrl}/api/v1/webhook/email-verified/${verificationToken}`;

    // Remove fields that Choco no longer accepts
    delete payload.password;
    delete payload.password_confirm;
    delete payload.term_approve;
    delete payload.accept_terms;

    // Get timezone based on channel and organization data
    const timezone = await getUserTimezone(
      conversationId,
      conversation.channel as 'web' | 'whatsapp',
      typeof (payload as any).clientTimezone === 'string' ? String((payload as any).clientTimezone) : undefined, // If provided from web widget
    );

    // IMPORTANT (Choco requirement):
    // meta must be a JSON-escaped string containing EXACTLY {"status":"new_ai_agent"}.
    // (It appears escaped in logs because it's a single string field in the JSON body.)
    payload.meta = JSON.stringify({ status: 'new_ai_agent' });

    // Tag is free text; use "test" for now (later: "ChocoAI").
    payload.tag = 'test';

    // Add required fields to payload
    // tax_id1 -> regNum
    if (payload.regNum) {
      payload.tax_id1 = payload.regNum;
    }

    // assigned_user_id = 0 (constant)
    payload.assigned_user_id = 0;

    // country - IL if Israeli org, US if US org, else use payload.country or userData.country
    const orgCountry = await getOrganizationCountry(user.id);
    if (orgCountry) {
      payload.country = orgCountry;
    } else {
      // Try to get country from payload or userData
      let { country } = payload;
      if (!country) {
        // Get from userData if available
        const userData = await prisma.userData.findMany({
          where: { userId: user.id },
          select: { key: true, value: true },
        });
        const countryData = userData.find((d) => d.key === 'country');
        if (countryData?.value) {
          country = countryData.value;
        }
      }

      if (country) {
        // Ensure it's in Alpha-2 format (uppercase, 2 characters)
        payload.country = String(country).toUpperCase().substring(0, 2);
      }
      // If no country found, leave it undefined (Choco API may handle this or require it)
    }

    // lang - based on conversation language detection
    const lang = await detectConversationLanguage(conversationId);
    payload.lang = lang;

    // org_account - "1" for nonprofit, null for donor
    // Prioritize payload (explicit LLM decision) over user.role
    let isNonprofit = false;

    if (payload.org_account === '1' || payload.is_nonprofit === true || payload.is_nonprofit === 'true') {
      isNonprofit = true;
    } else if (user.role === 'nonprofit') {
      isNonprofit = true;
    }

    if (isNonprofit) {
      payload.org_account = '1';
    } else {
      payload.org_account = null;
    }

    // timezone - the calculated timezone
    payload.timezone = timezone;

    // Sanitize Payload: whitelist only fields the API expects
    // This removes internal fields like __last_action_error_*, confirm_signup, etc.
    const allowedFields = [
      'tag', 'lang', 'meta', 'role', 'email', 'phone', 'timezone',
      'last_name', 'first_name', 'intent_type', 'learn_loops',
      'org_account', 'organization_name', 'country',
      'tax_id1', 'tax_id2', 'address', 'city', 'state', 'zip',
      'activation_webhook_url', 'raw_phone_country_hint',
      'is_non_profit', 'accept_marketing',
    ];

    const sanitizedPayload: Record<string, any> = {};
    for (const key of allowedFields) {
      if (payload[key] !== undefined) {
        sanitizedPayload[key] = payload[key];
      }
    }

    // Replace the original payload with the sanitized one
    // But keeps the reference as we might modify it later? No, let's just use sanitizedPayload for the request.
    const finalPayload = sanitizedPayload;

    // Build endpoint with org_account parameter
    // Build endpoint with org_account parameter
    // User requested URL: https://dashboardapi.chocoinsurance.com/orgarea/api/v1/signup?org_account=1
    // We append ?org_account=1 ONLY if it's a nonprofit account.
    const orgAccountParam = payload.org_account === '1' ? '?org_account=1' : '';

    const projectConfig = await getProjectConfig();
    const endpoint = `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v1/signup${orgAccountParam}`;

    const requestInfo = {
      payload: finalPayload,
      meta: {
        method: 'POST',
        endpoint,
        providerMode: 'Production',
        headers: {
          Authorization: envConfig.choco.captchaToken.startsWith('Bearer ')
            ? envConfig.choco.captchaToken
            : `Bearer ${envConfig.choco.captchaToken}`,
        },
      },
    };

    return trackApiCall(
      conversationId,
      'ChocoAPI',
      'signup',
      requestInfo,
      async () => {
        // Using httpService for the request
        const { httpService } = await import('../../../services/httpService');

        // Pre-login operation: use captcha token (service-to-service auth).
        const token = await getChocoAuthToken(user.id, flowId, false);

        // Actually - performSignup logic was:
        // headers: { Authorization: `Bearer ${token}` }

        // Let's rewrite the call properly:
        const signupResponse = await httpService.post(endpoint, finalPayload, {
          conversationId,
          operationName: 'Choco Signup',
          providerName: 'ChocoAPI',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!signupResponse.ok) {
          const errorData = await signupResponse.json().catch(() => ({})) as any;
          // Check for "already registered" error
          const errorMessage = String(errorData.error || '').toLowerCase();
          const isAlreadyRegistered = signupResponse.status === 409 ||
            errorMessage.includes('already registered') ||
            errorMessage.includes('phone number is already registered') ||
            errorMessage.includes('phone is already registered') ||
            errorMessage.includes('email is already registered');

          if (isAlreadyRegistered) {
            return {
              success: false,
              error: errorData.error || `HTTP ${signupResponse.status}`,
              status: signupResponse.status,
              errorCode: 'ALREADY_REGISTERED',
            };
          }

          return {
            success: false,
            error: errorData.error || `HTTP ${signupResponse.status}`,
            status: signupResponse.status,
          };
        }

        const data = await signupResponse.json();
        const res = { success: true, data, status: signupResponse.status };

        if (res.success) {
          await prisma.user.update({
            where: { id: user.id },
            data: { registered: true },
          });

          // Save organization data from response if available
          if (res.data?.id || res.data?.org_customer_id || res.data?.customer_id) {
            const orgCustomerId = res.data.id || res.data.org_customer_id || res.data.customer_id;
            // Get flowId from userFlow
            const userFlow = await prisma.userFlow.findUnique({
              where: { userId: user.id },
              select: { flowId: true },
            });
            const flowId = userFlow?.flowId || '';

            const { flowHelpers } = await import('../../flowHelpers');
            const { logger } = await import('../../../../utils/logger');

            // Save org data
            await flowHelpers.setUserData(user.id, flowId, {
              org_customer_id: String(orgCustomerId),
              org_id: String(orgCustomerId), // Also save as org_id for consistency
              organization_name: res.data?.name || res.data?.organization_name || payload.organization_name || '',
              signup_status: 'success',
            }, conversationId);

            logger.info('[signupTool] Saved organization data from signup response', {
              orgCustomerId,
              orgName: res.data?.name || payload.organization_name,
            });
          } else {
            // Even if no org ID, mark signup as attempted
            const userFlow = await prisma.userFlow.findUnique({
              where: { userId: user.id },
              select: { flowId: true },
            });
            const flowId = userFlow?.flowId || '';
            const { flowHelpers } = await import('../../flowHelpers');
            // Explicitly save the profile data we used for signup so it's available for KYC/Org Creation
            await flowHelpers.setUserData(user.id, flowId, {
              signup_status: 'success',
              phone: payload.phone,
              email: payload.email,
              first_name: payload.first_name,
              last_name: payload.last_name,
              organization_name: payload.organization_name || '',
            }, conversationId);
          }
        }
        return res;
      },
    );
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Signup failed',
    };
  }
};
