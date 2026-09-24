import { describe, expect, it } from 'vitest';
import {
  applyUnionPlanToSnapshot,
  bareNetid,
  buildCanonicalNameIndex,
  buildCanonicalNetidIndex,
  decideShellMerge,
  normalizeResearcherName,
  planResearcherAttributeUnion,
  researcherAttributeUnionIsEmpty,
  researcherIdentityTier,
  roleAssignmentEdgeKey,
} from '../dedupeAccountlessResearcherShellsCore';

describe('normalizeResearcherName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeResearcherName('  Jane   Q  Roe ')).toBe('jane q roe');
  });

  it('rejects non-strings and empty strings', () => {
    expect(normalizeResearcherName(undefined)).toBeUndefined();
    expect(normalizeResearcherName('   ')).toBeUndefined();
  });
});

describe('researcherIdentityTier', () => {
  it('ranks an account link above a netid and a netid above a bare name', () => {
    expect(researcherIdentityTier({ accountId: 'account-1', netid: 'ab12' })).toBe('ACCOUNT');
    expect(researcherIdentityTier({ netid: 'ab12' })).toBe('NETID');
    expect(researcherIdentityTier({})).toBe('NAME_ONLY');
  });

  it('treats a blank or non-string netid as no identity at all', () => {
    expect(researcherIdentityTier({ netid: '   ' })).toBe('NAME_ONLY');
    expect(researcherIdentityTier({ netid: null })).toBe('NAME_ONLY');
    expect(researcherIdentityTier({ accountId: null, netid: '' })).toBe('NAME_ONLY');
  });
});

describe('decideShellMerge', () => {
  const index = buildCanonicalNameIndex([
    {
      id: 'canonical-roe',
      displayName: 'Jane Roe',
      accountId: 'account-roe',
      orcid: '0000-0001-2222-3333',
    },
    { id: 'canonical-doe', displayName: 'John Doe', accountId: 'account-doe' },
    { id: 'namesake-a', displayName: 'Sam Twin', accountId: 'account-twin-a' },
    { id: 'namesake-b', displayName: 'Sam Twin', accountId: 'account-twin-b' },
  ]);

  it('merges when exactly one same-name account-linked canonical exists', () => {
    expect(decideShellMerge({ displayName: 'jane roe' }, index)).toEqual({
      merge: true,
      canonicalId: 'canonical-roe',
      reason: 'MERGEABLE',
      matchedOn: 'name',
    });
  });

  it('merges when shell orcid matches the canonical orcid', () => {
    expect(
      decideShellMerge({ displayName: 'Jane Roe', orcid: '0000-0001-2222-3333' }, index),
    ).toMatchObject({ merge: true, reason: 'MERGEABLE' });
  });

  it('excludes a shell with no name', () => {
    expect(decideShellMerge({ displayName: '   ' }, index)).toEqual({
      merge: false,
      reason: 'NO_NAME',
    });
  });

  it('excludes a shell with no same-name canonical', () => {
    expect(decideShellMerge({ displayName: 'Nobody Here' }, index)).toEqual({
      merge: false,
      reason: 'NO_CANONICAL',
    });
  });

  it('excludes a true namesake with multiple same-name canonicals', () => {
    expect(decideShellMerge({ displayName: 'Sam Twin' }, index)).toEqual({
      merge: false,
      reason: 'AMBIGUOUS_MULTIPLE_CANONICAL',
    });
  });

  it('excludes on ORCID conflict against the sole canonical', () => {
    expect(
      decideShellMerge({ displayName: 'Jane Roe', orcid: '0000-0001-0000-0000' }, index),
    ).toEqual({ merge: false, reason: 'ORCID_CONFLICT' });
  });

  const netidIndex = buildCanonicalNameIndex([
    { id: 'canonical-netid', displayName: 'Nina Netid', netid: 'nn42' },
  ]);

  it('folds a name-only shell into a netid-backed canonical of the same name', () => {
    expect(decideShellMerge({ id: 'name-only', displayName: 'Nina Netid' }, netidIndex)).toEqual({
      merge: true,
      canonicalId: 'canonical-netid',
      reason: 'MERGEABLE',
      matchedOn: 'name',
    });
  });

  it('never folds a netid-backed shell into a same-name netid-backed peer', () => {
    expect(
      decideShellMerge({ id: 'other-netid', displayName: 'Nina Netid', netid: 'nn99' }, netidIndex),
    ).toEqual({ merge: false, reason: 'NO_CANONICAL' });
  });

  it('never folds a canonical into itself', () => {
    expect(
      decideShellMerge(
        { id: 'canonical-netid', displayName: 'Nina Netid', netid: 'nn42' },
        netidIndex,
      ),
    ).toEqual({ merge: false, reason: 'NO_CANONICAL' });
  });

  const mixedIndex = buildCanonicalNameIndex([
    { id: 'account-backed', displayName: 'Nina Netid', accountId: 'account-nina' },
    { id: 'netid-backed', displayName: 'Nina Netid', netid: 'nn42' },
  ]);

  it('prefers the account-backed canonical over a same-name netid-backed one', () => {
    expect(decideShellMerge({ id: 'name-only', displayName: 'Nina Netid' }, mixedIndex)).toEqual({
      merge: true,
      canonicalId: 'account-backed',
      reason: 'MERGEABLE',
      matchedOn: 'name',
    });
  });

  it('folds a netid-backed shell into the account-backed canonical of the same name', () => {
    expect(
      decideShellMerge(
        { id: 'netid-backed', displayName: 'Nina Netid', netid: 'nn42' },
        mixedIndex,
      ),
    ).toEqual({
      merge: true,
      canonicalId: 'account-backed',
      reason: 'MERGEABLE',
      matchedOn: 'name',
    });
  });

  const accountWithNetidIndex = buildCanonicalNameIndex([
    {
      id: 'canonical-account-netid',
      displayName: 'Nina Netid',
      accountId: 'account-nina',
      netid: 'nn42',
    },
  ]);

  it('merges when the shell netid matches the canonical netid', () => {
    expect(
      decideShellMerge(
        { id: 'netid-shell', displayName: 'Nina Netid', netid: 'NN42' },
        accountWithNetidIndex,
      ),
    ).toEqual({
      merge: true,
      canonicalId: 'canonical-account-netid',
      reason: 'MERGEABLE',
      matchedOn: 'name',
    });
  });

  it('excludes on netid conflict against the sole canonical', () => {
    expect(
      decideShellMerge(
        { id: 'netid-shell', displayName: 'Nina Netid', netid: 'other99' },
        accountWithNetidIndex,
      ),
    ).toEqual({ merge: false, reason: 'NETID_CONFLICT' });
  });
});

