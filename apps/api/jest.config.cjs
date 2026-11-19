module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.cjs'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: true }],
  },
  clearMocks: true,
};
