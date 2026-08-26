import { describe, expect, it } from 'vitest';
import {
  applyUnionPlanToSnapshot,
  buildCanonicalNameIndex,
  decideShellMerge,
  normalizeResearcherName,
  planResearcherAttributeUnion,
  researcherAttributeUnionIsEmpty,
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

describe('decideShellMerge', () => {
  const index = buildCanonicalNameIndex([
    { id: 'canonical-roe', displayName: 'Jane Roe', orcid: '0000-0002-1825-0097' },
    { id: 'canonical-doe', displayName: 'John Doe' },
    { id: 'namesake-a', displayName: 'Sam Twin' },
    { id: 'namesake-b', displayName: 'Sam Twin' },
  ]);

  it('merges when exactly one same-name account-linked canonical exists', () => {
    expect(decideShellMerge({ displayName: 'jane roe' }, index)).toEqual({
      merge: true,
      canonicalId: 'canonical-roe',
      reason: 'MERGEABLE',
    });
  });

  it('merges when shell orcid matches the canonical orcid', () => {
    expect(
      decideShellMerge({ displayName: 'Jane Roe', orcid: '0000-0002-1825-0097' }, index),
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
        identifiers: { orcid: '0000-0002-1825-0097', googleScholarId: 'abc' },
        profile: { title: 'Adjunct', primaryDepartment: 'Immunobiology', imageUrl: 'https://i/x' },
      },
    );

    expect(plan.profileLinksToAppend.map((link) => link.kind)).toEqual(['GOOGLE_SCHOLAR']);
    expect(plan.identifierGapFills).toEqual({
      orcid: '0000-0002-1825-0097',
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
        identifiers: { orcid: '0000-0002-1825-0097' },
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
      profileLinks: [{ kind: 'ORCID', url: 'https://orcid.org/0000-0002-1825-0097' }],
      identifiers: { orcid: '0000-0002-1825-0097' },
    });
    const evolved = applyUnionPlanToSnapshot(canonical, firstPlan);

    const secondPlan = planResearcherAttributeUnion(evolved, {
      profileLinks: [{ kind: 'ORCID', url: 'https://orcid.org/9999-9999-9999-9999' }],
      identifiers: { orcid: '9999-9999-9999-9999' },
    });
    expect(researcherAttributeUnionIsEmpty(secondPlan)).toBe(true);
  });
});