describe('roleAssignmentEdgeKey', () => {
  it('keys on target kind, id, and role', () => {
    expect(
      roleAssignmentEdgeKey({ targetKind: 'RESEARCH_ENTITY', targetId: 'entity-1', role: 'PI' }),
    ).toBe('RESEARCH_ENTITY::entity-1::PI');
  });

  it('produces identical keys for the same edge on shell and canonical', () => {
    const shellEdge = { targetKind: 'RESEARCH_ENTITY', targetId: 'entity-1', role: 'PI' };
    const canonicalEdge = { targetKind: 'RESEARCH_ENTITY', targetId: 'entity-1', role: 'PI' };
    expect(roleAssignmentEdgeKey(shellEdge)).toBe(roleAssignmentEdgeKey(canonicalEdge));
  });
});

describe('planResearcherAttributeUnion', () => {
  it('gap-fills profile links, identifiers, and profile fields the canonical lacks', () => {
    const plan = planResearcherAttributeUnion(
      {
        profileLinks: [{ kind: 'YALE_OFFICIAL', url: 'https://x.yale.edu/canonical' }],
        identifiers: { orcid: undefined },
        profile: { title: 'Professor' },
      },
      {
        profileLinks: [
          { kind: 'GOOGLE_SCHOLAR', url: 'https://scholar.google.com/citations?user=abc' },
        ],
        identifiers: { orcid: '0000-0001-2222-3333', googleScholarId: 'abc' },
        profile: { title: 'Adjunct', primaryDepartment: 'Immunobiology', imageUrl: 'https://i/x' },
      },
    );

    expect(plan.profileLinksToAppend.map((link) => link.kind)).toEqual(['GOOGLE_SCHOLAR']);
    expect(plan.identifierGapFills).toEqual({
      orcid: '0000-0001-2222-3333',
      googleScholarId: 'abc',
    });
    expect(plan.profileGapFills).toEqual({
      primaryDepartment: 'Immunobiology',
      imageUrl: 'https://i/x',
    });
  });

  it('never overwrites values the canonical already holds', () => {
    const plan = planResearcherAttributeUnion(
      {
        profileLinks: [{ kind: 'YALE_OFFICIAL', url: 'https://canonical.yale.edu' }],
        identifiers: { orcid: '0000-0001-2222-3333' },
        profile: { title: 'Professor', primaryDepartment: 'Physics' },
      },
      {
        profileLinks: [{ kind: 'YALE_OFFICIAL', url: 'https://shell.yale.edu' }],
        identifiers: { orcid: '0000-0001-0000-0000' },
        profile: { title: 'Lecturer', primaryDepartment: 'Chemistry' },
      },
    );

    expect(researcherAttributeUnionIsEmpty(plan)).toBe(true);
  });

  it('applies a plan into an evolving snapshot so a second shell sees prior fills', () => {
    const canonical = { profileLinks: [], identifiers: {}, profile: {} };
    const firstPlan = planResearcherAttributeUnion(canonical, {
      profileLinks: [{ kind: 'ORCID', url: 'https://orcid.org/0000-0001-2222-3333' }],
      identifiers: { orcid: '0000-0001-2222-3333' },
    });
    const evolved = applyUnionPlanToSnapshot(canonical, firstPlan);

    const secondPlan = planResearcherAttributeUnion(evolved, {
      profileLinks: [{ kind: 'ORCID', url: 'https://orcid.org/9999-9999-9999-9999' }],
      identifiers: { orcid: '9999-9999-9999-9999' },
    });
    expect(researcherAttributeUnionIsEmpty(secondPlan)).toBe(true);
  });
});

