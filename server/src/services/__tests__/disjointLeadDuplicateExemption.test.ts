/**
 * A URL shared by two entities with disjoint lead people is not a duplicate claim (#3272).
 */
import { describe, expect, it } from 'vitest';
import {
  selectExactUrlDuplicateRiskEntityIds,
  urlGroupHasDisjointLeadPeople,
} from '../studentVisibilityGateService';

const A = '507f1f77bcf86cd799430001';
const B = '507f1f77bcf86cd799430002';
const P1 = '507f1f77bcf86cd799440001';
const P2 = '507f1f77bcf86cd799440002';
const URL = 'https://sharedlab.example.edu/';

const entity = (id: string, overrides: Record<string, unknown> = {}) => ({
  _id: id,
  slug: `row-${id.slice(-1)}`,
  entityType: 'LAB',
  websiteUrl: URL,
  ...overrides,
});
const lead = (entityId: string, personId: string) => ({
  researchEntityId: entityId,
  userId: personId,
  role: 'pi',
});
const leadsOf = (pairs: Array<[string, string]>) => {
  const map = new Map<string, Set<string>>();
  for (const [e, p] of pairs) {
    if (!map.has(e)) map.set(e, new Set());
    map.get(e)!.add(p);
  }
  return map;
};

describe('disjoint-lead url groups (#3272)', () => {
  it('calls a group disjoint when no lead person is shared', () => {
    expect(
      urlGroupHasDisjointLeadPeople(
        [entity(A), entity(B)],
        leadsOf([
          [A, P1],
          [B, P2],
        ]),
      ),
    ).toBe(true);
  });

  it('is not disjoint when the members share a lead person', () => {
    expect(
      urlGroupHasDisjointLeadPeople(
        [entity(A), entity(B)],
        leadsOf([
          [A, P1],
          [B, P1],
        ]),
      ),
    ).toBe(false);
  });

  // Absence of a lead is not difference. Treating it as difference would release the
  // undetermined class on missing data rather than on evidence.
  it('refuses the test as vacuous when any member has no lead', () => {
    expect(urlGroupHasDisjointLeadPeople([entity(A), entity(B)], leadsOf([[A, P1]]))).toBe(false);
    expect(urlGroupHasDisjointLeadPeople([entity(A), entity(B)], new Map())).toBe(false);
  });

  it('needs two members to be a group at all', () => {
    expect(urlGroupHasDisjointLeadPeople([entity(A)], leadsOf([[A, P1]]))).toBe(false);
  });

  it('exempts both members of a disjoint-lead group from the duplicate reason', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [entity(A), entity(B)],
      [lead(A, P1), lead(B, P2)],
    );
    expect([...ids]).toEqual([]);
  });

  // The control: the same pair with one shared lead still yields a duplicate, so the
  // exemption is discriminating rather than disabling the selector.
  it('still names a duplicate when the pair shares a lead', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [entity(A), entity(B)],
      [lead(A, P1), lead(B, P1)],
    );
    expect(ids.size).toBe(1);
  });

  it('still names a duplicate when neither member has a lead', () => {
    expect(selectExactUrlDuplicateRiskEntityIds([entity(A), entity(B)], []).size).toBe(1);
  });
});
