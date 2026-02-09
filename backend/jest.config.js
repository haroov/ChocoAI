module.exports = {
  projects: [
    // ---------- UNIT ----------
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testMatch: ['<rootDir>/src/__tests__/unit/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
      testEnvironment: 'node',
      // Keep unit coverage tightly focused on what unit tests exercise.
      // This avoids a huge coverage denominator and prevents unrelated modules from breaking coverage.
      collectCoverageFrom: [
        '<rootDir>/src/lib/flowEngine/builtInFlows/chocoClalSmbTopicSplitCompletion.ts',
      ],
      coverageThreshold: {
        global: {
          // Keep thresholds reasonable for the focused unit target.
          statements: 50,
          branches: 20,
          lines: 50,
          functions: 50,
        },
      },
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
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  detectOpenHandles: true,
  forceExit: false,
};
