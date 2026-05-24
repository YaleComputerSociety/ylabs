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
  websiteUrl: 'https://project.example.test',
  location: '',
  departments: ['History'],
  researchAreas: ['Digital humanities'],
  school: 'Fixture College',
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

    expect(result.researchEntities).toEqual([
      expect.objectContaining({
        _id: 'canonical',
        slug: 'canonical',
        description: 'Archives and computational methods.',
        researchAreas: ['Digital humanities'],
      }),
    ]);
    expect(result.hits).toEqual(result.researchEntities);
  });

  it('falls back to legacy hits when canonical search entities are absent', () => {
    const legacy = entity({ _id: 'legacy', slug: 'legacy' });

    const result = normalizeResearchEntitySearchResponse({
      hits: [legacy],
      estimatedTotalHits: 1,
      page: 2,
      pageSize: 10,
    } as unknown as Parameters<typeof normalizeResearchEntitySearchResponse>[0]);

    expect(result.researchEntities).toEqual([
      expect.objectContaining({
        _id: 'legacy',
        slug: 'legacy',
        description: 'Archives and computational methods.',
        researchAreas: ['Digital humanities'],
      }),
    ]);
    expect(result.hits).toEqual(result.researchEntities);
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

  it('normalizes public research text and metadata with shared discovery cleanup rules', () => {
    const result = normalizeResearchEntitySearchResponse({
      researchEntities: [
        entity({
          description: 'Publications',
          shortDescription: 'Yale Co-AuthorsFrequent collaborators of Fixture Researcher.',
          researchAreas: [
            'Research',
            'Yale College',
            '844',
            'View Full Profile',
            'Epigenetics and DNA Methylation',
          ],
        }),
      ],
    });

    expect(result.researchEntities[0]).toMatchObject({
      description: '',
      shortDescription: '',
      researchAreas: ['Epigenetics and DNA Methylation'],
    });
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

    expect(result.researchEntity).toEqual(
      expect.objectContaining({
        _id: 'canonical',
        slug: 'canonical',
        description: 'Archives and computational methods.',
      }),
    );
    expect(result.group).toEqual(
      expect.objectContaining({
        _id: 'legacy',
        slug: 'legacy',
        description: 'Archives and computational methods.',
      }),
    );
  });

  it('removes role-only title fragments from detail descriptions', () => {
    const result = normalizeResearchEntityDetailPayload({
      researchEntity: entity({
        description: '',
        shortDescription: 'Co-Director of Graduate Studies',
        fullDescription: 'Track Director, PMB',
      }),
    });

    expect(result.researchEntity.shortDescription).toBe('');
    expect(result.researchEntity.fullDescription).toBe('');
    expect(result.group?.shortDescription).toBe('');
  });

  it('does not fall back to legacy group when canonical payload is absent', () => {
    const legacy = entity({ _id: 'legacy', slug: 'legacy' });

    const result = normalizeResearchEntityDetailPayload({ group: legacy });

    expect(result.researchEntity).toEqual(
      expect.objectContaining({
        _id: 'legacy',
        slug: 'legacy',
        description: 'Archives and computational methods.',
      }),
    );
    expect(result.group).toEqual(result.researchEntity);
  });

  it('throws on payloads that contain neither canonical nor legacy entity data', () => {
    expect(() => normalizeResearchEntityDetailPayload({})).toThrow(
      'Research detail payload is missing researchEntity',
    );
  });
});
