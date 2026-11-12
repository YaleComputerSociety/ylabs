import { describe, expect, it } from 'vitest';
import { syntheticPersonOrcid, withOrcidCheckDigit } from '../../test/syntheticOrcid';
import {
  citedOfficialPageKey,
  citedOfficialPageRefusal,
  planAccountlessClusterFolds,
  routeCitedOfficialPagePairs,
  type CitedOfficialPageWitness,
} from '../dedupeAccountlessResearcherShellsCore';

const NOW = new Date('2026-11-12T00:00:00Z');
const PAGE = 'https://medicine.yale.edu/profile/avery-synth/';

const witness = (
  over: {
    holder?: Partial<CitedOfficialPageWitness['holder']>;
    citer?: Partial<CitedOfficialPageWitness['citer']>;
    listing?: Partial<CitedOfficialPageWitness['listing']>;
    pageStatedNames?: string[];
    pageHolderIds?: string[];
  } = {},
): CitedOfficialPageWitness => ({
  holder: { id: 'holder', displayName: 'Avery Synth', ...over.holder },
  citer: { id: 'citer', displayName: 'Avery Q. Synth', ...over.citer },
  listing: {
    archived: false,
    state: 'UNKNOWN',
    targetIsLive: true,
    sourceName: 'centers-institutes-index',
    sourceUrl: 'https://medicine.yale.edu/fixturecenter/people/',
    profileUrl: 'https://medicine.yale.edu/fixturecenter/profile/avery-synth/',
    membershipKey: 'centers:fixture-center:avery-synth',
    liveListingNames: ['Avery Q. Synth'],
    ...over.listing,
  },
  pageStatedNames: over.pageStatedNames ?? ['Avery Synth'],
  pageHolderIds: over.pageHolderIds ?? ['holder'],
  now: NOW,
});

describe('citedOfficialPageRefusal (#5990, #6002)', () => {
  it('admits a roster listing that cites the holder page about the same person', () => {
    expect(citedOfficialPageRefusal(witness())).toBeUndefined();
  });

  it('reads a YSM site copy of the profile as the same page', () => {
    expect(
      citedOfficialPageKey('https://medicine.yale.edu/fixturecenter/profile/avery-synth/'),
    ).toBe(citedOfficialPageKey(PAGE));
  });

  it('refuses a listing that links a colleague page naming a different person', () => {
    expect(citedOfficialPageRefusal(witness({ pageStatedNames: ['Blair Other'] }))).toBe(
      'listing-name-not-page-subject',
    );
  });

  it('refuses a listing whose name states a different middle initial from the page heading', () => {
    expect(citedOfficialPageRefusal(witness({ pageStatedNames: ['Avery R. Synth'] }))).toBe(
      'listing-name-not-page-subject',
    );
  });

  it('refuses a page that states no name at all', () => {
    expect(citedOfficialPageRefusal(witness({ pageStatedNames: [] }))).toBe(
      'listing-name-not-page-subject',
    );
  });

  it('refuses when the two records do not agree on the full name', () => {
    expect(
      citedOfficialPageRefusal(
        witness({
          citer: { displayName: 'Avery R. Synth' },
          holder: { displayName: 'Avery Q. Synth' },
        }),
      ),
    ).toBe('names-disagree');
  });

  it('refuses a non-roster citation with no membership key', () => {
    expect(citedOfficialPageRefusal(witness({ listing: { membershipKey: '' } }))).toBe(
      'not-a-roster-listing',
    );
  });

  it.each([
    { sourceUrl: 'https://fixture.example.org/people/' },
    { profileUrl: 'https://fixture.example.org/profile/avery-synth/' },
  ])('refuses a non-Yale citing source %o', (listing) => {
    expect(citedOfficialPageRefusal(witness({ listing }))).toBe('not-yale-hosted');
  });

  it('refuses a stale listing', () => {
    expect(
      citedOfficialPageRefusal(
        witness({ listing: { freshnessExpiresAt: new Date('2026-11-01T00:00:00Z') } }),
      ),
    ).toBe('stale-listing');
  });

  it('admits a listing whose freshness has not expired', () => {
    expect(
      citedOfficialPageRefusal(
        witness({ listing: { freshnessExpiresAt: new Date('2026-12-01T00:00:00Z') } }),
      ),
    ).toBeUndefined();
  });

  it.each([
    [{ archived: true }, 'not-a-live-edge'],
    [{ state: 'HISTORICAL' }, 'not-a-live-edge'],
    [{ targetIsLive: false }, 'row-not-live'],
    [{ liveListingNames: [] }, 'no-live-listing'],
  ])('refuses a non-live listing %o', (listing, refusal) => {
    expect(citedOfficialPageRefusal(witness({ listing }))).toBe(refusal);
  });

  it('refuses when a third record also holds the page', () => {
    expect(citedOfficialPageRefusal(witness({ pageHolderIds: ['holder', 'third'] }))).toBe(
      'third-page-holder',
    );
  });

  it('refuses when the holder does not hold the cited page', () => {
    expect(citedOfficialPageRefusal(witness({ pageHolderIds: ['third'] }))).toBe(
      'cites-another-page',
    );
  });

  it.each([
    [{ netid: 'synth1' }, { netid: 'synth2' }],
    [{ email: 'one@example.test' }, { email: 'two@example.test' }],
    [{ orcid: syntheticPersonOrcid(621) }, { orcid: syntheticPersonOrcid(622) }],
  ])('refuses a conflicting identifier %o %o', (holder, citer) => {
    expect(citedOfficialPageRefusal(witness({ holder, citer }))).toBe('identifier-conflict');
  });

  it.each(['2025-2024-2023-2022', withOrcidCheckDigit('104973150123456')])(
    'treats the bogus ORCID %s as absent',
    (bogus) => {
      expect(
        citedOfficialPageRefusal(
          witness({ holder: { orcid: bogus }, citer: { orcid: syntheticPersonOrcid(623) } }),
        ),
      ).toBeUndefined();
    },
  );
});

