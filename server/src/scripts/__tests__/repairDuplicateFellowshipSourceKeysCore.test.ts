import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  planDuplicateFellowshipSourceKeyRetirements,
  retiredFellowshipIds,
} from '../repairDuplicateFellowshipSourceKeysCore';
import {
  assertRepairDuplicateFellowshipSourceKeysApplyAllowed,
  parseRepairDuplicateFellowshipSourceKeysArgs,
} from '../repairDuplicateFellowshipSourceKeys';

describe('planDuplicateFellowshipSourceKeyRetirements', () => {
  it('plans nothing when every sourceKey is held once', () => {
    const plan = planDuplicateFellowshipSourceKeyRetirements([
      { id: 'a', sourceKey: 'office:one' },
      { id: 'b', sourceKey: 'office:two', archived: true },
    ]);
    expect(plan.keysWithDuplicates).toBe(0);
    expect(plan.retirements).toEqual([]);
    expect(plan.refusals).toEqual([]);
  });

  it('keeps the one live row and retires the archived duplicates', () => {
    const plan = planDuplicateFellowshipSourceKeyRetirements([
      { id: 'archived', sourceKey: 'office:grant', archived: true },
      { id: 'live', sourceKey: 'office:grant', archived: false },
      { id: 'also-archived', sourceKey: 'office:grant', archived: true },
    ]);
    expect(plan.keysWithDuplicates).toBe(1);
    expect(plan.retirements).toEqual([
      { sourceKey: 'office:grant', keepId: 'live', retireIds: ['archived', 'also-archived'] },
    ]);
    expect(retiredFellowshipIds(plan)).toEqual(['archived', 'also-archived']);
  });

  it('treats a row with no archived flag as live', () => {
    const plan = planDuplicateFellowshipSourceKeyRetirements([
      { id: 'implicitly-live', sourceKey: 'office:grant' },
      { id: 'archived', sourceKey: 'office:grant', archived: true },
    ]);
    expect(plan.retirements[0]?.keepId).toBe('implicitly-live');
  });

  it('refuses a group whose rows are all archived rather than picking one', () => {
    const plan = planDuplicateFellowshipSourceKeyRetirements([
      { id: 'one', sourceKey: 'office:grant', archived: true },
      { id: 'two', sourceKey: 'office:grant', archived: true },
    ]);
    expect(plan.retirements).toEqual([]);
    expect(plan.refusals).toEqual([
      { sourceKey: 'office:grant', reason: 'no_live_row', ids: ['one', 'two'] },
    ]);
  });

  it('refuses a group with more than one live row, because the choice is a product judgement', () => {
    const plan = planDuplicateFellowshipSourceKeyRetirements([
      { id: 'one', sourceKey: 'office:grant', archived: false },
      { id: 'two', sourceKey: 'office:grant', archived: false },
      { id: 'three', sourceKey: 'office:grant', archived: true },
    ]);
    expect(plan.retirements).toEqual([]);
    expect(plan.refusals).toEqual([
      { sourceKey: 'office:grant', reason: 'multiple_live_rows', ids: ['one', 'two', 'three'] },
    ]);
  });

  it('ignores a blank or whitespace sourceKey, which the partial index excludes anyway', () => {
    const plan = planDuplicateFellowshipSourceKeyRetirements([
      { id: 'one', sourceKey: '' },
      { id: 'two', sourceKey: '   ' },
      { id: 'three', sourceKey: '' },
    ]);
    expect(plan.keysWithDuplicates).toBe(0);
  });
});

describe('fellowships:repair-duplicate-source-keys command surface', () => {
  it('defaults to a dry run and parses its flags', () => {
    expect(parseRepairDuplicateFellowshipSourceKeysArgs([])).toMatchObject({
      apply: false,
      confirm: false,
    });
    expect(
      parseRepairDuplicateFellowshipSourceKeysArgs([
        '--apply',
        '--confirm-duplicate-source-key-retirement',
      ]),
    ).toMatchObject({ apply: true, confirm: true });
  });

  it('rejects an unknown flag', () => {
    expect(() => parseRepairDuplicateFellowshipSourceKeysArgs(['--nope'])).toThrow(
      'Unknown fellowships:repair-duplicate-source-keys argument: --nope',
    );
  });

  it('requires explicit confirmation to apply', () => {
    expect(() =>
      assertRepairDuplicateFellowshipSourceKeysApplyAllowed({ apply: true, confirm: false }),
    ).toThrow('--confirm-duplicate-source-key-retirement');
    expect(() =>
      assertRepairDuplicateFellowshipSourceKeysApplyAllowed({ apply: true, confirm: true }),
    ).not.toThrow();
    expect(() =>
      assertRepairDuplicateFellowshipSourceKeysApplyAllowed({ apply: false, confirm: false }),
    ).not.toThrow();
  });

  it('is registered as an npm script, so an operator can run it', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts['fellowships:repair-duplicate-source-keys']).toBe(
      'tsx src/scripts/repairDuplicateFellowshipSourceKeys.ts',
    );
  });
});
