/* eslint-disable no-console */
/**
 * Jest test setup file
 * Configures test environment and global test utilities
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.REDACT_SECRETS = 'true';
process.env.REQUEST_TIMEOUT_MS = '5000';

// Set default environment variables for unit tests
process.env.CHOCO_BASE_URL ??= 'https://api.chocoinsurance.com';
process.env.CHOCO_DASHBOARD_BASE ??= 'https://dashboardapi.chocoinsurance.com';
process.env.CHOCO_JWT ??= ''; // Unit tests shouldn't require a real JWT
process.env.CHOCO_CAPTCHA_TOKEN ??= 'dev-captcha-token';

// Mock console methods to avoid noise in tests
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console output during tests unless explicitly enabled
  if (!process.env.DEBUG_TESTS) {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

afterAll(() => {
  // Restore original console methods
  Object.assign(console, originalConsole);
});

// Global test utilities
(global as any).testUtils = {
  // Helper to create mock JWT token
  createMockJWT: () => 'mock_jwt_token_for_testing_12345',

  // Helper to create mock environment
  createMockEnv: () => ({
    CHOCO_BASE_URL: 'https://api.chocoinsurance.com',
    CHOCO_DASHBOARD_BASE: 'https://dashboardapi.chocoinsurance.com',
    CHOCO_JWT: 'mock_jwt_token_for_testing_12345',
    CHOCO_CAPTCHA_TOKEN: 'dev-captcha-token',
    REQUEST_TIMEOUT_MS: '5000',
    REDACT_SECRETS: 'true',
  }),
};

// Export test utilities for use in tests
export const testUtils = {
  // Helper to create mock JWT token
  createMockJWT: () => 'mock_jwt_token_for_testing_12345',

  // Helper to create mock environment
  createMockEnv: () => ({
    CHOCO_BASE_URL: 'https://api.chocoinsurance.com',
    CHOCO_DASHBOARD_BASE: 'https://dashboardapi.chocoinsurance.com',
    CHOCO_JWT: 'mock_jwt_token_for_testing_12345',
    CHOCO_CAPTCHA_TOKEN: 'dev-captcha-token',
    REQUEST_TIMEOUT_MS: '5000',
    REDACT_SECRETS: 'true',
  }),
};
