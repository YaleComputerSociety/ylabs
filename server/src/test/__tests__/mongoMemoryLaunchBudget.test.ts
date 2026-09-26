import { describe, expect, it } from 'vitest';
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
