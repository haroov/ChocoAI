import { ToolExecutor } from '../types';
import { config as envConfig, prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { getProjectConfig, ProjectConfigData } from '../../../../utils/getProjectConfig';
import { flowHelpers } from '../../flowHelpers';

const performVerifyCode = async (
  config: ProjectConfigData,
  payload: { email?: string; code?: string; phone?: string; phone_code?: string; phone_code_token?: string },
  headers: Record<string, string>,
  endpoint: string,
) => {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers, // Headers may or may not include Authorization depending on verification type
      },
      body: JSON.stringify(payload),
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

    return {
      success: true,
      data,
      status: response.status,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      status: 0,
    };
  }
};

export const verifyCodeTool: ToolExecutor = async (payload, { conversationId }) => {
  const { logger } = await import('../../../../utils/logger');
  logger.info(`[verifyCodeTool] Starting verification for conversation ${conversationId}`, { payload });

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

    // Get flowId from userFlow (same pattern as signupTool)
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: user.id },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get data from payload or userData
    const userData = await flowHelpers.getUserData(user.id, flowId);
    const email = (payload.email as string) || (userData.email as string);
    const phone = (payload.phone as string) || (userData.phone as string);
    const code = (payload.code as string) || (payload.verification_code as string) || (payload.phone_code as string);
    const phoneCodeToken = (payload.phone_code_token as string) || (userData.phone_code_token as string);

    // Determine if this is a login verification (has phone_code_token) or signup verification (email/code)
    const isLoginVerification = !!phoneCodeToken;

    if (isLoginVerification) {
      // Login verification: requires phone, phone_code, and phone_code_token
      if (!phone) {
        return {
          success: false,
          error: 'Phone is required for login verification',
        };
      }
      if (!code) {
        return {
          success: false,
          error: 'Verification code (phone_code) is required',
        };
      }
      if (!phoneCodeToken) {
        return {
          success: false,
          error: 'phone_code_token is required for login verification',
        };
      }
    } else {
      // Signup verification: requires email and code
      if (!email) {
        return {
          success: false,
          error: 'Email is required for verification',
        };
      }
      if (!code) {
        return {
          success: false,
          error: 'Verification code is required',
        };
      }
    }

    const projectConfig = await getProjectConfig();

    // Login verification uses /login endpoint, signup uses /login/verify/code
    const endpoint = projectConfig.backendMode === 'choco'
      ? isLoginVerification
        ? `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v1/login`
        : `${projectConfig.chocoDashboardBaseUrl}/orgarea/api/v1/login/verify/code`
      : isLoginVerification
        ? 'mock:login-verify'
        : 'mock:verify-code';

    const requestPayload = isLoginVerification
      ? {
        phone,
        phone_code: code,
        phone_code_token: phoneCodeToken,
      }
      : {
        email,
        code,
      };

    // Build requestInfo exactly like signupTool (same structure for logging)
    const requestInfo = {
      payload: requestPayload,
      meta: {
        method: 'POST',
        endpoint,
        providerMode: projectConfig.backendMode,
        headers: isLoginVerification
          ? {
            // Login verification: No bearer token needed according to spec, but we'll include captchaToken for consistency
            'Content-Type': 'application/json',
          }
          : {
            Authorization: envConfig.choco.captchaToken.startsWith('Bearer ')
              ? envConfig.choco.captchaToken
              : `Bearer ${envConfig.choco.captchaToken}`,
          },
      },
    };

    // Use trackApiCall exactly like signupTool (same pattern for logging to conversation details)
    logger.info('[verifyCodeTool] Calling trackApiCall for verify-code', {
      endpoint,
      email: email ? `${email.substring(0, 3) }***` : 'email',
    });
    return trackApiCall(
      conversationId,
      projectConfig.backendMode === 'choco' ? 'ChocoAPI' : 'Mock',
      'verify-code',
      requestInfo,
      async () => {
        logger.info('[verifyCodeTool] Inside trackApiCall callback, making API request', {
          endpoint,
          isLoginVerification,
        });
        if (projectConfig.backendMode === 'mock') {
          // Mock verification - accept any 4-6 digit code
          const codeStr = String(code).trim();
          if (/^\d{4,6}$/.test(codeStr)) {
            if (isLoginVerification) {
              // Mock login verification response with jwt_token
              return {
                success: true,
                data: {
                  data: {
                    type: 'user',
                    id: '0',
                    attributes: {
                      jwt_token: `mock-jwt-token-${Date.now()}`,
                      exp_date: Math.floor(Date.now() / 1000) + 3600,
                      token: `mock-token-${Date.now()}`,
                      type: 'O',
                    },
                  },
                },
                status: 200,
              };
            }
            // Mock signup verification response with reset_token
            return {
              success: true,
              data: {
                approved: true,
                result: 'ok',
                reset_token: `mock-reset-token-${Date.now()}`,
              },
              status: 200,
            };

          }
          return {
            success: false,
            error: 'Invalid verification code',
            status: 400,
          };
        }

        // Call performVerifyCode with headers (which include Authorization with captchaToken)
        // Filter out undefined values to satisfy Record<string, string> type
        const headers: Record<string, string> = Object.fromEntries(
          Object.entries(requestInfo.meta.headers || {}).filter(([_, v]) => v !== undefined),
        ) as Record<string, string>;

        const res = await performVerifyCode(
          projectConfig,
          requestPayload,
          headers,
          endpoint,
        );

        // Handle successful verification
        if (res.success) {
          // API responses vary by endpoint:
          // - Login OTP verify (/login): { data: { attributes: { jwt_token } } } (legacy shape)
          // - Email/code verify (/login/verify/code): { data: { auth_token: { access_token, refresh_token, ... }, reset_token } }
          // We normalize both into userData.jwt_token (+ refresh/reset tokens when present).
          const accessTokenFromAuthToken = res.data?.data?.auth_token?.access_token
            || res.data?.auth_token?.access_token
            || res.data?.data?.attributes?.auth_token?.access_token;
          const refreshTokenFromAuthToken = res.data?.data?.auth_token?.refresh_token
            || res.data?.auth_token?.refresh_token
            || res.data?.data?.attributes?.auth_token?.refresh_token;
          const accessTokenExpDate = res.data?.data?.auth_token?.access_token_exp_date
            || res.data?.auth_token?.access_token_exp_date
            || res.data?.data?.attributes?.auth_token?.access_token_exp_date;
          const refreshTokenExpDate = res.data?.data?.auth_token?.refresh_token_exp_date
            || res.data?.auth_token?.refresh_token_exp_date
            || res.data?.data?.attributes?.auth_token?.refresh_token_exp_date;

          if (isLoginVerification) {
            // Login verification: Extract jwt_token from response
            // Response format: { data: { type: "user", id: "...", attributes: { jwt_token: "...", ... } } }
            const jwtToken = res.data?.data?.attributes?.jwt_token
              || res.data?.attributes?.jwt_token
              || accessTokenFromAuthToken;

            if (jwtToken) {
              // Save jwt_token to userData for use in subsequent authenticated API calls
              await flowHelpers.setUserData(user.id, flowId, {
                jwt_token: String(jwtToken),
              }, conversationId);
              logger.info('[verifyCodeTool] Successfully verified login code and saved jwt_token');
            } else {
              logger.warn('[verifyCodeTool] Login verification successful but jwt_token not found in response', {
                responseData: res.data,
              });
            }
          } else {
            // Signup verification: Extract reset_token AND jwt_token (access_token) when present
            const resetToken = res.data?.reset_token || res.data?.data?.reset_token;
            const jwtToken = accessTokenFromAuthToken;

            const saveResults: Record<string, unknown> = {};
            if (resetToken) saveResults.reset_token = String(resetToken);
            if (jwtToken) saveResults.jwt_token = String(jwtToken);
            if (refreshTokenFromAuthToken) saveResults.refresh_token = String(refreshTokenFromAuthToken);
            if (accessTokenExpDate) saveResults.access_token_exp_date = String(accessTokenExpDate);
            if (refreshTokenExpDate) saveResults.refresh_token_exp_date = String(refreshTokenExpDate);

            if (Object.keys(saveResults).length > 0) {
              await flowHelpers.setUserData(user.id, flowId, saveResults, conversationId);
              logger.info('[verifyCodeTool] Successfully verified signup code and saved tokens', {
                saved: Object.keys(saveResults),
              });
            } else {
              logger.warn('[verifyCodeTool] Signup verification successful but no tokens found in response', {
                responseData: res.data,
              });
            }
          }

          return res;
        }
        // Check for wrong code error
        const errorMessage = (res.error || '').toLowerCase();
        const isWrongCode = errorMessage.includes('incorrect') ||
          errorMessage.includes('doesn\'t match') ||
          errorMessage.includes('verification code is incorrect') ||
          errorMessage.includes('activation code is incorrect');

        // Verification failed - return error with status and errorCode
        return {
          success: false,
          error: res.error || 'Verification code is incorrect',
          status: res.status || 400,
          errorCode: isWrongCode ? 'WRONG_CODE' : undefined,
        };

      },
    );
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Verification failed',
    };
  }
};
