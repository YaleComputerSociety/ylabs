import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
    // Over a hundred suites start a MongoMemory server in `beforeAll` and stop it in
    // `afterAll`. Under full-suite parallel load that teardown outlasts vitest's 10000 ms
    // default hook budget, so the budget is owned here and every suite inherits it (#2903).
    hookTimeout: 60000,
  },
});
