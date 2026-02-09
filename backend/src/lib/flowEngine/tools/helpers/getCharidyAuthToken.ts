import { flowHelpers } from '../../flowHelpers';
import { config as envConfig } from '../../../../core';

/**
 * Gets the appropriate Charidy API authentication token
 *
 * Authentication Strategy:
 * - Pre-login operations (signup, login-otp, verify-code): Use captchaToken (service-to-service auth)
 * - Post-login operations (all other tools): Use jwt_token from userData (user-specific auth)
 *
 * @param userId - User ID to check for jwt_token
 * @param flowId - Flow ID to check for jwt_token
 * @param useUserToken - Whether to use user's jwt_token (default: true for post-login operations)
 * @returns JWT token for Authorization header
 */
export async function getCharidyAuthToken(
  userId?: string | null,
  flowId?: string,
  useUserToken: boolean = true,
): Promise<string> {
  // For post-login operations, check for user-specific JWT token first
  if (useUserToken && userId && flowId) {
    const jwtToken = await flowHelpers.getJwtToken(userId, flowId);
    if (jwtToken) {
      return jwtToken;
    }
  }

  // Fall back to captchaToken for service-to-service authentication
  // This is used for pre-login operations (signup, login-otp, verify-code)
  // NOTE: This codebase currently stores the service-to-service captcha token under `config.choco.captchaToken`.
  // If Charidy-specific config is introduced later, this should be migrated.
  return envConfig.choco.captchaToken.startsWith('Bearer ')
    ? envConfig.choco.captchaToken.replace('Bearer ', '')
    : envConfig.choco.captchaToken;
}
