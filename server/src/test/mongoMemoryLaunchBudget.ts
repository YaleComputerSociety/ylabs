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

/**
 * A launch that lost a port race, and how many times it is worth trying again.
 *
 * `mongodb-memory-server` asks the OS for a free port, then starts `mongod` on it. Between
 * those two steps another process can take the port, and the library surfaces that as a
 * `StdoutInstanceError` reading `Port "57911" already in use`. Several sessions run suites and
 * ad-hoc scripts on this machine at once, so the race is ordinary rather than exotic (#3845).
 *
 * A retry is the right answer because the condition is transient and a fresh `create` asks for
 * a new port: nothing about the suite or the code changed. The bound matters as much as the
 * retry, because a port that is genuinely unavailable every time is a real failure and must
 * still be reported rather than looped over.
 *
 * Only this message retries. Any other launch failure, including the 120-second budget above
 * being exceeded, is rethrown untouched, so a slow machine still reports a slow machine.
 */
const PORT_ALREADY_IN_USE = /port\s+"?\d+"?\s+already in use/i;
const PORT_RACE_ATTEMPTS = 4;

function isPortRace(error: unknown): boolean {
  return PORT_ALREADY_IN_USE.test(error instanceof Error ? error.message : String(error));
}

async function retryingPortRace<T>(create: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await create();
    } catch (error) {
      if (attempt >= PORT_RACE_ATTEMPTS || !isPortRace(error)) throw error;
      // Visible on purpose: a silent retry would hide a machine that races on every attempt.
      console.warn(
        `[mongo-memory] lost a port race on attempt ${attempt} of ${PORT_RACE_ATTEMPTS}, retrying with a new port`,
      );
    }
  }
}

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
    retryingPortRace(() =>
      createServer(withServerLaunchBudget(options)),
    )) as typeof MongoMemoryServer.create;

  const createReplSet = MongoMemoryReplSet.create.bind(MongoMemoryReplSet);
  MongoMemoryReplSet.create = ((options?: ReplSetOptions) =>
    retryingPortRace(() =>
      createReplSet(withReplSetLaunchBudget(options)),
    )) as typeof MongoMemoryReplSet.create;
}

export const mongoMemoryLaunchBudgetForTest = {
  LAUNCH_BUDGET_MS,
  PORT_RACE_ATTEMPTS,
  isPortRace,
  retryingPortRace,
  withServerLaunchBudget,
  withReplSetLaunchBudget,
};
