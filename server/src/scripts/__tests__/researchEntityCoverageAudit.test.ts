import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildCoverageAuditRow,
  buildCoverageIssues,
  extractSuspiciousConstraintQuotes,
  selectCoverageAuditRows,
  summarizeIssueCounts,
  type CoverageAuditFacts,
} from '../researchEntityCoverageAuditCore';
import {
  assertResearchEntityCoverageSummaryOnlyAllowed,
  buildResearchEntityCoverageAuditOutput,
  buildResearchEntityCoverageSummaryOnlyOutput,
  parseResearchEntityCoverageAuditArgs,
  writeResearchEntityCoverageAuditOutput,
} from '../researchEntityCoverageAudit';

function baseFacts(): CoverageAuditFacts {
  return {
    slug: 'dept-cs-yuejie-chi',
    name: 'Yuejie Chi Lab',
    kind: 'lab',
    school: 'Yale School of Engineering & Applied Science',
    websiteUrl: 'https://yuejiechi.github.io/',
    shortDescription: '',
    fullDescription: '',
    counts: {
      researchAreas: 0,
      sourceUrls: 2,
      members: 0,
      accessSignals: 0,
    },
    observationFlags: {
      hasMicrositeObservation: true,
      hasInferredPiObservation: true,
      suspiciousConstraintQuotes: ["I regrettably don't have bandwidth to respond to all of them."],
    },
    signalTypes: [],
  };
}

describe('extractSuspiciousConstraintQuotes', () => {
  it('keeps only quotes that look like unclassified constraints', () => {
    const quotes = extractSuspiciousConstraintQuotes([
      '',
      'Please do not email me about openings.',
      'Undergraduates are welcome to apply.',
      "I regrettably don't have bandwidth to respond to all of them.",
    ]);

    expect(quotes).toEqual([
      'Please do not email me about openings.',
      "I regrettably don't have bandwidth to respond to all of them.",
    ]);
  });
});

describe('buildCoverageIssues', () => {
  it('flags sparse detail pages with missing actionable artifacts', () => {
    const issues = buildCoverageIssues(baseFacts());

    expect(issues).toContain('MISSING_DESCRIPTION');
    expect(issues).toContain('NO_MEMBERS');
    expect(issues).toContain('NO_ACCESS_SIGNALS');
    expect(issues).toContain('NO_ACTIONABLE_ACCESS');
    expect(issues).toContain('MICROSITE_OBSERVED_NO_ACTIONABLE_ARTIFACTS');
    expect(issues).toContain('INFERRED_PI_WITHOUT_MEMBERSHIP');
    expect(issues).toContain('SUSPICIOUS_CONSTRAINT_QUOTE_UNCLASSIFIED');
    expect(issues).toContain('BLANK_DETAIL_RISK');
  });

  it('does not flag unclassified constraints when a negative access signal exists', () => {
    const facts = {
      ...baseFacts(),
      signalTypes: ['CONTACT_INSTRUCTIONS_EXIST', 'NOT_CURRENTLY_AVAILABLE'],
    };

    expect(buildCoverageIssues(facts)).not.toContain('SUSPICIOUS_CONSTRAINT_QUOTE_UNCLASSIFIED');
  });
});

describe('buildCoverageAuditRow', () => {
  it('computes a positive issue score for sparse rows', () => {
    const row = buildCoverageAuditRow(baseFacts());

    expect(row.issueScore).toBeGreaterThan(0);
  });
});

describe('summarizeIssueCounts', () => {
  it('counts issues across rows', () => {
    const sparse = buildCoverageAuditRow(baseFacts());
    const healthier = buildCoverageAuditRow({
      ...baseFacts(),
      slug: 'wu-tsai',
      name: 'Wu Tsai Institute',
      shortDescription: 'Neuroscience institute.',
      counts: {
        ...baseFacts().counts,
        researchAreas: 3,
        members: 5,
        accessSignals: 3,
      },
      observationFlags: {
        hasMicrositeObservation: true,
        hasInferredPiObservation: false,
        suspiciousConstraintQuotes: [],
      },
      signalTypes: ['REACH_OUT_PLAUSIBLE'],
    });

    const summary = summarizeIssueCounts([sparse, healthier]);

    expect(summary.MISSING_DESCRIPTION).toBe(1);
    expect(summary.BLANK_DETAIL_RISK).toBe(1);
  });
});

