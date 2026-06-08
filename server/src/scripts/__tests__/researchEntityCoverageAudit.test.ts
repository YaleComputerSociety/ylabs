import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildCoverageAuditRow,
  buildCoverageIssues,
  extractSuspiciousConstraintQuotes,
  summarizeIssueCounts,
  type CoverageAuditFacts,
} from '../researchEntityCoverageAuditCore';
import {
  buildResearchEntityCoverageAuditOutput,
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
    description: '',
    shortDescription: '',
    fullDescription: '',
    counts: {
      researchAreas: 0,
      sourceUrls: 2,
      members: 0,
      pathways: 0,
      publicContactRoutes: 0,
      totalContactRoutes: 0,
      accessSignals: 1,
      postedOpportunities: 0,
      activeListings: 0,
    },
    observationFlags: {
      hasMicrositeObservation: true,
      hasInferredPiObservation: true,
      suspiciousConstraintQuotes: ["I regrettably don't have bandwidth to respond to all of them."],
    },
    signalTypes: ['CONTACT_INSTRUCTIONS_EXIST'],
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
    expect(issues).toContain('NO_PATHWAYS');
    expect(issues).toContain('NO_PUBLIC_CONTACT_ROUTE');
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
    expect(row.descriptionChars).toBe(0);
  });
});

describe('summarizeIssueCounts', () => {
  it('counts issues across rows', () => {
    const sparse = buildCoverageAuditRow(baseFacts());
    const healthier = buildCoverageAuditRow({
      ...baseFacts(),
      slug: 'wu-tsai',
      name: 'Wu Tsai Institute',
      description: 'Studies neuroscience and computation.',
      shortDescription: 'Neuroscience institute.',
      counts: {
        ...baseFacts().counts,
        researchAreas: 3,
        members: 5,
        pathways: 2,
        publicContactRoutes: 1,
        totalContactRoutes: 1,
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
    expect(() =>
      parseResearchEntityCoverageAuditArgs(['--min-score=9007199254740992']),
    ).toThrow(/--min-score requires a non-negative integer/);
    expect(() => parseResearchEntityCoverageAuditArgs(['--output', '--all'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchEntityCoverageAuditArgs(['--output=--all'])).toThrow(
      /--output requires a path/,
    );
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
});
