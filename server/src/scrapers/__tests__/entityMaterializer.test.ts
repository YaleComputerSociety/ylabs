import { describe, expect, it } from 'vitest';
import {
  addPostMaterializationMetrics,
  buildPaperUpdateFromObservations,
  countListingBackedPostedOpportunitiesForRun,
  emptyPostMaterializationMetrics,
  mergeMaterializedArrayField,
  mergeUniqueArrayValues,
  normalizeDoiForMaterialization,
  shouldClearIgnoredAccessClaimForEntity,
  shouldIgnoreObservationForEntityMaterialization,
  shouldUnionMaterializedField,
  uniqueKeyValueForIdentifier,
} from '../entityMaterializer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';

describe('entityMaterializer post-materialization metrics', () => {
  it('normalizes DOI values for paper identity matching', () => {
    expect(normalizeDoiForMaterialization(' https://doi.org/10.1000/ABC ')).toBe(
      '10.1000/abc',
    );
    expect(normalizeDoiForMaterialization('')).toBeNull();
    expect(normalizeDoiForMaterialization(undefined)).toBeNull();
  });

  it('normalizes prefixed user entity keys to the stored netid value', () => {
    expect(
      uniqueKeyValueForIdentifier('user', 'netid:yang.cai', [
        { field: 'netid', value: 'yang.cai' },
      ]),
    ).toBe('yang.cai');
    expect(uniqueKeyValueForIdentifier('user', 'netid:abc123', [])).toBe('abc123');
    expect(uniqueKeyValueForIdentifier('researchEntity', 'dept-cs-example', [])).toBe(
      'dept-cs-example',
    );
  });

  it('unions set-like paper fields without duplicating values', () => {
    expect(mergeUniqueArrayValues(['u1', 'u2'], ['u2', 'u3'])).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(mergeUniqueArrayValues(undefined, 'arxiv')).toEqual(['arxiv']);
  });

  it('treats research entity evidence arrays as union fields', () => {
    expect(shouldUnionMaterializedField('researchEntity', 'sourceUrls')).toBe(true);
    expect(shouldUnionMaterializedField('researchEntity', 'departments')).toBe(true);
    expect(shouldUnionMaterializedField('researchGroup', 'researchAreas')).toBe(true);
    expect(shouldUnionMaterializedField('researchEntity', 'websiteUrl')).toBe(false);
    expect(shouldUnionMaterializedField('user', 'departments')).toBe(false);
  });

  it('unions all observed values for materialized additive array fields', () => {
    expect(
      mergeMaterializedArrayField(
        ['https://physics.yale.edu/people/marie-curie'],
        [
          {
            field: 'sourceUrls',
            value: [
              'https://physics.yale.edu/people/faculty',
              'https://curielab.yale.edu/',
            ],
          },
          {
            field: 'sourceUrls',
            value: ['https://physics.yale.edu/people/marie-curie'],
          },
          { field: 'departments', value: ['Physics'] },
        ],
        'sourceUrls',
      ),
    ).toEqual([
      'https://physics.yale.edu/people/marie-curie',
      'https://physics.yale.edu/people/faculty',
      'https://curielab.yale.edu/',
    ]);
  });

  it('builds paper bulk updates that union repeated set-like metadata observations', () => {
    const patch = buildPaperUpdateFromObservations(
      'https://openalex.org/W1',
      [
        {
          field: 'title',
          value: 'Shared paper',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'authors',
          value: ['Author One'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'authors',
          value: ['Author Two'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'sources',
          value: ['openalex'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$set).toMatchObject({
      openAlexId: 'https://openalex.org/W1',
      title: 'Shared paper',
    });
    expect(patch.update.$addToSet).toMatchObject({
      authors: { $each: ['Author One', 'Author Two'] },
      sources: { $each: ['openalex'] },
    });
  });

  it('ignores untrusted paper-source author ids when building paper updates', () => {
    const patch = buildPaperUpdateFromObservations(
      '2401.01234',
      [
        {
          field: 'arxivId',
          value: '2401.01234',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'title',
          value: 'A name-matched preprint',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'yaleAuthorIds',
          value: ['64f000000000000000000001'],
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'yaleAuthorNetIds',
          value: ['aa1'],
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$addToSet || {}).not.toHaveProperty('yaleAuthorIds');
    expect(patch.update.$addToSet || {}).not.toHaveProperty('yaleAuthorNetIds');
  });

  it('derives denormalized paper authors from identity-backed authorship evidence', () => {
    const patch = buildPaperUpdateFromObservations(
      'https://openalex.org/W1',
      [
        {
          field: 'title',
          value: 'An identity-backed paper',
          sourceName: 'openalex',
          confidence: 0.9,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'paperAuthorshipEvidence',
          value: {
            userId: '64f000000000000000000001',
            netid: 'aa1',
            displayName: 'Amy Arnsten',
            sourceName: 'openalex',
            method: 'openalex-orcid',
            externalAuthorIds: {
              openAlex: 'https://openalex.org/A1',
              orcid: '0000-0001-2345-6789',
            },
          },
          sourceName: 'openalex',
          confidence: 0.95,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$addToSet).toMatchObject({
      yaleAuthorIds: { $each: ['64f000000000000000000001'] },
      yaleAuthorNetIds: { $each: ['aa1'] },
    });
    expect(patch.update.$set).not.toHaveProperty('paperAuthorshipEvidence');
  });

  it('keys arXiv paper bulk updates by arxivId rather than openAlexId', () => {
    const patch = buildPaperUpdateFromObservations(
      '2401.01234',
      [
        {
          field: 'arxivId',
          value: '2401.01234',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'title',
          value: 'A careful arXiv paper',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$set).toMatchObject({
      arxivId: '2401.01234',
      title: 'A careful arXiv paper',
    });
    expect(patch.update.$set).not.toHaveProperty('openAlexId');
  });

  it('starts with zeroed access artifact counters', () => {
    expect(emptyPostMaterializationMetrics()).toEqual({
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      postedOpportunities: 0,
      guardedContactRoutes: 0,
      staleEvidenceSkipped: 0,
      conflicts: 0,
      errors: 0,
    });
  });

  it('aggregates partial access artifact counters defensively', () => {
    const aggregate = emptyPostMaterializationMetrics();

    addPostMaterializationMetrics(aggregate, {
      entryPathways: 2,
      accessSignals: 3,
      contactRoutes: 1,
      guardedContactRoutes: 1,
    });
    addPostMaterializationMetrics(aggregate, {
      postedOpportunities: 4,
      staleEvidenceSkipped: 2,
      conflicts: 1,
      errors: 1,
    });
    addPostMaterializationMetrics(aggregate);

    expect(aggregate).toEqual({
      entryPathways: 2,
      accessSignals: 3,
      contactRoutes: 1,
      postedOpportunities: 4,
      guardedContactRoutes: 1,
      staleEvidenceSkipped: 2,
      conflicts: 1,
      errors: 1,
    });
  });

  it('counts posted opportunities linked to listing observations in a scrape run', async () => {
    const listingId = '64f000000000000000000099';
    const observationModel = {
      aggregate: async () => [{ _id: listingId }, { _id: undefined }],
    };
    const postedOpportunityModel = {
      countDocuments: async (filter: any) => {
        expect(filter.listingId.$in.map(String)).toEqual([listingId]);
        return 1;
      },
    };

    await expect(
      countListingBackedPostedOpportunitiesForRun('64f000000000000000000001', {
        observationModel: observationModel as any,
        postedOpportunityModel: postedOpportunityModel as any,
      }),
    ).resolves.toBe(1);
  });

  it('returns zero listing-backed posted opportunities when listing ids are missing', async () => {
    const observationModel = {
      aggregate: async () => [{ _id: undefined }, { _id: 'not-an-object-id' }],
    };
    const postedOpportunityModel = {
      countDocuments: async () => {
        throw new Error('should not count without valid listing ids');
      },
    };

    await expect(
      countListingBackedPostedOpportunitiesForRun('64f000000000000000000001', {
        observationModel: observationModel as any,
        postedOpportunityModel: postedOpportunityModel as any,
      }),
    ).resolves.toBe(0);
  });

  it('ignores discovery-only acceptingUndergrads observations for research groups', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchGroup', {
        field: 'acceptingUndergrads',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchGroup', {
        field: 'acceptingUndergrads',
        sourceName: 'lab-microsite-undergrad-llm',
      }),
    ).toBe(false);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'acceptingUndergrads',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(false);
  });

  it('clears legacy discovery-only acceptance claims unless manually locked or supported', () => {
    expect(
      shouldClearIgnoredAccessClaimForEntity('researchGroup', [
        { field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' },
        { field: 'acceptingUndergrads', sourceName: 'yse-centers-index' },
      ]),
    ).toBe(true);
    expect(
      shouldClearIgnoredAccessClaimForEntity(
        'researchGroup',
        [{ field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' }],
        ['acceptingUndergrads'],
      ),
    ).toBe(false);
    expect(
      shouldClearIgnoredAccessClaimForEntity('researchGroup', [
        { field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' },
        { field: 'acceptingUndergrads', sourceName: 'lab-microsite-undergrad-llm' },
      ]),
    ).toBe(false);
  });

  it('redacts direct contact details consistently for materialized public excerpts', () => {
    expect(redactDirectContactInfo('Email ada@yale.edu or call 203-432-1234.')).toBe(
      'Email [email redacted] or call [phone redacted].',
    );
  });
});