describe('selectCoverageAuditRows', () => {
  const flaggedRow = buildCoverageAuditRow(baseFacts());
  const belowThresholdRow = buildCoverageAuditRow({
    ...baseFacts(),
    slug: 'missing-website-only',
    name: 'Missing Website Only',
    websiteUrl: '',
    fullDescription: 'Complete description.',
    counts: {
      ...baseFacts().counts,
      researchAreas: 2,
      members: 2,
      accessSignals: 2,
    },
    observationFlags: {
      hasMicrositeObservation: false,
      hasInferredPiObservation: false,
      suspiciousConstraintQuotes: [],
    },
  });
  const cleanRow = buildCoverageAuditRow({
    ...baseFacts(),
    slug: 'complete-entity',
    name: 'Complete Entity',
    websiteUrl: 'https://example.test/',
    fullDescription: 'Complete description.',
    counts: {
      ...baseFacts().counts,
      researchAreas: 2,
      members: 2,
      accessSignals: 2,
    },
    observationFlags: {
      hasMicrositeObservation: false,
      hasInferredPiObservation: false,
      suspiciousConstraintQuotes: [],
    },
  });

  it('includes all bounded rows without changing threshold-based aggregates', () => {
    const selection = selectCoverageAuditRows([cleanRow, belowThresholdRow, flaggedRow], {
      includeAll: true,
      minScore: 2,
      limit: 10,
    });

    expect(selection.flaggedEntities).toBe(1);
    expect(selection.rows).toHaveLength(3);
    expect(selection.issueCounts.MISSING_DESCRIPTION).toBe(1);
    expect(selection.issueCounts.MISSING_WEBSITE_URL).toBeUndefined();
  });

  it('includes only threshold-flagged rows when all-row inclusion is disabled', () => {
    const selection = selectCoverageAuditRows([cleanRow, belowThresholdRow, flaggedRow], {
      includeAll: false,
      minScore: 2,
      limit: 10,
    });

    expect(selection.flaggedEntities).toBe(1);
    expect(selection.rows).toEqual([flaggedRow]);
    expect(selection.issueCounts.MISSING_DESCRIPTION).toBe(1);
    expect(selection.issueCounts.MISSING_WEBSITE_URL).toBeUndefined();
  });
});

