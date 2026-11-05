/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  // Tests run against a separate database (knowledge_test), never the demo data.
  globalSetup: '<rootDir>/tests/global-setup.ts',
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
};
