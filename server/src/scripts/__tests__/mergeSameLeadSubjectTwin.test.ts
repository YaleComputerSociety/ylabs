import { describe, expect, it } from 'vitest';
import {
  ownSiteIdentityPairs,
  planSameLeadCorroboratedMerges,
  subjectTwinAnchor,
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
  leadPersonIds: [],
  memberPersonIds: [],
  ...overrides,
});

const group = (members: SameLeadMergeMember[], overrides = {}) => ({
  url: 'sharedlab.example.edu',
  members,
  sharesALead: false,
  everyMemberHasALead: false,
  alreadyPlannedByUrlLane: false,
  quarantinedByConflationGuard: false,
  ...overrides,
});

const anchor = member({ id: 'a', leadPersonIds: ['pi'], memberPersonIds: ['student'] });

describe('one lab stored twice on its own site (#6206)', () => {
  it('folds a leadless twin into the row its lead leads', () => {
    const outcome = planSameLeadCorroboratedMerges([
      group([anchor, member({ id: 'b', name: 'The Avery Laboratory' })]),
    ]);

    expect(outcome.merges).toEqual([
      expect.objectContaining({
        corroboration: 'leadless-or-member-led-twin',
        survivorId: 'a',
        loserIds: ['b'],
      }),
    ]);
  });

  it('folds a twin led only by a member of the anchor row', () => {
    const twin = member({ id: 'b', leadPersonIds: ['student'] });

    expect(subjectTwinAnchor([anchor, twin])?.id).toBe('a');
  });

  it('never folds two rows led by different people', () => {
    const otherLab = member({ id: 'b', leadPersonIds: ['other-pi'] });

    expect(subjectTwinAnchor([anchor, otherLab])).toBeNull();
    expect(
      planSameLeadCorroboratedMerges([group([anchor, otherLab], { everyMemberHasALead: true })])
        .merges,
    ).toEqual([]);
  });

  it('holds a twin whose name does not agree', () => {
    expect(subjectTwinAnchor([anchor, member({ id: 'b', name: 'Bennett Lab' })])).toBeNull();
  });

  it('holds a group in which no single row can anchor', () => {
    expect(subjectTwinAnchor([member({ id: 'a' }), member({ id: 'b' })])).toBeNull();
  });

  it('plans no row in two merges, leaving the later overlapping group held', () => {
    const outcome = planSameLeadCorroboratedMerges([
      group([anchor, member({ id: 'c', leadPersonIds: [] })], { url: 'first.example.edu' }),
      group([anchor, member({ id: 'b' })], { url: 'second.example.edu' }),
    ]);

    expect(outcome.merges.map((merge) => merge.url)).toEqual(['first.example.edu']);
    expect(outcome.held).toEqual([
      { url: 'second.example.edu', reason: 'shares-a-row-with-an-earlier-merge' },
    ]);
  });

  it('leaves a twin the conflation guard fences to that guard', () => {
    const outcome = planSameLeadCorroboratedMerges([
      group([anchor, member({ id: 'b' })], { quarantinedByConflationGuard: true }),
    ]);

    expect(outcome.merges).toEqual([]);
  });
});

describe('own websites that differ only by www (#6206)', () => {
  it('pairs two rows whose own sites are one identity', () => {
    const pairs = ownSiteIdentityPairs(
      [
        { _id: 'a', websiteUrl: 'https://www.averylab.example.org/' },
        { _id: 'b', websiteUrl: 'https://averylab.example.org' },
      ],
      new Set(),
    );

    expect(pairs.map((pair) => pair.members.map((row) => row._id))).toEqual([['a', 'b']]);
  });

  it('skips a pair the exact-URL groups already hold', () => {
    const pairs = ownSiteIdentityPairs(
      [
        { _id: 'a', websiteUrl: 'https://averylab.example.org' },
        { _id: 'b', websiteUrl: 'https://averylab.example.org' },
      ],
      new Set(['a|b']),
    );

    expect(pairs).toEqual([]);
  });
});
