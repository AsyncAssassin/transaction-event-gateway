module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts'],
};
