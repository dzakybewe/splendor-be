/**
 * @swc/jest strips types and emits CommonJS for the test run only. That keeps Jest off its
 * experimental ESM path entirely; the moduleNameMapper below rewrites the `.js` extensions
 * that NodeNext requires in our source imports back to extensionless specifiers for Jest.
 * Type checking is not Jest's job here — `npm run typecheck` does that.
 */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
        module: { type: 'commonjs' },
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
