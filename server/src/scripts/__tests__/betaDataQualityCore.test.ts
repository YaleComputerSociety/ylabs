import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildResearchEntityContentPageLeakSummary,
  buildBetaDataQualitySummary,
  buildReferenceIntegritySummary,
  isLikelyResearchEntityContentPageLeak,
  isInvalidObservationSourceUrl,
  isInvalidOptionalEmail,
  isInvalidOptionalUrl,
  parseBetaDataQualityArgs,
  selectLiveLinkCandidates,
  shouldStrictModeFail,
  writeScorecardOutput,
  type BetaDataQualityScorecard,
} from '../betaDataQualityCore';

describe('buildReferenceIntegritySummary', () => {
  it('treats optional missing refs as non-failures but present orphan refs as hard failures', () => {
    const summary = buildReferenceIntegritySummary([
      {
        name: 'contactRouteEntryPathway',
        required: false,
        missingRequired: 55,
        orphanedPresentRefs: 0,
      },
      {
        name: 'accessSignalEntryPathway',
        required: false,
        missingRequired: 0,
        orphanedPresentRefs: 2,
      },
      {
        name: 'entryPathwayResearchEntity',
        required: true,
        missingRequired: 1,
        orphanedPresentRefs: 0,
      },
    ]);

    expect(summary.missingRequiredTotal).toBe(1);
    expect(summary.orphanedPresentRefTotal).toBe(2);
    expect(summary.hardFailureTotal).toBe(3);
    expect(summary.items[0]).toMatchObject({
      name: 'contactRouteEntryPathway',
      severity: 'ok',
    });
    expect(summary.items[1]).toMatchObject({
      name: 'accessSignalEntryPathway',
      severity: 'error',
    });
    expect(summary.items[2]).toMatchObject({
      name: 'entryPathwayResearchEntity',
      severity: 'error',
    });
  });
});

describe('optional hygiene validators', () => {
  it('allows empty optional URL/email fields and flags malformed non-empty values', () => {
    expect(isInvalidOptionalUrl('')).toBe(false);
    expect(isInvalidOptionalUrl(undefined)).toBe(false);
    expect(isInvalidOptionalUrl('https://example.edu/lab')).toBe(false);
    expect(isInvalidOptionalUrl('ftp://example.edu/lab')).toBe(true);

    expect(isInvalidOptionalEmail('')).toBe(false);
    expect(isInvalidOptionalEmail(undefined)).toBe(false);
    expect(isInvalidOptionalEmail('fixture.person@example.edu')).toBe(false);
    expect(isInvalidOptionalEmail('not-an-email')).toBe(true);
  });

  it('allows local file provenance for observation source URLs only', () => {
    expect(isInvalidOptionalUrl('file:fixture_directory.csv')).toBe(true);
    expect(isInvalidObservationSourceUrl('file:fixture_directory.csv')).toBe(false);
    expect(isInvalidObservationSourceUrl('https://example.edu/source')).toBe(false);
    expect(isInvalidObservationSourceUrl('not-a-url')).toBe(true);
  });
});

describe('research entity content-page leak detection', () => {
  it('flags active blog pages classified as research homes', () => {
    expect(
      isLikelyResearchEntityContentPageLeak({
        name: 'Synthetic Research Updates Blog',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://fixtures.example.edu/lab/synthetic-research-updates-blog/',
      }),
    ).toEqual(['content-page-title', 'content-page-url', 'content-page-classified-as-lab']);
  });

  it('does not flag legitimate resources institutes', () => {
    expect(
      isLikelyResearchEntityContentPageLeak({
        name: 'Synthetic Resources Institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://fixtures.example.edu/research/centers/synthetic-resources-institute',
      }),
    ).toEqual([]);
  });

  it('summarizes active content-page leak candidates', () => {
    const summary = buildResearchEntityContentPageLeakSummary([
      {
        id: 'bad',
        name: 'Synthetic Research Updates Blog',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://fixtures.example.edu/lab/synthetic-research-updates-blog/',
      },
      {
        id: 'ok',
        name: 'Synthetic Resources Institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://fixtures.example.edu/research/centers/synthetic-resources-institute',
      },
    ]);

    expect(summary.count).toBe(1);
    expect(summary.samples).toEqual([
      expect.objectContaining({
        id: 'bad',
        name: 'Synthetic Research Updates Blog',
        reasons: ['content-page-title', 'content-page-url', 'content-page-classified-as-lab'],
      }),
    ]);
  });
});

