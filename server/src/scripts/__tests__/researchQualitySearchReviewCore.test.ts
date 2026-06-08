import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES,
  buildResearchQualitySearchReviewRow,
  deriveResearchEntitySourceTitleFromUrls,
  summarizeResearchQualitySearchRows,
  type ResearchQualitySearchFacts,
} from '../researchQualitySearchReviewCore';
import {
  buildResearchQualitySearchReviewOutput,
  parseResearchQualitySearchReviewArgs,
  writeResearchQualitySearchReviewOutput,
} from '../researchQualitySearchReview';

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
      websiteUrl: 'https://user:pass@medicine.yale.edu/example-lab/',
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
    expect(JSON.stringify(row)).not.toContain('user:pass');
  });

  it('flags centers without public routes as index-only rather than missing PI lead', () => {
    const row = buildResearchQualitySearchReviewRow({
      ...baseFacts(),
      entityType: 'CENTER',
      slug: 'center-yale-cancer-center',
      name: 'Yale Cancer Center',
      description:
        'The center supports cancer research across immunology, prevention, genomics, clinical trials, and precision medicine through affiliated faculty, member labs, shared programs, and source-backed center activity.',
      shortDescription:
        'Cancer research center with affiliated faculty, member labs, shared programs, and source-backed center activity.',
      sourceUrls: ['https://medicine.yale.edu/cancer/research/membership/directory'],
      websiteUrl: 'https://medicine.yale.edu/cancer/',
      sourceTitle: 'medicine.yale.edu/cancer/research',
      members: [],
      researchAreas: ['Cancer Immunology'],
      duplicateCandidates: [],
      pathwayCount: 0,
      publicContactRouteCount: 0,
      accessSignalCount: 0,
      postedOpportunityCount: 0,
      topSearchReasons: ['description matched cancer research'],
    });

    expect(row.warningCodes).toContain('CENTER_INDEX_ONLY');
    expect(row.warningCodes).not.toContain('MISSING_LEAD');
  });

  it('flags faculty research areas that lack exploratory framing', () => {
    const row = buildResearchQualitySearchReviewRow({
      ...baseFacts(),
      entityType: 'FACULTY_RESEARCH_AREA',
      slug: 'faculty-research-area-example',
      name: 'Example Faculty Research',
      description:
        'This faculty research area studies computational biology, statistical learning, and translational genomics through faculty-led research projects and public profile context.',
      shortDescription:
        'Faculty research area in computational biology, statistical learning, and translational genomics.',
      sourceUrls: ['https://medicine.yale.edu/profile/example-faculty'],
      websiteUrl: 'https://medicine.yale.edu/profile/example-faculty',
      sourceTitle: 'medicine.yale.edu/profile/example-faculty',
      members: [{ role: 'pi', name: 'Ada Example' }],
      researchAreas: ['Computational Biology'],
      duplicateCandidates: [],
      pathwayCount: 0,
      pathwayTypes: [],
      publicContactRouteCount: 0,
      publicContactRouteTypes: [],
      accessSignalCount: 0,
      accessSignalTypes: [],
      postedOpportunityCount: 0,
      topSearchReasons: ['description matched computational biology'],
    });

    expect(row.warningCodes).toContain('MISSING_EXPLORATORY_FRAMING');
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

describe('researchQualitySearchReview CLI helpers', () => {
  it('parses strict, query, limit, top-k, and output flags', () => {
    expect(
      parseResearchQualitySearchReviewArgs([
        '--strict',
        '--query=paid RA',
        '--limit=25',
        '--top-k=8',
        '--output',
        '/tmp/ylabs-research-quality-search-review.json',
      ]),
    ).toEqual({
      strict: true,
      queryNames: ['paid RA'],
      limit: 25,
      topK: 8,
      output: '/tmp/ylabs-research-quality-search-review.json',
    });
    expect(() => parseResearchQualitySearchReviewArgs(['prod'])).toThrow(
      /Unknown research quality search review argument: prod/,
    );
    expect(() => parseResearchQualitySearchReviewArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseResearchQualitySearchReviewArgs(['--top-k=bad'])).toThrow(
      /--top-k requires a positive integer/,
    );
    expect(() => parseResearchQualitySearchReviewArgs(['--limit=9007199254740992'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseResearchQualitySearchReviewArgs(['--top-k=9007199254740992'])).toThrow(
      /--top-k requires a positive integer/,
    );
    expect(() => parseResearchQualitySearchReviewArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchQualitySearchReviewArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
  });

  it('writes the research quality search review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-research-quality-search-review-'));
    const output = path.join(dir, 'research-quality-search-review.json');
    writeResearchQualitySearchReviewOutput(
      {
        readOnly: true,
        reviewedEntities: 2,
        summary: { rows: 2, maxWarningScore: 1 },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      readOnly: true,
      reviewedEntities: 2,
      summary: { rows: 2, maxWarningScore: 1 },
    });
  });

  it('wraps research quality search artifacts with target metadata and parsed options', () => {
    const output = buildResearchQualitySearchReviewOutput(
      {
        readOnly: true,
        reviewedEntities: 2,
        summary: { rows: 2, maxWarningScore: 1 },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          strict: true,
          queryNames: ['paid RA'],
          limit: 25,
          topK: 8,
          output: '/tmp/ylabs-research-quality-search-review.json',
        },
      },
    );

    expect(output).toEqual({
      readOnly: true,
      reviewedEntities: 2,
      summary: { rows: 2, maxWarningScore: 1 },
      environment: 'beta',
      db: 'Beta',
      options: {
        strict: true,
        queryNames: ['paid RA'],
        limit: 25,
        topK: 8,
        output: '/tmp/ylabs-research-quality-search-review.json',
      },
    });
  });
});