describe('bareNetid', () => {
  it('accepts a bare netid and rejects anything a lookup would not join on', () => {
    expect(bareNetid('AB12')).toBe('ab12');
    expect(bareNetid('  jq44  ')).toBe('jq44');
    expect(bareNetid('https://example.invalid/people/jq44')).toBeUndefined();
    expect(bareNetid('jq 44')).toBeUndefined();
    expect(bareNetid('4q44')).toBeUndefined();
    expect(bareNetid('')).toBeUndefined();
    expect(bareNetid(undefined)).toBeUndefined();
  });
});

describe('decideShellMerge netid arm (#3166)', () => {
  const netidIndex = buildCanonicalNetidIndex([
    { id: 'twin', accountId: 'account-1', netid: 'ab12' },
    { id: 'nameonly', netid: 'zz99' },
  ]);
  const emptyNameIndex = buildCanonicalNameIndex([]);

  it('folds a netid holder into the account-linked twin despite disagreeing names', () => {
    expect(
      decideShellMerge(
        { id: 'holder', displayName: 'A Wholly Different Name', netid: 'ab12' },
        emptyNameIndex,
        netidIndex,
      ),
    ).toEqual({ merge: true, canonicalId: 'twin', reason: 'MERGEABLE', matchedOn: 'netid' });
  });

  it('folds even when the shell has no usable name at all, which the name arm refuses', () => {
    expect(
      decideShellMerge(
        { id: 'holder', displayName: '   ', netid: 'ab12' },
        emptyNameIndex,
        netidIndex,
      ),
    ).toMatchObject({ merge: true, canonicalId: 'twin', matchedOn: 'netid' });
  });

  it('will not match on a netid that is not bare, so a malformed key decides nothing', () => {
    expect(
      decideShellMerge(
        { id: 'holder', displayName: 'Someone', netid: 'https://example.invalid/ab12' },
        emptyNameIndex,
        netidIndex,
      ),
    ).toMatchObject({ merge: false, reason: 'NO_CANONICAL' });
  });

  it('refuses a netid whose only same-netid row does not outrank the shell', () => {
    expect(
      decideShellMerge(
        { id: 'holder', displayName: 'Someone', netid: 'zz99' },
        emptyNameIndex,
        netidIndex,
      ),
    ).toMatchObject({ merge: false, reason: 'NO_CANONICAL' });
  });

  it('refuses a netid fold when the two rows disagree on ORCID', () => {
    const index = buildCanonicalNetidIndex([
      { id: 'twin', accountId: 'account-1', netid: 'ab12', orcid: '0000-0001-2222-3333' },
    ]);
    expect(
      decideShellMerge(
        { id: 'holder', displayName: 'Someone', netid: 'ab12', orcid: '0000-0001-0000-0000' },
        emptyNameIndex,
        index,
      ),
    ).toMatchObject({ merge: false, reason: 'ORCID_CONFLICT', matchedOn: 'netid' });
  });

  it('leaves the name arm reachable and labelled when no netid matches', () => {
    const nameIndex = buildCanonicalNameIndex([
      { id: 'canonical', displayName: 'Jane Roe', accountId: 'account-9' },
    ]);
    expect(
      decideShellMerge({ id: 'shell', displayName: 'Jane Roe' }, nameIndex, netidIndex),
    ).toEqual({ merge: true, canonicalId: 'canonical', reason: 'MERGEABLE', matchedOn: 'name' });
  });
});
