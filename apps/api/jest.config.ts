import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(service|controller|guard|interceptor|pipe).ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@libertasian/types$': '<rootDir>/../../../packages/types/src/index.ts',
    // uuid@13 is ESM-only; ts-jest (TS files only) can't load it from
    // node_modules. Map to a crypto.randomUUID-backed shim for tests only —
    // the build and runtime resolve the real package.
    '^uuid$': '<rootDir>/testing/uuid-shim.ts',
  },
};

export default config;
