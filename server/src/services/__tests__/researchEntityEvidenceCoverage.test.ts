import { describe, expect, it } from 'vitest';

import {
  assessResearchEntityEvidenceCoverage,
  buildEvidenceCoverageImpact,
  buildEvidenceCoverageImpactReportForObservations,
  summarizeEvidenceCoverage,
} from '../researchEntityEvidenceCoverage';

describe('assessResearchEntityEvidenceCoverage', () => {
  it('classifies listing-only records as thin even when they have access evidence', () => {
    const assessment = assessResearchEntityEvidenceCoverage({
      entity: {
        name: 'Peters Lab',
        description: '',
        shortDescription: '',
        fullDescription: '',
        sourceUrls: ['http://filmstudies.yale.edu/people/john-durham-peters'],
      },
      listings: [
        {
          ownerId: 'fx1003',
          title: 'John Durham Peters',
          websites: ['http://filmstudies.yale.edu/people/john-durham-peters'],
        },
      ],
      members: [],
      accessSignals: [{ signalType: 'POSTED_OPENING', confidence: 'HIGH' }],
      contactRoutes: [],
      observations: [{ sourceName: 'ylabs-listing', field: 'description' }],
    });

    expect(assessment.coverageTier).toBe('thin');
    expect(assessment.claimStates).toMatchObject({
      description: 'missing',
      lead: 'missing',
      access: 'supported',
      action: 'supported',
    });
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        'missing_source_backed_description',
        'missing_verified_lead',
        'listing_only_profile',
      ]),
    );
    expect(assessment.suggestedSourceTypes).toEqual(
      expect.arrayContaining(['official-profile-page', 'official-lab-homepage']),
    );
  });

  it('rejects publication blurbs as description evidence but keeps them as topic support', () => {
    const assessment = assessResearchEntityEvidenceCoverage({
      entity: {
        name: 'Peters Lab',
        description:
          'This book explores the materiality of communication and provides a genealogy of the information age.',
        sourceUrls: ['http://filmstudies.yale.edu/people/john-durham-peters'],
      },
      listings: [{ ownerId: 'fx1003' }],
      members: [{ role: 'pi', userId: 'fixture-user' }],
      accessSignals: [{ signalType: 'POSTED_OPENING' }],
      contactRoutes: [],
      observations: [
        {
          sourceName: 'ylabs-listing',
          field: 'description',
          value:
            'This book explores the materiality of communication and provides a genealogy of the information age.',
        },
      ],
    });

    expect(assessment.claimStates.description).toBe('weak');
    expect(assessment.blockers).toContain('wrong_evidence_type_description');
    expect(assessment.rejectedFields).toEqual([
      {
        field: 'description',
        reason: 'publication_or_book_blurb',
        sourceName: 'ylabs-listing',
      },
    ]);
  });

  it('classifies independently sourced official lab records as ready candidates', () => {
    const assessment = assessResearchEntityEvidenceCoverage({
      entity: {
        name: 'Ho Lab',
        fullDescription:
          'The Ho Lab studies viral pathogenesis in human health using genomics, immunology, single-cell multi-omics, spatial transcriptomics, and clinical samples.',
        sourceUrls: ['https://medicine.yale.edu/lab/ho/'],
        websiteUrl: 'https://medicine.yale.edu/lab/ho/',
      },
      listings: [],
      members: [{ role: 'pi', userId: 'fixture-user', sourceUrl: 'https://medicine.yale.edu/lab/ho/' }],
      accessSignals: [{ signalType: 'UNDERGRAD_PARTICIPATION', confidence: 'HIGH' }],
      contactRoutes: [{ routeType: 'OFFICIAL_PAGE', url: 'https://medicine.yale.edu/lab/ho/' }],
      observations: [
        { sourceName: 'ysm-atoz-index', field: 'description' },
        { sourceName: 'ysm-atoz-index', field: 'inferredPiUserId' },
      ],
    });

    expect(assessment.coverageTier).toBe('ready_candidate');
    expect(assessment.blockers).toEqual([]);
  });
});

