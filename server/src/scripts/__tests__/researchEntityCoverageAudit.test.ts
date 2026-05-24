import { describe, expect, it } from 'vitest';
import {
  buildCoverageAuditRow,
  buildCoverageIssues,
  extractSuspiciousConstraintQuotes,
  summarizeIssueCounts,
  type CoverageAuditFacts,
} from '../researchEntityCoverageAuditCore';

function baseFacts(): CoverageAuditFacts {
  return {
    slug: 'dept-cs-fixture-chen',
    name: 'Fixture Chen Lab',
    kind: 'lab',
    school: 'Yale School of Engineering & Applied Science',
    websiteUrl: 'https://fixture-chen-lab.yale.edu/',
    description: '',
    shortDescription: '',
    fullDescription: '',
    counts: {
      departments: 0,
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
    expect(issues).toContain('NO_DEPARTMENTS');
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

  it('treats source-backed negative availability as access coverage, not a missing actionable-access gap', () => {
    const facts = {
      ...baseFacts(),
      observationFlags: {
        hasMicrositeObservation: true,
        hasInferredPiObservation: false,
        suspiciousConstraintQuotes: ['We are not currently accepting undergraduate researchers.'],
      },
      signalTypes: ['NOT_CURRENTLY_AVAILABLE'],
    };

    const issues = buildCoverageIssues(facts);

    expect(issues).not.toContain('NO_ACTIONABLE_ACCESS');
    expect(issues).not.toContain('MICROSITE_OBSERVED_NO_ACTIONABLE_ARTIFACTS');
    expect(issues).not.toContain('SUSPICIOUS_CONSTRAINT_QUOTE_UNCLASSIFIED');
    expect(issues).not.toContain('BLANK_DETAIL_RISK');
  });

  it('does not flag department context when a research entity has department metadata', () => {
    const facts = {
      ...baseFacts(),
      counts: {
        ...baseFacts().counts,
        departments: 1,
      },
    };

    expect(buildCoverageIssues(facts)).not.toContain('NO_DEPARTMENTS');
  });

  it('treats active legacy listings as scraper coverage seeds when canonical coverage is sparse', () => {
    const facts = {
      ...baseFacts(),
      counts: {
        ...baseFacts().counts,
        pathways: 1,
        postedOpportunities: 1,
        activeListings: 1,
      },
    };

    const issues = buildCoverageIssues(facts);

    expect(issues).toContain('LEGACY_LISTING_SCRAPER_COVERAGE_SEED');
    expect(issues).not.toContain('NO_ACTIONABLE_ACCESS');
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
      slug: 'example-research-institute',
      name: 'Example Research Institute',
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
