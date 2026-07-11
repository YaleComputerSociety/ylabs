import { describe, expect, it } from 'vitest';
import {
  canonicalScholarlyWorkKey,
  evaluateResearchActivityIntegrity,
  researchActivityIntegrityCounts,
} from '../researchActivityIntegrity';
import { buildResearchActivityIntegrityAuditReport } from '../../scripts/researchActivityIntegrityAudit';

describe('research activity integrity', () => {
  it('excludes the known wrong-person military and veteran collision from an immunology lab', () => {
    const [decision] = evaluateResearchActivityIntegrity(
      [
        {
          memberDisplayId: 'faculty-public-key',
          relationshipBasis: 'identity_authorship',
          link: {
            title: 'LGBT military personnel and veteran homelessness',
            url: 'https://example.org/collision',
            year: 2025,
          },
        },
      ],
      ['Immunology', 'T cell signaling and immune disease'],
    );

    expect(decision.disposition).toBe('identity_conflict');
    expect(decision.reason).toBe('Topic conflict without persistent-author evidence');
  });

  it('retains cross-disciplinary work when persistent author identity evidence is present', () => {
    const [decision] = evaluateResearchActivityIntegrity(
      [
        {
          memberDisplayId: 'faculty-public-key',
          relationshipBasis: 'orcid-record',
          link: {
            title: 'Machine learning models of immune cell signaling',
            externalIds: {
              doi: '10.1000/cross-disciplinary',
              authorOrcids: ['0000-0001-0000-0000'],
            },
            year: 2025,
          },
        },
      ],
      ['Immunology', 'T cell signaling'],
    );

    expect(decision.disposition).toBe('current');
  });

  it('collapses DOI and versioned arXiv duplicates by canonical identity', () => {
    const decisions = evaluateResearchActivityIntegrity(
      [
        { link: { title: 'DOI one', externalIds: { doi: 'https://doi.org/10.1000/SAME' } } },
        { link: { title: 'DOI two', externalIds: { doi: '10.1000/same' } } },
        { link: { title: 'Preprint one', externalIds: { arxivId: '2604.01023v2' } } },
        { link: { title: 'Preprint two', url: 'https://arxiv.org/abs/2604.01023v3' } },
      ],
      [],
    );

    expect(decisions.map((decision) => decision.disposition)).toEqual([
      'current',
      'duplicate',
      'current',
      'duplicate',
    ]);
    expect(canonicalScholarlyWorkKey(decisions[0].candidate.link)).toBe('doi:10.1000/same');
  });

  it('separates work before a documented appointment without calling missing coverage inactive', () => {
    const decisions = evaluateResearchActivityIntegrity(
      [
        { link: { title: 'Earlier paper', year: 2018 }, appointmentStartedAt: '2020-07-01' },
        { link: { title: 'Unknown timing' } },
      ],
      [],
    );

    expect(decisions.map((decision) => decision.disposition)).toEqual(['earlier', 'current']);
    expect(researchActivityIntegrityCounts(decisions)).toEqual({
      current: 1,
      earlier: 1,
      identity_conflict: 0,
      duplicate: 0,
    });
    expect(JSON.stringify(decisions)).not.toMatch(/inactive/i);
  });

  it('reports affected counts without titles, people, or entity identifiers', () => {
    const decisions = evaluateResearchActivityIntegrity(
      [
        { link: { title: 'Veteran homelessness', url: 'https://example.org/wrong' } },
        { link: { title: 'Earlier immunology', year: 2018 }, appointmentStartedAt: '2020-01-01' },
      ],
      ['Immunology'],
    );
    const report = buildResearchActivityIntegrityAuditReport(
      new Map([['private-entity-id', decisions]]),
      new Date('2026-07-11T12:00:00Z'),
    );

    expect(report).toEqual({
      generatedAt: '2026-07-11T12:00:00.000Z',
      mode: 'read-only',
      counts: { current: 0, earlier: 1, identity_conflict: 1, duplicate: 0 },
      entitiesEvaluated: 1,
      entitiesWithExcludedConflicts: 1,
      entitiesWithDuplicates: 0,
      entitiesWithEarlierWork: 1,
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private-entity-id|Veteran homelessness|Earlier immunology/,
    );
  });
});