describe('buildEvidenceCoverageImpact', () => {
  it('reports resolved and remaining blockers after overlaying dry-run observations', () => {
    const impact = buildEvidenceCoverageImpact({
      entityType: 'researchEntity',
      entityKey: 'peters-lab-fx1003',
      before: {
        entity: {
          name: 'Peters Lab',
          description: '',
          sourceUrls: ['http://filmstudies.yale.edu/people/john-durham-peters'],
        },
        listings: [{ websites: ['http://filmstudies.yale.edu/people/john-durham-peters'] }],
        members: [],
        accessSignals: [{ signalType: 'POSTED_OPENING' }],
        contactRoutes: [],
        observations: [{ sourceName: 'ylabs-listing', field: 'description' }],
      },
      observations: [
        {
          entityType: 'researchEntity',
          entityKey: 'peters-lab-fx1003',
          field: 'fullDescription',
          value:
            'The Peters project page describes media studies research at Yale with enough official source context to explain the research home.',
          sourceName: 'official-profile-page',
          sourceUrl: 'https://filmstudies.yale.edu/people/john-durham-peters',
        },
      ],
    });

    expect(impact).toMatchObject({
      entityType: 'researchEntity',
      entityKey: 'peters-lab-fx1003',
      beforeCoverageTier: 'thin',
      afterCoverageTier: 'thin',
      resolvedBlockers: ['missing_source_backed_description', 'listing_only_profile'],
      remainingBlockers: ['missing_verified_lead'],
    });
  });

  it('groups dry-run observations and builds an impact report through injectable DB context', async () => {
    const report = await buildEvidenceCoverageImpactReportForObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'peters-lab-fx1003',
          field: 'fullDescription',
          value:
            'The Peters project page describes media studies research at Yale with enough official source context to explain the research home.',
          sourceName: 'official-profile-page',
          sourceUrl: 'https://filmstudies.yale.edu/people/john-durham-peters',
        },
      ],
      {
        loadResearchEntityContext: async () => ({
          entity: {
            name: 'Peters Lab',
            description: '',
            sourceUrls: ['http://filmstudies.yale.edu/people/john-durham-peters'],
          },
          listings: [{ websites: ['http://filmstudies.yale.edu/people/john-durham-peters'] }],
          members: [],
          accessSignals: [{ signalType: 'POSTED_OPENING' }],
          contactRoutes: [],
          observations: [{ sourceName: 'ylabs-listing', field: 'description' }],
        }),
      },
    );

    expect(report).toMatchObject({
      assessed: 1,
      improved: 1,
      rows: [
        {
          entityType: 'researchEntity',
          entityKey: 'peters-lab-fx1003',
          resolvedBlockers: ['missing_source_backed_description', 'listing_only_profile'],
        },
      ],
    });
  });

  it('skips object-shaped observation ids without arbitrary string coercion', async () => {
    const unsafeId = {
      toString() {
        throw new Error('evidence coverage stringified an arbitrary observation id');
      },
      toHexString() {
        throw new Error('evidence coverage called an arbitrary observation id');
      },
    };

    const report = await buildEvidenceCoverageImpactReportForObservations(
      [
        {
          entityType: 'researchEntity',
          entityId: unsafeId,
          field: 'fullDescription',
          value: 'Official source text.',
        },
      ],
      {
        loadResearchEntityContext: async () => {
          throw new Error('unsafe object id should not be loaded');
        },
      },
    );

    expect(report).toEqual({ assessed: 0, improved: 0, rows: [] });
  });
});

describe('summarizeEvidenceCoverage', () => {
  it('groups coverage by tier, blocker, and suggested source type', () => {
    const summary = summarizeEvidenceCoverage([
      {
        coverageTier: 'thin',
        claimStates: {} as any,
        blockers: ['missing_source_backed_description'],
        suggestedSourceTypes: ['official-profile-page'],
        rejectedFields: [],
        publicSummary: '',
      },
      {
        coverageTier: 'partial',
        claimStates: {} as any,
        blockers: ['missing_access_evidence'],
        suggestedSourceTypes: ['department-undergrad-research'],
        rejectedFields: [],
        publicSummary: '',
      },
      {
        coverageTier: 'ready_candidate',
        claimStates: {} as any,
        blockers: [],
        suggestedSourceTypes: [],
        rejectedFields: [],
        publicSummary: '',
      },
    ]);

    expect(summary).toMatchObject({
      total: 3,
      tierCounts: { thin: 1, partial: 1, ready_candidate: 1 },
      blockerCounts: {
        missing_source_backed_description: 1,
        missing_access_evidence: 1,
      },
      suggestedSourceTypeCounts: {
        'official-profile-page': 1,
        'department-undergrad-research': 1,
      },
    });
  });
});
