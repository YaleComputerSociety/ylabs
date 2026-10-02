import { describe, expect, it } from 'vitest';
import {
  planSameLeadCorroboratedMerges,
  sameLeadUrlLaneHoldFlags,
  sameLeadUrlLaneHolds,
  sameLeadUrlLaneInputsReport,
  summarizeSameLeadMergeHolds,
  type SameLeadMergeMember,
} from '../mergeSameLeadDuplicateGroupsCore';
import type { UrlIdentityLaneVerdict } from '../researchEntityPiDedupeCore';

const verdict = (overrides: Partial<UrlIdentityLaneVerdict> = {}): UrlIdentityLaneVerdict => ({
  lane: 'official-lab-url',
  candidateRows: 12,
  rowLimit: 10000,
  plannedGroups: 0,
  quarantinedGroups: 0,
  plannedSlugs: [],
  quarantinedSlugs: [],
  ...overrides,
});

const everyLane = (
  overrides: Partial<Record<UrlIdentityLaneVerdict['lane'], Partial<UrlIdentityLaneVerdict>>> = {},
): UrlIdentityLaneVerdict[] =>
  (['official-lab-url', 'profile-lab-url', 'website-url'] as const).map((lane) =>
    verdict({ lane, ...overrides[lane] }),
  );

const member = (overrides: Partial<SameLeadMergeMember>): SameLeadMergeMember => ({
  id: 'a',
  slug: 'synthetic-zephyr-lab',
  name: 'Zephyr Lab',
  entityType: 'LAB',
  hasIndexUrlAuthority: true,
  fundingRichness: 0,
  isShell: false,
  ...overrides,
});

const corroboratedGroupMembers = [
  member({ id: 'a' }),
  member({
    id: 'b',
    slug: 'synthetic-zephyr-laboratory',
    name: 'Zephyr Laboratory',
    hasIndexUrlAuthority: false,
  }),
];

const planWith = (verdicts: UrlIdentityLaneVerdict[]) => {
  const holds = sameLeadUrlLaneHolds(verdicts);
  return planSameLeadCorroboratedMerges([
    {
      url: 'zephyr.example.edu',
      members: corroboratedGroupMembers,
      sharesALead: true,
      everyMemberHasALead: true,
      ...sameLeadUrlLaneHoldFlags(
        corroboratedGroupMembers.map((entry) => entry.slug),
        holds,
      ),
    },
  ]);
};

describe('same-lead merge URL-identity lane holds (#3724)', () => {
  it('refuses to plan at all when no lane verdict was read', () => {
    expect(() => sameLeadUrlLaneHolds([])).toThrow(/official-lab-url URL-identity lane was read 0/);
  });

  it('refuses to plan when any one of the three lanes is missing', () => {
    const withoutWebsiteLane = everyLane().filter((entry) => entry.lane !== 'website-url');
    expect(() => sameLeadUrlLaneHolds(withoutWebsiteLane)).toThrow(/website-url/);
  });

  it('refuses to plan when a lane read as many rows as its limit allows', () => {
    expect(() =>
      sameLeadUrlLaneHolds(everyLane({ 'profile-lab-url': { candidateRows: 10000 } })),
    ).toThrow(/may be truncated/);
  });

  it('merges the corroborated group when no lane names its members', () => {
    expect(planWith(everyLane()).merges).toHaveLength(1);
  });

  it('holds a group when a lane quarantine names one of its members', () => {
    const outcome = planWith(
      everyLane({
        'website-url': { quarantinedGroups: 1, quarantinedSlugs: ['synthetic-zephyr-laboratory'] },
      }),
    );

    expect(outcome.merges).toEqual([]);
    expect(summarizeSameLeadMergeHolds(outcome.held)['quarantined-by-the-conflation-guard']).toBe(
      1,
    );
  });

  it('holds a group when a lane already plans one of its members', () => {
    const outcome = planWith(
      everyLane({
        'official-lab-url': { plannedGroups: 1, plannedSlugs: ['synthetic-zephyr-lab'] },
      }),
    );

    expect(outcome.merges).toEqual([]);
    expect(outcome.held[0].reason).toBe('already-planned-by-the-url-identity-lane');
  });

  it('reports what each lane read without listing its slugs', () => {
    const report = sameLeadUrlLaneInputsReport(
      everyLane({ 'website-url': { quarantinedGroups: 1, quarantinedSlugs: ['synthetic-x'] } }),
    );

    expect(report.map((entry) => entry.lane)).toEqual([
      'official-lab-url',
      'profile-lab-url',
      'website-url',
    ]);
    expect(report[2]).toEqual({
      lane: 'website-url',
      candidateRows: 12,
      rowLimit: 10000,
      plannedGroups: 0,
      quarantinedGroups: 1,
    });
  });
});
