import { describe, expect, it } from 'vitest';
import {
  RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS,
  assertAcceptanceDenylistStillGuards,
  assertIdentifiedLeadWaysInSignalsFullyRetired,
  retiredIdentifiedLeadWaysInFilter,
} from '../retireIdentifiedLeadWaysInSignalsCore';
import {
  parseRetireIdentifiedLeadWaysInArgs,
  assertRetireIdentifiedLeadWaysInApplyAllowed,
  retireIdentifiedLeadWaysInSignals,
} from '../retireIdentifiedLeadWaysInSignals';
import { IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS } from '../../services/accessAcceptanceLevel';

describe('retire:identified-lead-ways-in keys', () => {
  it('names exactly the keys the acceptance denylist still guards', () => {
    expect([...RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS].sort()).toEqual(
      [...IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS].sort(),
    );
  });

  it('only ever selects live rows, so a second apply is a no-op', () => {
    expect(retiredIdentifiedLeadWaysInFilter.archived).toEqual({ $ne: true });
  });
});

describe('parseRetireIdentifiedLeadWaysInArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseRetireIdentifiedLeadWaysInArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirmRetireIdentifiedLeadWaysIn).toBe(false);
  });

  it('rejects an unknown argument rather than silently ignoring it', () => {
    expect(() => parseRetireIdentifiedLeadWaysInArgs(['--wat'])).toThrow(/Unknown/);
  });

  it('rejects a valued confirm flag', () => {
    expect(() =>
      parseRetireIdentifiedLeadWaysInArgs(['--confirm-retire-identified-lead-ways-in=yes']),
    ).toThrow(/does not accept a value/);
  });

  it('requires the confirm flag to apply', () => {
    expect(() =>
      assertRetireIdentifiedLeadWaysInApplyAllowed({
        apply: true,
        confirmRetireIdentifiedLeadWaysIn: false,
      }),
    ).toThrow(/--confirm-retire-identified-lead-ways-in is required/);
  });
});

describe('retirement invariants', () => {
  it('fails when rows survive an apply', () => {
    expect(() => assertIdentifiedLeadWaysInSignalsFullyRetired(7)).toThrow(/7 live signals/);
    expect(() => assertIdentifiedLeadWaysInSignalsFullyRetired(0)).not.toThrow();
  });

  it('refuses to run once the denylist has been removed while rows remain', () => {
    expect(() =>
      assertAcceptanceDenylistStillGuards({ presentBefore: 4183, denylistPresent: false }),
    ).toThrow(/counting toward acceptance/);
  });

  it('allows the run while the denylist is intact, and after the data is already gone', () => {
    expect(() =>
      assertAcceptanceDenylistStillGuards({ presentBefore: 4183, denylistPresent: true }),
    ).not.toThrow();
    expect(() =>
      assertAcceptanceDenylistStillGuards({ presentBefore: 0, denylistPresent: false }),
    ).not.toThrow();
  });
});

const fakeDb = (rows: Array<Record<string, unknown>>) => {
  const live = () => rows.filter((r) => r.archived !== true);
  return {
    collection: () => ({
      countDocuments: async () => live().length,
      distinct: async (field: string) => [...new Set(live().map((r) => String(r[field])))],
      updateMany: async (_filter: unknown, update: Record<string, any>) => {
        const target = live();
        for (const row of target) Object.assign(row, update.$set);
        return { matchedCount: target.length, modifiedCount: target.length };
      },
    }),
  } as any;
};

describe('retireIdentifiedLeadWaysInSignals', () => {
  const rows = (): Array<Record<string, unknown>> => [
    { derivationKey: RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS[0], researchEntityId: 'a' },
    { derivationKey: RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS[1], researchEntityId: 'b' },
    { derivationKey: RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS[1], researchEntityId: 'b' },
  ];

  it('reports without writing on a dry run', async () => {
    const data = rows();
    const result = await retireIdentifiedLeadWaysInSignals({ apply: false, db: fakeDb(data) });
    expect(result.mode).toBe('dry-run');
    expect(result.presentBefore).toBe(3);
    expect(result.presentAfter).toBe(3);
    expect(result.modified).toBe(0);
    expect(result.entitiesAffected).toBe(2);
    expect(data.every((r) => r.archived === undefined)).toBe(true);
  });

  it('archives every live row on apply and leaves none behind', async () => {
    const data = rows();
    const result = await retireIdentifiedLeadWaysInSignals({ apply: true, db: fakeDb(data) });
    expect(result.mode).toBe('apply');
    expect(result.modified).toBe(3);
    expect(result.presentAfter).toBe(0);
    expect(data.every((r) => r.archived === true)).toBe(true);
    expect(data.every((r) => r.archivedReason === 'retire:identified-lead-ways-in')).toBe(true);
  });

  it('is idempotent, so a re-run against a retired environment changes nothing', async () => {
    const data = rows().map((r) => ({ ...r, archived: true }));
    const result = await retireIdentifiedLeadWaysInSignals({ apply: true, db: fakeDb(data) });
    expect(result.presentBefore).toBe(0);
    expect(result.modified).toBe(0);
  });
});
