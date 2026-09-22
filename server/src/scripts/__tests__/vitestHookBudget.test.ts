import { describe, expect, it } from 'vitest';

import vitestConfig from '../../../vitest.config';

/**
 * A MongoMemory replica set takes seconds to stop in isolation and far longer under
 * full-suite parallel load, so vitest's 10000 ms default hook budget turned suites red
 * whose every test passed (#2903). The budget is owned by the config rather than repeated
 * on each hook so that a new MongoMemory suite inherits it instead of re-learning this.
 */
const MONGO_MEMORY_TEARDOWN_BUDGET_MS = 60000;

describe('server vitest hook budget', () => {
  it('budgets every hook for a MongoMemory teardown under full-suite load', () => {
    expect(vitestConfig.test?.hookTimeout).toBeGreaterThanOrEqual(MONGO_MEMORY_TEARDOWN_BUDGET_MS);
  });
});
