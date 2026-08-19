export interface CoverageAuditCounts {
  researchAreas: number;
  sourceUrls: number;
  members: number;
  accessSignals: number;
  activeListings: number;
}

export interface CoverageObservationFlags {
  hasMicrositeObservation: boolean;
  hasInferredPiObservation: boolean;
  suspiciousConstraintQuotes: string[];
}

export interface CoverageAuditFacts {
  slug: string;
  name: string;
  kind?: string;
  school?: string;
  websiteUrl?: string;
  description?: string;
  shortDescription?: string;
  fullDescription?: string;
  counts: CoverageAuditCounts;
  observationFlags?: CoverageObservationFlags;
  signalTypes?: string[];
}

export interface CoverageAuditRow {
  slug: string;
  name: string;
  kind?: string;
  school?: string;
  websiteUrl?: string;
  descriptionChars: number;
  shortDescriptionChars: number;
  fullDescriptionChars: number;
  counts: CoverageAuditCounts;
  issues: string[];
  issueScore: number;
}

export interface CoverageAuditRowSelection {
  flaggedEntities: number;
  issueCounts: Record<string, number>;
  rows: CoverageAuditRow[];
}

const ISSUE_SCORES: Record<string, number> = {
  BLANK_DETAIL_RISK: 5,
  MICROSITE_OBSERVED_NO_ACTIONABLE_ARTIFACTS: 4,
  INFERRED_PI_WITHOUT_MEMBERSHIP: 3,
  NO_ACTIONABLE_ACCESS: 3,
  MISSING_DESCRIPTION: 2,
  NO_MEMBERS: 2,
  NO_ACCESS_SIGNALS: 2,
  SUSPICIOUS_CONSTRAINT_QUOTE_UNCLASSIFIED: 2,
  NO_RESEARCH_AREAS: 1,
  MISSING_WEBSITE_URL: 1,
};

const SUSPICIOUS_CONSTRAINT_RE =
  /\b(no bandwidth|don't have bandwidth|do not have bandwidth|not accepting|not currently accepting|do not take undergraduates|don't take undergraduates|cannot respond|can't respond|unable to respond|please do not email)\b/i;

export function textLength(value: string | undefined | null): number {
  return typeof value === 'string' ? value.trim().length : 0;
}

export function extractSuspiciousConstraintQuotes(
  quotes: Array<string | undefined | null>,
): string[] {
  return quotes
    .map((quote) => (typeof quote === 'string' ? quote.trim() : ''))
    .filter((quote) => quote.length > 0 && SUSPICIOUS_CONSTRAINT_RE.test(quote));
}

export function buildCoverageIssues(facts: CoverageAuditFacts): string[] {
  const descriptionChars = textLength(facts.description);
  const shortDescriptionChars = textLength(facts.shortDescription);
  const fullDescriptionChars = textLength(facts.fullDescription);
  const { researchAreas, members, accessSignals, activeListings } = facts.counts;

  const noActionableAccess = accessSignals === 0 && activeListings === 0;
  const issues: string[] = [];

  if (descriptionChars === 0 && shortDescriptionChars === 0 && fullDescriptionChars === 0) {
    issues.push('MISSING_DESCRIPTION');
  }
  if (researchAreas === 0) {
    issues.push('NO_RESEARCH_AREAS');
  }
  if (members === 0) {
    issues.push('NO_MEMBERS');
  }
  if (accessSignals === 0) {
    issues.push('NO_ACCESS_SIGNALS');
  }
  if (!facts.websiteUrl || facts.websiteUrl.trim().length === 0) {
    issues.push('MISSING_WEBSITE_URL');
  }
  if (noActionableAccess) {
    issues.push('NO_ACTIONABLE_ACCESS');
  }

  const signals = new Set(facts.signalTypes || []);
  const observationFlags = facts.observationFlags;
  if (observationFlags?.hasMicrositeObservation && noActionableAccess) {
    issues.push('MICROSITE_OBSERVED_NO_ACTIONABLE_ARTIFACTS');
  }
  if (observationFlags?.hasInferredPiObservation && members === 0) {
    issues.push('INFERRED_PI_WITHOUT_MEMBERSHIP');
  }
  if (
    (observationFlags?.suspiciousConstraintQuotes.length || 0) > 0 &&
    !signals.has('NOT_CURRENTLY_AVAILABLE')
  ) {
    issues.push('SUSPICIOUS_CONSTRAINT_QUOTE_UNCLASSIFIED');
  }
  if (
    descriptionChars === 0 &&
    researchAreas === 0 &&
    members === 0 &&
    noActionableAccess &&
    accessSignals <= 1
  ) {
    issues.push('BLANK_DETAIL_RISK');
  }

  return issues;
}

export function scoreCoverageIssues(issues: string[]): number {
  return issues.reduce((total, issue) => total + (ISSUE_SCORES[issue] || 0), 0);
}

export function buildCoverageAuditRow(facts: CoverageAuditFacts): CoverageAuditRow {
  const issues = buildCoverageIssues(facts);
  return {
    slug: facts.slug,
    name: facts.name,
    kind: facts.kind,
    school: facts.school,
    websiteUrl: facts.websiteUrl,
    descriptionChars: textLength(facts.description),
    shortDescriptionChars: textLength(facts.shortDescription),
    fullDescriptionChars: textLength(facts.fullDescription),
    counts: facts.counts,
    issues,
    issueScore: scoreCoverageIssues(issues),
  };
}

export function summarizeIssueCounts(rows: CoverageAuditRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((summary, row) => {
    for (const issue of row.issues) {
      summary[issue] = (summary[issue] || 0) + 1;
    }
    return summary;
  }, {});
}

export function selectCoverageAuditRows(
  rows: CoverageAuditRow[],
  options: {
    includeAll: boolean;
    minScore: number;
    limit: number;
  },
): CoverageAuditRowSelection {
  const sortedRows = [...rows].sort(
    (a, b) => b.issueScore - a.issueScore || a.name.localeCompare(b.name),
  );
  const flaggedRows = sortedRows.filter((row) => row.issueScore >= options.minScore);
  const includedRows = options.includeAll ? sortedRows : flaggedRows;

  return {
    flaggedEntities: flaggedRows.length,
    issueCounts: summarizeIssueCounts(flaggedRows),
    rows: includedRows.slice(0, options.limit),
  };
}