describe('researchEntityCoverageAudit CLI helpers', () => {
  it('parses slug, all, archived, limit, min-score, and output flags', () => {
    expect(
      parseResearchEntityCoverageAuditArgs([
        '--slug=dept-cs-yuejie-chi',
        '--all',
        '--include-archived',
        '--limit=15',
        '--min-score=0',
        '--output',
        '/tmp/ylabs-research-entity-coverage.json',
      ]),
    ).toEqual({
      slug: 'dept-cs-yuejie-chi',
      includeAll: true,
      includeArchived: true,
      limit: 15,
      minScore: 0,
      output: '/tmp/ylabs-research-entity-coverage.json',
    });
    expect(() => parseResearchEntityCoverageAuditArgs(['prod'])).toThrow(
      /Unknown research entity coverage audit argument: prod/,
    );
    expect(() => parseResearchEntityCoverageAuditArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseResearchEntityCoverageAuditArgs(['--limit=9007199254740992'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseResearchEntityCoverageAuditArgs(['--min-score=bad'])).toThrow(
      /--min-score requires a non-negative integer/,
    );
    expect(() => parseResearchEntityCoverageAuditArgs(['--min-score=9007199254740992'])).toThrow(
      /--min-score requires a non-negative integer/,
    );
    expect(() => parseResearchEntityCoverageAuditArgs(['--output', '--all'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchEntityCoverageAuditArgs(['--output=--all'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseResearchEntityCoverageAuditArgs(['--output', '/var/tmp/research-entity-coverage.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseResearchEntityCoverageAuditArgs(['--output', '/tmp/research-entity-coverage.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('parses summary-only and rejects slug targeting before connecting', () => {
    const options = parseResearchEntityCoverageAuditArgs([
      '--summary-only',
      '--environment=development',
      '--all',
    ]);
    expect(options).toEqual({
      summaryOnly: true,
      environment: 'development',
      includeAll: true,
      includeArchived: false,
      limit: 50,
      minScore: 1,
    });
    expect(() => parseResearchEntityCoverageAuditArgs(['--summary-only=true'])).toThrow(
      '--summary-only does not accept a value',
    );
    expect(() =>
      parseResearchEntityCoverageAuditArgs(['--summary-only', '--environment=production']),
    ).toThrow('--environment requires development, beta, or production-copy');
    expect(() =>
      assertResearchEntityCoverageSummaryOnlyAllowed(
        parseResearchEntityCoverageAuditArgs(['--summary-only', '--slug=private-entity-slug']),
      ),
    ).toThrow(/--summary-only cannot be combined with --slug/);
  });

  it('writes the coverage audit artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-research-entity-coverage-'));
    const output = path.join(dir, 'research-entity-coverage.json');
    writeResearchEntityCoverageAuditOutput(
      {
        generatedAt: '2026-05-29T00:00:00.000Z',
        rows: [{ slug: 'dept-cs-yuejie-chi', issueScore: 3 }],
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      rows: [{ slug: 'dept-cs-yuejie-chi', issueScore: 3 }],
    });
  });

  it('rejects unsafe research entity coverage artifact writes', () => {
    expect(() =>
      writeResearchEntityCoverageAuditOutput(
        { rows: [] },
        '/var/tmp/research-entity-coverage.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('wraps coverage audit artifacts with target metadata and parsed options', () => {
    const output = buildResearchEntityCoverageAuditOutput(
      {
        generatedAt: '2026-05-29T00:00:00.000Z',
        rows: [{ slug: 'dept-cs-yuejie-chi', issueScore: 3 }],
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          slug: 'dept-cs-yuejie-chi',
          limit: 15,
          minScore: 0,
          includeArchived: false,
          includeAll: false,
          output: '/tmp/ylabs-research-entity-coverage.json',
        },
      },
    );

    expect(output).toMatchObject({
      generatedAt: '2026-05-29T00:00:00.000Z',
      rows: [{ slug: 'dept-cs-yuejie-chi', issueScore: 3 }],
      environment: 'beta',
      db: 'Beta',
      options: {
        slug: 'dept-cs-yuejie-chi',
        limit: 15,
        minScore: 0,
        includeArchived: false,
        includeAll: false,
        output: '/tmp/ylabs-research-entity-coverage.json',
      },
    });
  });

  it('builds a fail-closed aggregate-only coverage report', () => {
    const payload = buildResearchEntityCoverageSummaryOnlyOutput(
      {
        generatedAt: '2026-07-28T00:00:00.000Z',
        scope: 'bulk',
        totalEntitiesScanned: 10,
        flaggedEntities: 4,
        filters: {
          includeArchived: false,
          includeAll: true,
          minScore: 0,
        },
        issueCounts: {
          NO_MEMBERS: 3,
          'private-entity-slug': 999,
        },
      },
      { environment: 'development', db: 'Development' },
    );

    expect(payload).toEqual({
      summaryOnly: true,
      environment: 'development',
      db: 'Development',
      generatedAt: '2026-07-28T00:00:00.000Z',
      scope: 'bulk',
      applyBlocked: true,
      totalEntitiesScanned: 10,
      flaggedEntities: 4,
      filters: {
        includeArchived: false,
        includeAll: true,
        minScore: 0,
      },
      issueCounts: {
        NO_MEMBERS: 3,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('private');
  });
});
