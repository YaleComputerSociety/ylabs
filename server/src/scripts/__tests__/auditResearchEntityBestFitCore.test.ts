import { describe, expect, it } from 'vitest';
import {
  classifyBestFitCoverage,
  summarizeBestFitCoverage,
  type BestFitAuditFacts,
} from '../auditResearchEntityBestFitCore';

function entity(overrides: Partial<BestFitAuditFacts> = {}): BestFitAuditFacts {
  return {
    id: 'entity-1',
    slug: 'example-lab',
    name: 'Example Lab',
    archived: false,
    descriptionSource: 'ENTITY_SOURCE',
    researchAreas: [],
    profileResearchAreas: [],
    piProfileTerms: [],
    ...overrides,
  };
}

describe('classifyBestFitCoverage', () => {
  it('accepts specific entity-level research areas as usable best-fit topics', () => {
    const row = classifyBestFitCoverage(
      entity({
        researchAreas: ['Machine Learning', 'Archival Research'],
        piProfileTerms: ['Consumer Behavior'],
      }),
    );

    expect(row.status).toBe('usable');
    expect(row.usableResearchAreas).toEqual(['Machine Learning', 'Archival Research']);
    expect(row.issues).toEqual([]);
  });

  it('flags active public entities with no entity-level research areas as missing', () => {
    const row = classifyBestFitCoverage(entity());

    expect(row.status).toBe('missing');
    expect(row.issues).toContain('NO_ENTITY_RESEARCH_AREAS');
  });

  it('flags broad Yale school and faculty labels as generic-only', () => {
    const row = classifyBestFitCoverage(
      entity({
        researchAreas: ['Yale School of Medicine', 'Yale Faculty'],
      }),
    );

    expect(row.status).toBe('genericOnly');
    expect(row.usableResearchAreas).toEqual([]);
    expect(row.issues).toContain('GENERIC_ONLY_RESEARCH_AREAS');
  });

  it('flags entity topics that exactly mirror PI profile interests', () => {
    const row = classifyBestFitCoverage(
      entity({
        researchAreas: ['Decision-Making and Behavioral Economics', 'Consumer Behavior'],
        piProfileTerms: ['Consumer Behavior', 'Decision-Making and Behavioral Economics'],
      }),
    );

    expect(row.status).toBe('piFallbackOnly');
    expect(row.profileResearchAreas).toEqual([
      'Consumer Behavior',
      'Decision-Making and Behavioral Economics',
    ]);
    expect(row.issues).toContain('PI_PROFILE_TERMS_ONLY');
  });

  it('classifies PI profile synthesis pages with no entity topics as sparse profile rows', () => {
    const row = classifyBestFitCoverage(
      entity({
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        profileResearchAreas: ['Soft Robotics'],
        piProfileTerms: ['Soft Robotics'],
      }),
    );

    expect(row.status).toBe('sparseProfile');
    expect(row.issues).toContain('SPARSE_PROFILE_FALLBACK');
  });
});

describe('summarizeBestFitCoverage', () => {
  it('counts rows by best-fit coverage status', () => {
    const rows = [
      classifyBestFitCoverage(entity({ slug: 'usable', researchAreas: ['Archival Research'] })),
      classifyBestFitCoverage(entity({ slug: 'missing' })),
      classifyBestFitCoverage(
        entity({
          slug: 'fallback',
          researchAreas: ['Consumer Behavior'],
          piProfileTerms: ['Consumer Behavior'],
        }),
      ),
    ];

    expect(summarizeBestFitCoverage(rows)).toEqual({
      total: 3,
      usable: 1,
      missing: 1,
      genericOnly: 0,
      piFallbackOnly: 1,
      sparseProfile: 0,
    });
  });
});
