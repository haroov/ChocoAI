module.exports = {
  projects: [
    // ---------- UNIT ----------
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testMatch: ['<rootDir>/src/__tests__/unit/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      transformIgnorePatterns: ['/node_modules/(?!uuid)/'],
    },
    // ------- INTEGRATION -------
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testMatch: ['<rootDir>/src/__tests__/integration/**/*integration*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      transformIgnorePatterns: ['/node_modules/(?!uuid)/'],
    },
    // ----------- E2E -----------
    {
      displayName: 'e2e',
      preset: 'ts-jest',
      testMatch: ['<rootDir>/src/__tests__/e2e/**/*e2e*.test.ts', '<rootDir>/src/__tests__/e2e/system.test.ts'],
      globalSetup: '<rootDir>/test-e2e/globalSetup.ts',
      globalTeardown: '<rootDir>/test-e2e/globalTeardown.ts',
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      transformIgnorePatterns: ['/node_modules/(?!uuid)/'],
    },
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/index.ts',
    '!src/**/types.ts',
    '!src/test-setup.ts',
    '!src/__tests__/**',
    '!src/prompts/**',
    '!src/api/whatsapp-*.ts',
    '!src/api/flow-engine.ts',
    '!src/lib/__memory-integration.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 5,
      branches: 3,
      lines: 5,
      functions: 5,
    },
  },
  detectOpenHandles: true,
  forceExit: false,
};
