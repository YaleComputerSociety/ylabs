import { describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { mongoMemoryLaunchBudgetForTest } from '../mongoMemoryLaunchBudget';

const { LAUNCH_BUDGET_MS, withServerLaunchBudget, withReplSetLaunchBudget } =
  mongoMemoryLaunchBudgetForTest;

describe('the in-memory MongoDB launch budget is owned centrally (#2903 sibling)', () => {
  it('exceeds the library default it exists to replace', () => {
    expect(LAUNCH_BUDGET_MS).toBeGreaterThan(10000);
  });

  it('sets a budget on a standalone server that declared none', () => {
    expect(withServerLaunchBudget().instance?.launchTimeout).toBe(LAUNCH_BUDGET_MS);
  });

  it('leaves a suite that chose its own budget alone', () => {
    const chosen = withServerLaunchBudget({ instance: { launchTimeout: 5000 } });

    expect(chosen.instance?.launchTimeout).toBe(5000);
  });

  it('keeps the other instance options a suite asked for', () => {
    const withDbName = withServerLaunchBudget({ instance: { dbName: 'probe' } });

    expect(withDbName.instance?.dbName).toBe('probe');
    expect(withDbName.instance?.launchTimeout).toBe(LAUNCH_BUDGET_MS);
  });

  // A replica set applies instanceOpts[i] to member i and starts any remaining member
  // with no base options, so one entry would leave the other members at the default.
  it('spells the budget once per replica-set member, not once per set', () => {
    const three = withReplSetLaunchBudget({ replSet: { count: 3 } });

    expect(three.instanceOpts).toHaveLength(3);
    expect(three.instanceOpts?.map((opts) => opts.launchTimeout)).toEqual([
      LAUNCH_BUDGET_MS,
      LAUNCH_BUDGET_MS,
      LAUNCH_BUDGET_MS,
    ]);
  });

  it('covers a single-member set declared with no count at all', () => {
    expect(withReplSetLaunchBudget().instanceOpts).toHaveLength(1);
  });

  it('preserves a per-member option a suite supplied', () => {
    const mixed = withReplSetLaunchBudget({
      replSet: { count: 2 },
      instanceOpts: [{ storageEngine: 'wiredTiger' }],
    });

    expect(mixed.instanceOpts?.[0].storageEngine).toBe('wiredTiger');
    expect(mixed.instanceOpts?.[0].launchTimeout).toBe(LAUNCH_BUDGET_MS);
    expect(mixed.instanceOpts?.[1].launchTimeout).toBe(LAUNCH_BUDGET_MS);
  });

  // The wrapper is installed by the shared setup file, so every suite inherits it
  // without repeating the argument. Asserting the patch is in place is what stops a
  // future setup-file edit from silently removing it for all 143 suites.
  it('is installed on both factories by the shared setup file', () => {
    expect(MongoMemoryServer.create.name).not.toBe('create');
    expect(MongoMemoryReplSet.create.name).not.toBe('create');
  });
});

const { PORT_RACE_ATTEMPTS, isPortRace, retryingPortRace } = mongoMemoryLaunchBudgetForTest;

/**
 * Reproduces #3845 without a port or a process: the library surfaces a lost port race as an
 * error whose message reads `Port "57911" already in use`, so the retry is driven by that
 * message and can be exercised by throwing it.
 */
const portRace = () => new Error('Port "57911" already in use');

describe('isPortRace', () => {
  it('recognises the message the library actually emits', () => {
    expect(isPortRace(portRace())).toBe(true);
    expect(isPortRace('Port "1" already in use')).toBe(true);
    expect(isPortRace('port 27017 already in use')).toBe(true);
  });

  // A retry must not swallow the failure this harness was built to report: #2903's launch budget
  // exists because a slow machine exceeds it, and that has to stay visible.
  it('does not recognise any other launch failure', () => {
    expect(isPortRace(new Error('Instance failed to start within 120000ms'))).toBe(false);
    expect(isPortRace(new Error('spawn ENOENT'))).toBe(false);
    expect(isPortRace(undefined)).toBe(false);
  });
});

describe('retryingPortRace', () => {
  it('retries a lost port race and returns the launch that wins', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(portRace())
      .mockRejectedValueOnce(portRace())
      .mockResolvedValue('started');
    await expect(retryingPortRace(create)).resolves.toBe('started');
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('gives up after a bounded number of attempts, so a port that is never free still fails', async () => {
    const create = vi.fn().mockRejectedValue(portRace());
    await expect(retryingPortRace(create)).rejects.toThrow('already in use');
    expect(create).toHaveBeenCalledTimes(PORT_RACE_ATTEMPTS);
  });

  it('rethrows any other failure on the first attempt rather than retrying it', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Instance failed to start within 120000ms'));
    await expect(retryingPortRace(create)).rejects.toThrow('failed to start');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not call the launch twice when the first attempt succeeds', async () => {
    const create = vi.fn().mockResolvedValue('started');
    await expect(retryingPortRace(create)).resolves.toBe('started');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

/**
 * The masking half of #3845: a file whose `beforeAll` never assigned its handle used to report a
 * second, consequential `Cannot read properties of undefined (reading 'stop')` from `afterAll`,
 * which turned one setup failure into two and buried the real cause. Every suite's teardown now
 * optional-chains the handle.
 */
describe('teardown of a launch that never happened', () => {
  it('is a no-op rather than a second reported failure', async () => {
    let replSet: { stop: () => Promise<void> } | undefined;
    // `undefined?.stop()` short-circuits to undefined rather than returning a promise, so the
    // awaited teardown neither throws nor needs a guard clause in every suite.
    expect(replSet?.stop()).toBeUndefined();
    await expect(Promise.resolve(replSet?.stop())).resolves.toBeUndefined();
  });
});
