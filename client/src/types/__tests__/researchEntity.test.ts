import { describe, expect, it } from 'vitest';

import {
  normalizeResearchEntityDetailPayload,
  normalizeResearchEntitySearchResponse,
  ResearchEntity,
} from '../researchEntity';

const entity = (overrides: Partial<ResearchEntity> = {}): ResearchEntity => ({
  _id: 'entity-1',
  id: 'entity-1',
  slug: 'digital-humanities-project',
  name: 'Digital Humanities Project',
  kind: 'initiative',
  entityType: 'DIGITAL_HUMANITIES_PROJECT',
  description: 'Archives and computational methods.',
  websiteUrl: 'https://example.edu/project',
  location: '',
  departments: ['History'],
  researchAreas: ['Digital humanities'],
  school: 'Yale College',
  openness: 'unknown',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: [],
  ...overrides,
});

describe('normalizeResearchEntitySearchResponse', () => {
  it('uses canonical researchEntities', () => {
    const canonical = entity({ _id: 'canonical', slug: 'canonical' });
    const legacy = entity({ _id: 'legacy', slug: 'legacy' });

    const result = normalizeResearchEntitySearchResponse({
      researchEntities: [canonical],
      hits: [legacy],
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 24,
    });

    expect(result.researchEntities).toEqual([canonical]);
    expect(result.hits).toEqual([canonical]);
  });

  it('falls back to legacy hits when canonical search entities are absent', () => {
    const legacy = entity({ _id: 'legacy', slug: 'legacy' });

    const result = normalizeResearchEntitySearchResponse({
      hits: [legacy],
      estimatedTotalHits: 1,
      page: 2,
      pageSize: 10,
    } as unknown as Parameters<typeof normalizeResearchEntitySearchResponse>[0]);

    expect(result.researchEntities).toEqual([legacy]);
    expect(result.hits).toEqual([legacy]);
  });

  it('does not fall back to legacy hits', () => {
    const legacy = entity({ _id: 'legacy', slug: 'legacy' });

    const result = normalizeResearchEntitySearchResponse({
      researchEntities: [],
      hits: [legacy],
      estimatedTotalHits: 1,
      page: 2,
      pageSize: 10,
    });

    expect(result.researchEntities).toEqual([]);
    expect(result.hits).toEqual([]);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });
});

describe('normalizeResearchEntityDetailPayload', () => {
  it('uses canonical researchEntity and exposes a local group alias for legacy components', () => {
    const canonical = entity({ _id: 'canonical', slug: 'canonical' });
    const legacy = entity({ _id: 'legacy', slug: 'legacy' });

    const result = normalizeResearchEntityDetailPayload({
      researchEntity: canonical,
      group: legacy,
      members: [],
      recentPapers: [],
      activeListings: [],
    });

    expect(result.researchEntity).toBe(canonical);
    expect(result.group).toBe(legacy);
  });

  it('does not fall back to legacy group when canonical payload is absent', () => {
    const legacy = entity({ _id: 'legacy', slug: 'legacy' });

    const result = normalizeResearchEntityDetailPayload({ group: legacy });

    expect(result.researchEntity).toBe(legacy);
    expect(result.group).toBe(legacy);
  });

  it('throws on payloads that contain neither canonical nor legacy entity data', () => {
    expect(() => normalizeResearchEntityDetailPayload({})).toThrow(
      'Research detail payload is missing researchEntity',
    );
  });
});