describe('buildBetaDataQualitySummary', () => {
  it('classifies hard blockers as errors and quality gaps as warnings', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 1,
      invalidUrlCount: 2,
      expiredOpenOpportunityCount: 1,
      paperAuthorshipIntegrityFailures: 3,
      sourceHealthErrors: 1,
      sourceHealthWarnings: 2,
      duplicateEntityClusterCount: 4,
      missingShortDescriptionCount: 10,
      weakShortDescriptionCount: 5,
      suspiciousUserEmailCount: 8,
      retentionCandidateCount: 6,
      coverageGaps: {
        withoutPathways: 7,
        withoutAccessSignals: 8,
        withoutContactRoutes: 9,
      },
    });

    expect(summary.status).toBe('error');
    expect(summary.errorCount).toBe(5);
    expect(summary.warnCount).toBe(9);
    expect(summary.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'referenceIntegrity',
        'urlSyntax',
        'expiredOpenOpportunities',
        'paperAuthorship',
        'sourceHealthErrors',
      ]),
    );
    expect(summary.errors).toHaveLength(5);
    expect(summary.warnings.map((item) => item.name)).toContain('duplicateEntityNames');
    expect(shouldStrictModeFail(summary)).toBe(true);
  });

  it('returns warning status when only quality gaps remain', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 0,
      invalidUrlCount: 0,
      expiredOpenOpportunityCount: 0,
      paperAuthorshipIntegrityFailures: 0,
      sourceHealthErrors: 0,
      sourceHealthWarnings: 1,
      duplicateEntityClusterCount: 2,
      missingShortDescriptionCount: 3,
      weakShortDescriptionCount: 0,
      suspiciousUserEmailCount: 1,
      retentionCandidateCount: 0,
      coverageGaps: {
        withoutPathways: 4,
        withoutAccessSignals: 5,
        withoutContactRoutes: 6,
      },
    });

    expect(summary.status).toBe('warn');
    expect(summary.errorCount).toBe(0);
    expect(shouldStrictModeFail(summary)).toBe(false);
  });
});

describe('parseBetaDataQualityArgs', () => {
  it('parses strict output live-link sample and sample flags', () => {
    expect(
      parseBetaDataQualityArgs([
        '--strict',
        '--output',
        '/tmp/report.json',
        '--days=14',
        '--live-links',
        '--link-sample-size=25',
        '--include-samples',
      ]),
    ).toEqual({
      strict: true,
      output: '/tmp/report.json',
      days: 14,
      liveLinks: true,
      linkSampleSize: 25,
      includeSamples: true,
    });
  });
});

describe('selectLiveLinkCandidates', () => {
  it('dedupes and respects the requested sample size', () => {
    const rows = selectLiveLinkCandidates(
      [
        { value: 'https://example.edu/a', source: 'entity.website' },
        { value: 'https://example.edu/a', source: 'listing.website' },
        { value: 'https://example.edu/b', source: 'pathway.sourceUrls' },
        { value: 'not-a-url', source: 'bad' },
      ],
      1,
    );

    expect(rows).toEqual([
      {
        url: 'https://example.edu/a',
        sources: ['entity.website', 'listing.website'],
      },
    ]);
  });
});

describe('writeScorecardOutput', () => {
  it('writes the JSON scorecard shape to disk when output is provided', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ylabs-quality-test-'));
    const output = path.join(dir, 'scorecard.json');
    const scorecard = {
      generatedAt: '2026-05-15T00:00:00.000Z',
      mongoTarget: 'example.mongodb.net/Beta',
      summary: {
        status: 'ok',
        errorCount: 0,
        warnCount: 0,
        errors: [],
        warnings: [],
      },
    } as unknown as BetaDataQualityScorecard;

    await writeScorecardOutput(scorecard, output);

    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      mongoTarget: 'example.mongodb.net/Beta',
      summary: { status: 'ok' },
    });
    await rm(dir, { recursive: true, force: true });
  });
});
