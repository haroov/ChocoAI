import { ToolExecutor } from '../types';
import { config as envConfig, prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig, ProjectConfigData } from '../../../../utils/getProjectConfig';
import { flowHelpers } from '../../flowHelpers';

// performSendLoginOTP helper removed in favor of httpService

export const chocoLoginOTPTool: ToolExecutor = async (payload, { conversationId }) => {
  const { logger } = await import('../../../../utils/logger');
  logger.info(`[chocoLoginOTPTool] Starting login OTP send for conversation ${conversationId}`, { payload });

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: true, events: true, apiCalls: true },
    });
    if (!conversation) throw new Error('Conversation not found');

    const user = await prisma.user.findUnique({
      where: { id: conversation.userId || '' },
    });
    if (!user) throw new Error('User not found');

    // Get flowId from userFlow
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: user.id },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get email or phone from userData or payload
    const userData = await flowHelpers.getUserData(user.id, flowId);
    const loginIdentifier = (payload.login_identifier as string) || userData.login_identifier as string;
    let email = (payload.email as string) || (userData.email as string);
    let phone = (payload.phone as string) || (userData.phone as string);

    // If login_identifier is provided, check if it's email or phone
    if (loginIdentifier) {
      const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (emailPattern.test(loginIdentifier)) {
        email = loginIdentifier;
      } else {
        phone = loginIdentifier;
      }
    }

    if (!email && !phone) {
      return {
        success: false,
        error: 'Email or phone is required for login OTP',
      };
    }

    // Format phone if provided
    if (phone) {
      // Format phone for dashboard login API: "+972 50-244-0556" format (with space and dashes)
      // Remove all spaces and dashes first, then format correctly
      const cleanedPhone = phone.replace(/[\s-]+/g, '');
      if (cleanedPhone.startsWith('+972') && cleanedPhone.length === 13) {
        // Israeli number: +972XXXXXXXXX -> +972 50-244-0556
        const areaCode = cleanedPhone.substring(4, 6);
        const firstPart = cleanedPhone.substring(6, 9);
        const secondPart = cleanedPhone.substring(9, 13);
        phone = `+972 ${areaCode}-${firstPart}-${secondPart}`;
      } else if (cleanedPhone.startsWith('+1') && cleanedPhone.length === 12) {
        // US number: +1XXXXXXXXXX -> +1 (XXX) XXX-XXXX
        const areaCode = cleanedPhone.substring(2, 5);
        const firstPart = cleanedPhone.substring(5, 8);
        const secondPart = cleanedPhone.substring(8, 12);
        phone = `+1 (${areaCode}) ${firstPart}-${secondPart}`;
      }
      // For other formats, use as-is
    }

    // Log identifier format for debugging
    logger.info(`[chocoLoginOTPTool] Identifier from userData: email=${!!email}, phone=${!!phone}`);

    const projectConfig = await getProjectConfig();
    const endpoint = `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v1/login`;

    // Build requestInfo - payload format: {phone: "+972 50 244 0556", phone_code: "", phone_code_token: ""}
    // For email login, we still use phone field format but with email
    const requestPayload = phone
      ? { phone, phone_code: '', phone_code_token: '' }
      : { email, phone_code: '', phone_code_token: '' };

    const requestInfo = {
      payload: requestPayload,
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

    // Use trackApiCall exactly like signupTool (same pattern for logging to conversation details)
    return trackApiCall(
      conversationId,
      'ChocoAPI',
      'choco-login-otp',
      requestInfo,
      async () => {
        // Using httpService for the request
        const { httpService } = await import('../../../services/httpService');
        const { logger } = await import('../../../../utils/logger');

        logger.info('[chocoLoginOTPTool] Making API request', {
          endpoint,
          identifier: email || phone,
          type: email ? 'email' : 'phone',
          hasAuthHeader: !!requestInfo.meta.headers.Authorization,
          authHeaderPrefix: `${requestInfo.meta.headers.Authorization?.substring(0, 20)}...`,
        });

        const resResponse = await httpService.post(endpoint, requestPayload, {
          conversationId,
          operationName: 'Choco Login OTP',
          providerName: 'ChocoAPI',
          headers: requestInfo.meta.headers,
        });

        const data = await resResponse.json().catch(() => ({}));

        const res = {
          success: resResponse.ok,
          data,
          status: resResponse.status,
          error: resResponse.ok ? undefined : (data.error || `HTTP ${resResponse.status}`),
        };

        logger.info('[chocoLoginOTPTool] API response', {
          success: res.success,
          status: res.status,
          error: res.error,
          hasPhoneCodeToken: !!res.data?.data?.attributes?.phone_code_token,
        });

        if (res.success && res.data?.data?.attributes?.phone_code_token) {
          // Save phone_code_token to userData for later use
          const phoneCodeToken = res.data.data.attributes.phone_code_token;
          await flowHelpers.setUserData(user.id, flowId, {
            phone_code_token: phoneCodeToken,
          }, conversationId);

          logger.info('[chocoLoginOTPTool] Successfully sent login OTP, saved phone_code_token');
          return res;
        }

        // Check for specific "User not found" error
        // The API might return 400 or 404 with a message
        const errorMessage = res.error || (data.message as string) || '';
        // Common patterns for "user not found" in API responses
        // Adjust regex based on actual API response if known, otherwise generic "not found" check
        const isUserNotFound = /user not found|account not found|invalid phone|does not exist/i.test(errorMessage) || res.status === 404;

        logger.error('[chocoLoginOTPTool] Failed to send login OTP', {
          success: res.success,
          error: res.error,
          status: res.status,
          data: res.data,
          isUserNotFound,
        });

        // 401 Invalid Credentials -> PROBABLY_NOT_REGISTERED
        // This is a "guess" that the user is not registered.
        if (res.status === 401 && /invalid credentials/i.test(errorMessage)) {
          return {
            success: false,
            error: 'User probably not registered.',
            errorCode: 'PROBABLY_NOT_REGISTERED',
            status: res.status,
            data: res.data,
            inputPhone: phone, // Pass back for context if needed
          };
        }

        if (isUserNotFound) {
          return {
            success: false,
            error: 'User not found. Please register.',
            errorCode: 'USER_NOT_FOUND',
            status: res.status,
          };
        }

        return {
          success: false,
          // If 400 and generic error, it might still mean user not found if we are stricter
          // But purely relying on regex above for now.
          error: res.error || 'Failed to send login OTP',
          status: res.status || 400,
        };

      },
    );
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to send login OTP',
    };
  }
};
