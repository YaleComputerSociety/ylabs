export interface ResearchQualityGoldenQuery {
  name: string;
  q: string;
  filters?: Record<string, unknown>;
}

export const DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES: ResearchQualityGoldenQuery[] = [
  { name: 'paid RA', q: 'paid RA', filters: { compensation: ['PAID'] } },
  { name: 'summer research', q: 'summer research' },
  { name: 'beginner friendly', q: 'beginner friendly' },
  { name: 'data science', q: 'data science' },
  { name: 'wet lab', q: 'wet lab' },
  { name: 'archival research', q: 'archival research' },
  { name: 'thesis mentor', q: 'thesis mentor' },
  { name: 'posted roles', q: 'posted roles', filters: { hasActivePostedOpportunity: true } },
];

export type ResearchQualitySearchWarningCode =
  | 'SPARSE_DESCRIPTION'
  | 'MISSING_LEAD'
  | 'MISSING_CONTEXT'
  | 'WEAK_SOURCE_URL'
  | 'WEAK_SOURCE_TITLE'
  | 'WEAK_SOURCE_DOMAIN'
  | 'DUPLICATE_OR_DISAMBIGUATION_RISK'
  | 'THIN_PATHWAY_EVIDENCE'
  | 'THIN_CONTACT_EVIDENCE'
  | 'SEMANTIC_EXPLAINABILITY_GAP';

export interface ResearchQualitySearchMemberFact {
  role?: string;
  name?: string;
}

export interface ResearchQualityDuplicateCandidate {
  slug?: string;
  name?: string;
}

export interface ResearchQualitySearchFacts {
  id: string;
  slug: string;
  name: string;
  displayName?: string;
  description?: string;
  shortDescription?: string;
  fullDescription?: string;
  sourceUrls?: string[];
  websiteUrl?: string;
  sourceTitle?: string;
  members?: ResearchQualitySearchMemberFact[];
  researchAreas?: string[];
  departments?: string[];
  duplicateCandidates?: ResearchQualityDuplicateCandidate[];
  pathwayCount: number;
  publicContactRouteCount: number;
  accessSignalCount: number;
  postedOpportunityCount: number;
  topSearchReasons?: string[];
  matchedQueryNames?: string[];
}

export interface ResearchQualitySearchReviewRow {
  id: string;
  slug: string;
  name: string;
  matchedQueryNames: string[];
  sourceDomains: string[];
  warningCodes: ResearchQualitySearchWarningCode[];
  warningScore: number;
  facts: {
    descriptionChars: number;
    sourceUrlCount: number;
    leadCount: number;
    contextLabelCount: number;
    duplicateCandidateCount: number;
    pathwayCount: number;
    publicContactRouteCount: number;
    accessSignalCount: number;
    postedOpportunityCount: number;
    explainabilityReasonCount: number;
  };
  duplicateCandidates: ResearchQualityDuplicateCandidate[];
}

export interface ResearchQualitySearchSummary {
  rows: number;
  warningCounts: Record<ResearchQualitySearchWarningCode, number>;
  maxWarningScore: number;
}

const WARNING_SCORES: Record<ResearchQualitySearchWarningCode, number> = {
  SPARSE_DESCRIPTION: 3,
  MISSING_LEAD: 3,
  MISSING_CONTEXT: 2,
  WEAK_SOURCE_URL: 3,
  WEAK_SOURCE_TITLE: 1,
  WEAK_SOURCE_DOMAIN: 2,
  DUPLICATE_OR_DISAMBIGUATION_RISK: 3,
  THIN_PATHWAY_EVIDENCE: 3,
  THIN_CONTACT_EVIDENCE: 2,
  SEMANTIC_EXPLAINABILITY_GAP: 2,
};

const LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director', 'core-faculty']);

