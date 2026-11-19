import { describe, expect, it } from 'vitest';
import {
  type ProgramFieldScopeRow,
  withStoredValuesForRowsReachedElsewhere,
} from '../entityMaterializer';

const ownRow: ProgramFieldScopeRow = {
  entityKey: 'fixture-lane:own-award',
  recordId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  sourceName: 'fixture-lane',
  written: false,
  changes: [{ path: 'globalRegions', stored: [], planned: ['Africa'] }],
};
const reachedElsewhere: ProgramFieldScopeRow = {
  entityKey: 'fixture-fund:shared-fund',
  recordId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  written: false,
  changes: [{ path: 'globalRegions', stored: null, planned: ['Africa'] }],
};
const readById = new Map<string, Record<string, unknown>>([
  ['bbbbbbbbbbbbbbbbbbbbbbbb', { sourceName: 'other-lane', globalRegions: ['Europe'] }],
]);

describe('the program scope report for a row a run key reached under another identity (#6473)', () => {
  it("reports the row's own stored value and sourceName in the unapplied plan", () => {
    const [own, other] = withStoredValuesForRowsReachedElsewhere(
      [ownRow, reachedElsewhere],
      readById,
      false,
    );
    expect(own).toEqual(ownRow);
    expect(other.sourceName).toBe('other-lane');
    expect(other.changes).toEqual([
      { path: 'globalRegions', stored: ['Europe'], planned: ['Africa'] },
    ]);
  });

  it('says the stored value was not captured on an apply instead of printing a post-write value', () => {
    const [, other] = withStoredValuesForRowsReachedElsewhere(
      [ownRow, reachedElsewhere],
      readById,
      true,
    );
    expect(other.storedNotCaptured).toBe('reached-under-another-identity-on-apply');
    expect(other.changes[0].stored).toBeNull();
  });
});
