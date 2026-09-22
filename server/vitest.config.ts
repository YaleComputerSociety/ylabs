import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    // Fences every suite off from a local `server/.env` and from a reachable
    // search index, so a run reads the same environment CI reads and can never
    // touch a live backend (#2966). See src/test/hermeticEnvironment.ts.
    setupFiles: ['src/test/hermeticEnvironment.ts'],
    globals: false,
    testTimeout: 10000,
    // Over a hundred suites start a MongoMemory server in `beforeAll` and stop it in
    // `afterAll`. Under full-suite parallel load that teardown outlasts vitest's 10000 ms
    // default hook budget, so the budget is owned here and every suite inherits it (#2903).
    hookTimeout: 60000,
  },
});
