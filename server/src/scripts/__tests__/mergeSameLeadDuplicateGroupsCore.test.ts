import { describe, expect, it } from 'vitest';
import {
  SAME_LEAD_MERGE_CARRIED_FIELDS,
  corroborationFor,
  normalizedMergeName,
  planSameLeadCorroboratedMerges,
  summarizeSameLeadMergeHolds,
  survivorByOwnershipEvidence,
  type SameLeadMergeMember,
} from '../mergeSameLeadDuplicateGroupsCore';

const member = (overrides: Partial<SameLeadMergeMember> = {}): SameLeadMergeMember => ({
  id: 'a',
  slug: 'dept-physics-avery-lab',
  name: 'Avery Lab',
  entityType: 'LAB',
  hasIndexUrlAuthority: false,
  fundingRichness: 0,
  isShell: false,
  ...overrides,
});

const group = (members: SameLeadMergeMember[], overrides = {}) => ({
  url: 'sharedlab.example.edu',
  members,
  sharesALead: true,
  everyMemberHasALead: true,
  alreadyPlannedByUrlLane: false,
  quarantinedByConflationGuard: false,
  ...overrides,
});

describe('same-lead corroborated merges (#3326)', () => {
  it('carries funding evidence only', () => {
    expect([...SAME_LEAD_MERGE_CARRIED_FIELDS].sort()).toEqual([
      'fundingAgencies',
      'recentGrantCount',
      'recentGrants',
    ]);
  });

  it('treats a lab and a laboratory of the same stem as one name', () => {
    expect(normalizedMergeName('The Avery Laboratory')).toBe(normalizedMergeName('Avery Lab'));
    expect(normalizedMergeName('Avery Lab')).not.toBe(normalizedMergeName('Bennett Lab'));
  });

  // The shared lead is necessary and not sufficient: a lab member carries its lab's
  // address as its own websiteUrl, so URL plus lead is consistent with a member row.
  it('holds a group whose only evidence is the shared url and lead', () => {
    const outcome = planSameLeadCorroboratedMerges([
      group([
        member({ id: 'a', name: 'Avery Lab', hasIndexUrlAuthority: true }),
        member({ id: 'b', slug: 'dept-physics-bennett', name: 'Bennett Faculty Research' }),
      ]),
    ]);
    expect(outcome.merges).toEqual([]);
    expect(outcome.held[0].reason).toBe('only-a-shared-url-and-a-shared-lead');
  });

  it('merges a group whose normalized name also agrees', () => {
    const outcome = planSameLeadCorroboratedMerges([
      group([
        member({ id: 'a', name: 'Avery Lab', hasIndexUrlAuthority: true }),
        member({ id: 'b', slug: 'ysm-avery', name: 'Avery Laboratory' }),
      ]),
    ]);
    expect(outcome.merges).toHaveLength(1);
    expect(outcome.merges[0]).toMatchObject({
      corroboration: 'name-agrees',
      survivorId: 'a',
      loserIds: ['b'],
    });
  });

  it('never survives a shell over a concrete row', () => {
    const outcome = planSameLeadCorroboratedMerges([
      group([
        member({
          id: 'shell',
          slug: 'nih-pi-avery',
          name: 'Avery Lab',
          isShell: true,
          hasIndexUrlAuthority: true,
          fundingRichness: 9,
        }),
        member({ id: 'concrete', slug: 'ysm-avery-lab', name: 'Something Else' }),
      ]),
    ]);
    expect(outcome.merges[0]).toMatchObject({
      corroboration: 'shell-versus-concrete',
      survivorId: 'concrete',
      loserIds: ['shell'],
    });
  });

  // Incumbency is disqualified, so when no ownership evidence separates the members the
  // group is held. A tie here breaks alphabetically 44.5% of the time.
  it('holds rather than tie-breaks when neither side carries ownership evidence', () => {
    const outcome = planSameLeadCorroboratedMerges([
      group([
        member({ id: 'a', name: 'Avery Lab' }),
        member({ id: 'b', slug: 'ysm-avery', name: 'Avery Laboratory' }),
      ]),
    ]);
    expect(outcome.merges).toEqual([]);
    expect(outcome.held[0].reason).toBe('no-ownership-evidence-on-either-side');
    expect(
      survivorByOwnershipEvidence([member({ id: 'a' }), member({ id: 'b', slug: 'other' })]),
    ).toBeNull();
  });

  it('separates on funding richness when authority does not', () => {
    const survivor = survivorByOwnershipEvidence([
      member({ id: 'a', fundingRichness: 3 }),
      member({ id: 'b', slug: 'other', fundingRichness: 0 }),
    ]);
    expect(survivor?.id).toBe('a');
  });

  it('excludes a group the url lane already plans or its guard quarantines', () => {
    const named = [
      member({ id: 'a', name: 'Avery Lab', hasIndexUrlAuthority: true }),
      member({ id: 'b', slug: 'ysm-avery', name: 'Avery Laboratory' }),
    ];
    expect(
      planSameLeadCorroboratedMerges([group(named, { alreadyPlannedByUrlLane: true })]).held[0]
        .reason,
    ).toBe('already-planned-by-the-url-identity-lane');
    expect(
      planSameLeadCorroboratedMerges([group(named, { quarantinedByConflationGuard: true })]).held[0]
        .reason,
    ).toBe('quarantined-by-the-conflation-guard');
  });

  it('holds a vacuous group and one sharing no lead', () => {
    const named = [
      member({ id: 'a' }),
      member({ id: 'b', slug: 'ysm-avery', name: 'Avery Laboratory' }),
    ];
    expect(
      planSameLeadCorroboratedMerges([group(named, { everyMemberHasALead: false })]).held[0].reason,
    ).toBe('a-member-has-no-lead-so-the-test-is-vacuous');
    expect(
      planSameLeadCorroboratedMerges([group(named, { sharesALead: false })]).held[0].reason,
    ).toBe('members-share-no-lead');
  });

  it('reports whether the survivor actually gains funding', () => {
    const gains = planSameLeadCorroboratedMerges([
      group([
        member({ id: 'a', name: 'Avery Lab', hasIndexUrlAuthority: true, fundingRichness: 0 }),
        member({ id: 'b', slug: 'ysm-avery', name: 'Avery Laboratory', fundingRichness: 4 }),
      ]),
    ]);
    expect(gains.merges[0].survivorGainsFunding).toBe(true);
  });

  it('counts every hold reason it can emit', () => {
    const counts = summarizeSameLeadMergeHolds([
      { reason: 'only-a-shared-url-and-a-shared-lead' },
      { reason: 'only-a-shared-url-and-a-shared-lead' },
      { reason: 'no-ownership-evidence-on-either-side' },
    ]);
    expect(counts['only-a-shared-url-and-a-shared-lead']).toBe(2);
    expect(counts['no-ownership-evidence-on-either-side']).toBe(1);
    expect(counts['quarantined-by-the-conflation-guard']).toBe(0);
  });

  it('needs a real corroboration, not an empty name on both sides', () => {
    expect(
      corroborationFor([member({ name: 'Lab' }), member({ id: 'b', name: 'Research' })]),
    ).toBeNull();
  });
});