function compactStrings(values: Array<string | undefined | null> | undefined): string[] {
  return (values || [])
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

function textLength(...values: Array<string | undefined>): number {
  return compactStrings(values).join(' ').length;
}

function validUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function sourceDomainsFor(facts: ResearchQualitySearchFacts): string[] {
  const urls = compactStrings([...(facts.sourceUrls || []), facts.websiteUrl]);
  return Array.from(
    new Set(
      urls
        .map(validUrl)
        .filter((url): url is URL => Boolean(url))
        .map((url) => url.hostname.toLowerCase().replace(/^www\./, '')),
    ),
  ).sort();
}

function hasTrustedSourceDomain(domains: string[]): boolean {
  return domains.some(
    (domain) =>
      domain === 'yale.edu' ||
      domain.endsWith('.yale.edu') ||
      domain === 'yale-nus.edu.sg' ||
      domain.endsWith('.yale-nus.edu.sg'),
  );
}

function warningScore(codes: ResearchQualitySearchWarningCode[]): number {
  return codes.reduce((total, code) => total + WARNING_SCORES[code], 0);
}

export function buildResearchQualitySearchReviewRow(
  facts: ResearchQualitySearchFacts,
): ResearchQualitySearchReviewRow {
  const descriptionChars = textLength(
    facts.description,
    facts.shortDescription,
    facts.fullDescription,
  );
  const sourceUrls = compactStrings([...(facts.sourceUrls || []), facts.websiteUrl]);
  const sourceDomains = sourceDomainsFor(facts);
  const leadCount = (facts.members || []).filter((member) =>
    LEAD_ROLES.has((member.role || '').trim().toLowerCase()),
  ).length;
  const contextLabelCount =
    compactStrings(facts.researchAreas).length + compactStrings(facts.departments).length;
  const duplicateCandidates = facts.duplicateCandidates || [];
  const explainabilityReasonCount = compactStrings(facts.topSearchReasons).length;
  const matchedQueryNames = compactStrings(facts.matchedQueryNames);

  const warningCodes: ResearchQualitySearchWarningCode[] = [];
  if (descriptionChars < 160) warningCodes.push('SPARSE_DESCRIPTION');
  if (leadCount === 0) warningCodes.push('MISSING_LEAD');
  if (contextLabelCount === 0) warningCodes.push('MISSING_CONTEXT');
  if (sourceUrls.length === 0 || sourceDomains.length === 0) warningCodes.push('WEAK_SOURCE_URL');
  if (!facts.sourceTitle || facts.sourceTitle.trim().length === 0) {
    warningCodes.push('WEAK_SOURCE_TITLE');
  }
  if (!hasTrustedSourceDomain(sourceDomains)) warningCodes.push('WEAK_SOURCE_DOMAIN');
  if (duplicateCandidates.length > 0) warningCodes.push('DUPLICATE_OR_DISAMBIGUATION_RISK');
  if (
    facts.pathwayCount < 2 &&
    facts.accessSignalCount === 0 &&
    facts.postedOpportunityCount === 0
  ) {
    warningCodes.push('THIN_PATHWAY_EVIDENCE');
  }
  if (facts.publicContactRouteCount === 0) warningCodes.push('THIN_CONTACT_EVIDENCE');
  if (matchedQueryNames.length > 0 && explainabilityReasonCount === 0) {
    warningCodes.push('SEMANTIC_EXPLAINABILITY_GAP');
  }

  return {
    id: facts.id,
    slug: facts.slug,
    name: facts.displayName || facts.name,
    matchedQueryNames,
    sourceDomains,
    warningCodes,
    warningScore: warningScore(warningCodes),
    facts: {
      descriptionChars,
      sourceUrlCount: sourceUrls.length,
      leadCount,
      contextLabelCount,
      duplicateCandidateCount: duplicateCandidates.length,
      pathwayCount: facts.pathwayCount,
      publicContactRouteCount: facts.publicContactRouteCount,
      accessSignalCount: facts.accessSignalCount,
      postedOpportunityCount: facts.postedOpportunityCount,
      explainabilityReasonCount,
    },
    duplicateCandidates,
  };
}

export function summarizeResearchQualitySearchRows(
  rows: ResearchQualitySearchReviewRow[],
): ResearchQualitySearchSummary {
  const warningCounts = rows.reduce(
    (summary, row) => {
      for (const code of row.warningCodes) {
        summary[code] = (summary[code] || 0) + 1;
      }
      return summary;
    },
    {} as Record<ResearchQualitySearchWarningCode, number>,
  );

  return {
    rows: rows.length,
    warningCounts,
    maxWarningScore: rows.reduce((max, row) => Math.max(max, row.warningScore), 0),
  };
}
