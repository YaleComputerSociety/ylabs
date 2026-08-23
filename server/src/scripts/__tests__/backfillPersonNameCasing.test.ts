import { describe, expect, it, vi } from 'vitest';

import {
  assertPersonNameCasingApplyAllowed,
  parsePersonNameCasingBackfillArgs,
  runPersonNameCasingBackfill,
  type ResearcherCasingModel,
} from '../backfillPersonNameCasing';

describe('parsePersonNameCasingBackfillArgs', () => {
  it('defaults to a dry run with no limit', () => {
    expect(parsePersonNameCasingBackfillArgs([])).toMatchObject({
      dryRun: true,
      confirm: false,
      explicitLimit: false,
    });
  });

  it('parses apply, confirm, and explicit limit', () => {
    expect(
      parsePersonNameCasingBackfillArgs(['--apply', '--confirm-person-name-casing', '--limit=50']),
    ).toMatchObject({ dryRun: false, confirm: true, explicitLimit: true, limit: 50 });
  });

  it('rejects unknown arguments', () => {
    expect(() => parsePersonNameCasingBackfillArgs(['--nope'])).toThrow(/Unknown/);
  });
});

describe('assertPersonNameCasingApplyAllowed', () => {
  it('requires confirmation and an explicit limit before applying', () => {
    expect(() =>
      assertPersonNameCasingApplyAllowed({ dryRun: false, confirm: false, explicitLimit: true }),
    ).toThrow(/--confirm-person-name-casing/);
    expect(() =>
      assertPersonNameCasingApplyAllowed({ dryRun: false, confirm: true, explicitLimit: false }),
    ).toThrow(/explicit --limit/);
  });

  it('allows a dry run without confirmation', () => {
    expect(() =>
      assertPersonNameCasingApplyAllowed({ dryRun: true, confirm: false, explicitLimit: false }),
    ).not.toThrow();
  });
});

const modelFrom = (docs: Array<{ _id: string; displayName: unknown; archived?: boolean }>) => {
  const updateOne = vi.fn().mockResolvedValue(undefined);
  const model: ResearcherCasingModel = {
    find: () => ({ lean: async () => docs as Array<Record<string, unknown>> }),
    updateOne,
  };
  return { model, updateOne };
};

describe('runPersonNameCasingBackfill', () => {
  it('normalizes only raw-cased person names and leaves preserved tokens alone', async () => {
    const { model, updateOne } = modelFrom([
      { _id: 'a', displayName: 'RAHEL JAEGGI' },
      { _id: 'b', displayName: 'AZA Allsop' },
      { _id: 'c', displayName: 'Myles Alderman III' },
      { _id: 'd', displayName: 'LTC (RET) Joanne E. McGovern' },
      { _id: 'e', displayName: 'Rahel Jaeggi' },
    ]);

    const result = await runPersonNameCasingBackfill({ dryRun: false }, model);

    expect(result.updated).toBe(2);
    expect(result.scanned).toBe(2);
    expect(result.errors).toBe(0);
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne).toHaveBeenCalledWith({ _id: 'a' }, { $set: { displayName: 'Rahel Jaeggi' } });
    expect(updateOne).toHaveBeenCalledWith({ _id: 'b' }, { $set: { displayName: 'Aza Allsop' } });
  });

  it('does not write in dry-run mode', async () => {
    const { model, updateOne } = modelFrom([{ _id: 'a', displayName: 'OLEG BUDNITCKIY' }]);
    const result = await runPersonNameCasingBackfill({ dryRun: true }, model);
    expect(result.mode).toBe('dry-run');
    expect(result.updated).toBe(1);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('honors an explicit limit', async () => {
    const { model, updateOne } = modelFrom([
      { _id: 'a', displayName: 'RAHEL JAEGGI' },
      { _id: 'b', displayName: 'OLEG BUDNITCKIY' },
      { _id: 'c', displayName: 'LIAM BROWN' },
    ]);
    const result = await runPersonNameCasingBackfill({ dryRun: false, limit: 2 }, model);
    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(2);
    expect(updateOne).toHaveBeenCalledTimes(2);
  });
});
