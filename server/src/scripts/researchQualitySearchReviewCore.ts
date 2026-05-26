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
  | 'MISSING_CENTER_CONTACT'
  | 'CENTER_INDEX_ONLY'
  | 'MISSING_EXPLORATORY_FRAMING'
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
  entityType?: string;
  kind?: string;
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
  pathwayTypes?: string[];
  publicContactRouteCount: number;
  publicContactRouteTypes?: string[];
  accessSignalCount: number;
  accessSignalTypes?: string[];
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
  MISSING_CENTER_CONTACT: 2,
  CENTER_INDEX_ONLY: 1,
  MISSING_EXPLORATORY_FRAMING: 2,
  SEMANTIC_EXPLAINABILITY_GAP: 2,
};

const LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director', 'core-faculty']);
const EXPLORATORY_PATHWAY_TYPES = new Set(['EXPLORATORY_CONTACT', 'FACULTY_SUPERVISION']);
const EXPLORATORY_ACCESS_SIGNAL_TYPES = new Set([
  'REACH_OUT_PLAUSIBLE',
  'FACULTY_SUPERVISES_STUDENT_PROJECTS',
]);
const CENTER_ACTION_PATHWAY_TYPES = new Set([
  'CENTER_INTERNSHIP',
  'RECURRING_PROGRAM',
  'POSTED_ROLE',
  'EXPLORATORY_CONTACT',
]);
const CENTER_ACTION_CONTACT_ROUTE_TYPES = new Set([
  'PROGRAM_MANAGER',
  'DEPARTMENT_CONTACT',
  'OFFICIAL_APPLICATION',
]);
const CENTER_ACTION_ACCESS_SIGNAL_TYPES = new Set([
  'POSTED_OPENING',
  'RECURRING_PROGRAM',
  'APPLICATION_FORM_EXISTS',
  'CONTACT_INSTRUCTIONS_EXIST',
  'PROGRAM_MANAGER_LISTED',
]);
const CENTER_LIKE_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE']);

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

export function deriveResearchEntitySourceTitleFromUrls(
  sourceUrls: string[] | undefined,
  websiteUrl?: string,
): string {
  const urls = compactStrings([...(sourceUrls || []), websiteUrl]);
  const firstInspectable = urls.map(validUrl).find((url): url is URL => Boolean(url));
  if (!firstInspectable) return '';

  const hostname = firstInspectable.hostname.toLowerCase().replace(/^www\./, '');
  const pathParts = firstInspectable.pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  return [hostname, ...pathParts].join('/');
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

function normalizedEntityType(facts: ResearchQualitySearchFacts): string {
  const entityType = (facts.entityType || '').trim().toUpperCase();
  if (entityType) return entityType;
  const kind = (facts.kind || '').trim().toLowerCase();
  if (kind === 'lab') return 'LAB';
  if (kind === 'center') return 'CENTER';
  if (kind === 'individual' || kind === 'solo') return 'FACULTY_RESEARCH_AREA';
  return '';
}

function hasTypedValue(values: string[] | undefined, allowed: Set<string>): boolean {
  return (values || []).some((value) => allowed.has((value || '').trim().toUpperCase()));
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
  const entityType = normalizedEntityType(facts);
  const leadCount = (facts.members || []).filter((member) =>
    LEAD_ROLES.has((member.role || '').trim().toLowerCase()),
  ).length;
  const contextLabelCount =
    compactStrings(facts.researchAreas).length + compactStrings(facts.departments).length;
  const duplicateCandidates = facts.duplicateCandidates || [];
  const explainabilityReasonCount = compactStrings(facts.topSearchReasons).length;
  const matchedQueryNames = compactStrings(facts.matchedQueryNames);
  const hasCenterActionRoute =
    facts.postedOpportunityCount > 0 ||
    hasTypedValue(facts.pathwayTypes, CENTER_ACTION_PATHWAY_TYPES) ||
    hasTypedValue(facts.publicContactRouteTypes, CENTER_ACTION_CONTACT_ROUTE_TYPES) ||
    hasTypedValue(facts.accessSignalTypes, CENTER_ACTION_ACCESS_SIGNAL_TYPES);
  const hasExploratoryFraming =
    hasTypedValue(facts.pathwayTypes, EXPLORATORY_PATHWAY_TYPES) ||
    hasTypedValue(facts.accessSignalTypes, EXPLORATORY_ACCESS_SIGNAL_TYPES) ||
    hasTypedValue(facts.publicContactRouteTypes, new Set(['FACULTY_PI']));

  const warningCodes: ResearchQualitySearchWarningCode[] = [];
  if (descriptionChars < 160) warningCodes.push('SPARSE_DESCRIPTION');
  if (leadCount === 0 && !CENTER_LIKE_ENTITY_TYPES.has(entityType)) {
    warningCodes.push('MISSING_LEAD');
  }
  if (contextLabelCount === 0) warningCodes.push('MISSING_CONTEXT');
  if (sourceUrls.length === 0 || sourceDomains.length === 0) warningCodes.push('WEAK_SOURCE_URL');
  if (!facts.sourceTitle || facts.sourceTitle.trim().length === 0) {
    warningCodes.push('WEAK_SOURCE_TITLE');
  }
  if (!hasTrustedSourceDomain(sourceDomains)) warningCodes.push('WEAK_SOURCE_DOMAIN');
  if (duplicateCandidates.length > 0) warningCodes.push('DUPLICATE_OR_DISAMBIGUATION_RISK');
  if (CENTER_LIKE_ENTITY_TYPES.has(entityType) && facts.publicContactRouteCount === 0) {
    warningCodes.push('MISSING_CENTER_CONTACT');
  }
  if (CENTER_LIKE_ENTITY_TYPES.has(entityType) && !hasCenterActionRoute) {
    warningCodes.push('CENTER_INDEX_ONLY');
  }
  if (entityType === 'FACULTY_RESEARCH_AREA' && !hasExploratoryFraming) {
    warningCodes.push('MISSING_EXPLORATORY_FRAMING');
  }
  if (
    !CENTER_LIKE_ENTITY_TYPES.has(entityType) &&
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
