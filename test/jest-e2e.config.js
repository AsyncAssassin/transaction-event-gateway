module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/e2e-global-setup.ts',
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  maxWorkers: 1,
};
