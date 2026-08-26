import { describe, expect, it } from 'vitest';
import {
  buildCanonicalNameIndex,
  decideShellMerge,
  normalizeResearcherName,
  roleAssignmentEdgeKey,
} from '../dedupeAccountlessResearcherShellsCore';

describe('dedupeAccountlessResearcherShells core', () => {
  it('normalizes names by trimming, lowercasing, and collapsing whitespace', () => {
    expect(normalizeResearcherName('  Bruce   Ackerman ')).toBe('bruce ackerman');
    expect(normalizeResearcherName('JANE MIKKELSON')).toBe('jane mikkelson');
    expect(normalizeResearcherName('')).toBeUndefined();
    expect(normalizeResearcherName(undefined)).toBeUndefined();
  });

  it('merges an accountless shell into the sole same-name account-linked canonical', () => {
    const index = buildCanonicalNameIndex([{ id: 'canon1', displayName: 'Bruce Ackerman' }]);
    expect(decideShellMerge({ displayName: 'bruce ackerman' }, index)).toEqual({
      merge: true,
      canonicalId: 'canon1',
      reason: 'MERGEABLE',
    });
  });

  it('fails closed when the name matches multiple canonicals (real namesakes)', () => {
    const index = buildCanonicalNameIndex([
      { id: 'canonA', displayName: 'John Smith' },
      { id: 'canonB', displayName: 'John Smith' },
    ]);
    expect(decideShellMerge({ displayName: 'John Smith' }, index)).toEqual({
      merge: false,
      reason: 'AMBIGUOUS_MULTIPLE_CANONICAL',
    });
  });

  it('leaves accountless researchers with no same-name canonical untouched', () => {
    const index = buildCanonicalNameIndex([{ id: 'canon1', displayName: 'Bruce Ackerman' }]);
    expect(decideShellMerge({ displayName: 'Grant Only Pi' }, index)).toEqual({
      merge: false,
      reason: 'NO_CANONICAL',
    });
  });

  it('fails closed when the shell carries a conflicting ORCID', () => {
    const index = buildCanonicalNameIndex([
      { id: 'canon1', displayName: 'Bruce Ackerman', orcid: '0000-0002-1825-0097' },
    ]);
    expect(
      decideShellMerge({ displayName: 'Bruce Ackerman', orcid: '0000-0001-2345-6789' }, index),
    ).toEqual({ merge: false, reason: 'ORCID_CONFLICT' });
    expect(
      decideShellMerge({ displayName: 'Bruce Ackerman', orcid: '0000-0002-1825-0097' }, index).merge,
    ).toBe(true);
  });

  it('skips shells with no usable name', () => {
    const index = buildCanonicalNameIndex([{ id: 'canon1', displayName: 'Bruce Ackerman' }]);
    expect(decideShellMerge({ displayName: '   ' }, index)).toEqual({
      merge: false,
      reason: 'NO_NAME',
    });
  });

  it('keys role-assignment edges by target kind, target id, and role', () => {
    expect(
      roleAssignmentEdgeKey({ targetKind: 'RESEARCH_ENTITY', targetId: 'abc', role: 'PI' }),
    ).toBe('RESEARCH_ENTITY::abc::PI');
    expect(
      roleAssignmentEdgeKey({ targetKind: 'RESEARCH_ENTITY', targetId: 'abc', role: 'PI' }),
    ).toBe(roleAssignmentEdgeKey({ targetKind: 'RESEARCH_ENTITY', targetId: 'abc', role: 'PI' }));
    expect(
      roleAssignmentEdgeKey({ targetKind: 'RESEARCH_ENTITY', targetId: 'abc', role: 'CORE_FACULTY' }),
    ).not.toBe(roleAssignmentEdgeKey({ targetKind: 'RESEARCH_ENTITY', targetId: 'abc', role: 'PI' }));
  });
});
