import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES,
  buildResearchQualitySearchReviewRow,
  deriveResearchEntitySourceTitleFromUrls,
  summarizeResearchQualitySearchRows,
  type ResearchQualitySearchFacts,
} from '../researchQualitySearchReviewCore';

function baseFacts(): ResearchQualitySearchFacts {
  return {
    id: 'entity-1',
    slug: 'example-lab',
    name: 'Example Lab',
    displayName: 'Example Lab',
    description: 'Short.',
    shortDescription: '',
    fullDescription: '',
    sourceUrls: ['not-a-url'],
    websiteUrl: '',
    sourceTitle: '',
    members: [{ role: 'affiliate', name: 'Unclear Person' }],
    researchAreas: [],
    departments: [],
    duplicateCandidates: [{ slug: 'example-lab-2', name: 'Example Laboratory' }],
    pathwayCount: 1,
    publicContactRouteCount: 0,
    accessSignalCount: 0,
    postedOpportunityCount: 0,
    topSearchReasons: [],
    matchedQueryNames: ['data science'],
  };
}

describe('DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES', () => {
  it('covers student-style research and pathway searches', () => {
    const names = DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES.map((query) => query.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'paid RA',
        'summer research',
        'beginner friendly',
        'data science',
        'wet lab',
        'archival research',
        'thesis mentor',
      ]),
    );
  });
});

describe('deriveResearchEntitySourceTitleFromUrls', () => {
  it('derives an inspectable research entity source title from the first valid URL', () => {
    expect(
      deriveResearchEntitySourceTitleFromUrls(
        ['not-a-url', 'https://medicine.yale.edu/lab/pierce/research/'],
        'https://medicine.yale.edu/lab/pierce/',
      ),
    ).toBe('medicine.yale.edu/lab/pierce');
  });

  it('returns an empty label when no inspectable URL exists', () => {
    expect(deriveResearchEntitySourceTitleFromUrls(['not-a-url'], '')).toBe('');
  });
});

describe('buildResearchQualitySearchReviewRow', () => {
  it('flags sparse, weakly sourced, ambiguous search results with thin action evidence', () => {
    const row = buildResearchQualitySearchReviewRow(baseFacts());

    expect(row.warningCodes).toEqual(
      expect.arrayContaining([
        'SPARSE_DESCRIPTION',
        'MISSING_LEAD',
        'MISSING_CONTEXT',
        'WEAK_SOURCE_URL',
        'WEAK_SOURCE_TITLE',
        'WEAK_SOURCE_DOMAIN',
        'DUPLICATE_OR_DISAMBIGUATION_RISK',
        'THIN_PATHWAY_EVIDENCE',
        'THIN_CONTACT_EVIDENCE',
        'SEMANTIC_EXPLAINABILITY_GAP',
      ]),
    );
    expect(row.warningScore).toBeGreaterThan(0);
    expect(row.sourceDomains).toEqual([]);
  });

  it('does not flag a well-explained result with lead, context, and actionable evidence', () => {
    const row = buildResearchQualitySearchReviewRow({
      ...baseFacts(),
      description:
        'This lab studies student-facing research questions in computational biology, including methods, datasets, and collaboration patterns for undergraduate projects.',
      shortDescription: 'Computational biology research with undergraduate project context.',
      fullDescription:
        'Students can understand what the group studies, who leads it, and why a pathway result matched their search.',
      sourceUrls: ['https://medicine.yale.edu/example-lab/research/'],
      websiteUrl: 'https://medicine.yale.edu/example-lab/',
      sourceTitle: 'Example Lab Research',
      members: [{ role: 'pi', name: 'Ada Example' }],
      researchAreas: ['Computational Biology'],
      departments: ['Molecular Biophysics and Biochemistry'],
      duplicateCandidates: [],
      pathwayCount: 2,
      publicContactRouteCount: 1,
      accessSignalCount: 2,
      postedOpportunityCount: 1,
      topSearchReasons: ['description matched computational biology', 'pathway evidence matched'],
    });

    expect(row.warningCodes).toEqual([]);
    expect(row.sourceDomains).toEqual(['medicine.yale.edu']);
  });
});

describe('summarizeResearchQualitySearchRows', () => {
  it('counts warning codes across rows', () => {
    const sparse = buildResearchQualitySearchReviewRow(baseFacts());
    const sourced = buildResearchQualitySearchReviewRow({
      ...baseFacts(),
      id: 'entity-2',
      slug: 'sourced-center',
      name: 'Sourced Center',
      sourceUrls: ['https://center.yale.edu/research'],
      websiteUrl: 'https://center.yale.edu',
      sourceTitle: 'Sourced Center',
      members: [{ role: 'director', name: 'Grace Example' }],
      researchAreas: ['Digital Humanities'],
      pathwayCount: 2,
      publicContactRouteCount: 1,
      accessSignalCount: 1,
      topSearchReasons: ['name matched digital humanities'],
    });

    const summary = summarizeResearchQualitySearchRows([sparse, sourced]);

    expect(summary.rows).toBe(2);
    expect(summary.warningCounts.SPARSE_DESCRIPTION).toBe(2);
    expect(summary.warningCounts.WEAK_SOURCE_URL).toBe(1);
    expect(summary.warningCounts.MISSING_LEAD).toBe(1);
  });
});