describe('routeCitedOfficialPagePairs', () => {
  it('folds the weaker record into the stronger one and joins equal records', () => {
    const routing = routeCitedOfficialPagePairs(
      [
        ['shell', 'directory'],
        ['left', 'right'],
      ],
      new Map([
        ['shell', 'NAME_ONLY'],
        ['directory', 'DIRECTORY'],
        ['left', 'NAME_ONLY'],
        ['right', 'NAME_ONLY'],
      ] as const),
    );
    expect(routing.targetByShellId).toEqual(new Map([['shell', 'directory']]));
    expect(routing.equalTierJoins).toEqual([['left', 'right']]);
  });

  it('never joins two directory records and resolves two stronger targets to nobody', () => {
    const routing = routeCitedOfficialPagePairs(
      [
        ['one', 'two'],
        ['shell', 'one'],
        ['shell', 'two'],
      ],
      new Map([
        ['one', 'DIRECTORY'],
        ['two', 'DIRECTORY'],
        ['shell', 'NAME_ONLY'],
      ] as const),
    );
    expect(routing.equalTierJoins).toEqual([]);
    expect(routing.targetByShellId.size).toBe(0);
    expect(routing.ambiguousShellIds).toEqual(new Set(['shell']));
  });
});

describe('cited official page joins in the cluster planner', () => {
  const member = (id: string, over: Record<string, unknown> = {}) => ({
    id: id.padStart(24, '0'),
    displayName: 'Avery Synth',
    liveRoleEdges: 0,
    ...over,
  });

  it('folds a witnessed pair into the survivor and is a no-op once the folded record is gone', () => {
    const members = [
      member('1', { displayName: 'Avery Q. Synth' }),
      member('2', { liveRoleEdges: 1 }),
    ];
    const joins = [['1'.padStart(24, '0'), '2'.padStart(24, '0')] as const];
    const first = planAccountlessClusterFolds(members, [], joins);
    expect(first.foldTargetById).toEqual(new Map([['1'.padStart(24, '0'), '2'.padStart(24, '0')]]));
    expect(first.citedOfficialPageFoldIds).toEqual(new Set(['1'.padStart(24, '0')]));
    const second = planAccountlessClusterFolds(
      members.filter((entry) => !first.foldTargetById.has(entry.id)),
      [],
      joins,
    );
    expect(second.foldTargetById.size).toBe(0);
  });

  it('ignores a join to a record outside the cluster', () => {
    const plan = planAccountlessClusterFolds(
      [member('1', { displayName: 'Avery Q. Synth' })],
      [],
      [['1'.padStart(24, '0'), '9'.padStart(24, '0')]],
    );
    expect(plan.foldTargetById.size).toBe(0);
  });
});
