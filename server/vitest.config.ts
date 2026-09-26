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
    // 110 suites already pass a per-test timeout of their own, which is the shape of a
    // budget that is too tight rather than of 110 unusually slow tests. An integration
    // suite driving a real in-memory replica set exceeds 10000 ms under full-suite
    // parallel load while being entirely healthy: one `src/models src/scripts` run
    // reported 6 test timeouts across 6 files with nothing actually broken, and every
    // one passed in isolation. Owned here for the same reason `hookTimeout` is, so a
    // suite inherits it rather than spelling it per test (#2903).
    testTimeout: 30000,
    // Over a hundred suites start a MongoMemory server in `beforeAll` and stop it in
    // `afterAll`. Under full-suite parallel load that teardown outlasts vitest's 10000 ms
    // default hook budget, so the budget is owned here and every suite inherits it (#2903).
    hookTimeout: 60000,
  },
});
