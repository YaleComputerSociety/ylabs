import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';

/**
 * The launch budget for an in-memory MongoDB, owned centrally because 143 suites
 * start one and none of them set it.
 *
 * `mongodb-memory-server` gives a starting instance 10 seconds and then throws
 * `Instance failed to start within 10000ms`. That budget is the library's own and is
 * unrelated to vitest's: #2903 already raised `hookTimeout` to 60000 for the same
 * reason, which fixed the half of the problem vitest owns and left this half at its
 * default. Under full-suite parallel load a launch routinely exceeds 10 seconds, so a
 * `beforeAll` fails, and the failure is never reported as what it is:
 *
 *   - the suite's `afterAll` then calls `stop()` on the instance it never assigned,
 *     which reports `Cannot read properties of undefined (reading 'stop')`;
 *   - its tests run without a connection and report `Test timed out in 10000ms`;
 *   - its `beforeEach` cleanup never ran, so a later test reports a duplicate-key
 *     error on a row it did not insert.
 *
 * Measured over one `src/models src/scripts` run: 11 suites failed, carrying 9 launch
 * failures, 9 test timeouts, 4 `stop()`-of-undefined errors and 2 duplicate-key
 * errors. Every one of them passes in isolation, so each reads to the next person as
 * "my change broke this".
 *
 * This is deliberately a wrapper on the two static factories rather than a per-suite
 * option. The alternative is the same argument repeated in 143 files, where the next
 * new suite omits it and the class comes back.
 */
const LAUNCH_BUDGET_MS = 120000;

type ServerOptions = NonNullable<Parameters<typeof MongoMemoryServer.create>[0]>;
type ReplSetOptions = NonNullable<Parameters<typeof MongoMemoryReplSet.create>[0]>;

const withServerLaunchBudget = (options?: ServerOptions): ServerOptions => ({
  ...options,
  instance: { launchTimeout: LAUNCH_BUDGET_MS, ...options?.instance },
});

/**
 * A replica set applies `instanceOpts[i]` to member `i` and starts any remaining
 * member with no base options at all, so the budget has to be spelled once per
 * member rather than once per set.
 */
const withReplSetLaunchBudget = (options?: ReplSetOptions): ReplSetOptions => {
  const provided = options?.instanceOpts ?? [];
  const members = Math.max(options?.replSet?.count ?? 1, provided.length, 1);
  return {
    ...options,
    instanceOpts: Array.from({ length: members }, (_unused, index) => ({
      launchTimeout: LAUNCH_BUDGET_MS,
      ...provided[index],
    })),
  };
};

export function applyMongoMemoryLaunchBudget(): void {
  const createServer = MongoMemoryServer.create.bind(MongoMemoryServer);
  MongoMemoryServer.create = ((options?: ServerOptions) =>
    createServer(withServerLaunchBudget(options))) as typeof MongoMemoryServer.create;

  const createReplSet = MongoMemoryReplSet.create.bind(MongoMemoryReplSet);
  MongoMemoryReplSet.create = ((options?: ReplSetOptions) =>
    createReplSet(withReplSetLaunchBudget(options))) as typeof MongoMemoryReplSet.create;
}

export const mongoMemoryLaunchBudgetForTest = {
  LAUNCH_BUDGET_MS,
  withServerLaunchBudget,
  withReplSetLaunchBudget,
};
