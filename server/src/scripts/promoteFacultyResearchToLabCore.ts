import type { ResearchEntityType } from '../models/researchAccessTypes';

export const PROMOTED_ENTITY_TYPE: ResearchEntityType = 'LAB';
export const PROMOTED_KIND = 'lab';
export const PROMOTABLE_SOURCE_ENTITY_TYPE: ResearchEntityType = 'FACULTY_RESEARCH_AREA';

const PLACEHOLDER_NAME_SUFFIX = /\s+faculty\s+research\s*$/i;

const LAB_PATH_SEGMENT = 'lab';

/**
 * Hosts that belong to a school or the university rather than to one researcher.
 * Their root page is an institutional landing page, so it is never a lab site.
 */
const INSTITUTIONAL_ROOT_HOSTS = new Set([
  'yale.edu',
  'medicine.yale.edu',
  'ysph.yale.edu',
  'ysm.yale.edu',
  'engineering.yale.edu',
  'eng.yale.edu',
  'law.yale.edu',
  'nursing.yale.edu',
  'som.yale.edu',
  'environment.yale.edu',
  'divinity.yale.edu',
  'architecture.yale.edu',
  'music.yale.edu',
  'drama.yale.edu',
  'art.yale.edu',
  'yalecollege.yale.edu',
  'science.yalecollege.yale.edu',
  'research.yale.edu',
  'campuspress.yale.edu',
  'sites.yale.edu',
  'seas.yale.edu',
  'graduateschool.yale.edu',
]);

export type FacultyResearchPromotionDecision = 'PROMOTE' | 'HOLD';

export type FacultyResearchPromotionHoldReason =
  | 'not_faculty_research_area'
  | 'name_not_placeholder'
  | 'missing_website_url'
  | 'website_url_shared'
  | 'website_url_is_org_page'
  | 'website_url_is_department_bio_page'
  | 'only_shared_citations';

/**
 * Promoting a row out of `FACULTY_RESEARCH_AREA` removes it from
 * `PERSON_SCOPED_GATE_ENTITY_TYPES`, so the shared-citation defence in
 * studentVisibilityGateService stops examining it. This threshold must stay in
 * step with SHARED_CITATION_PERSON_ROW_THRESHOLD there, or a row whose every
 * citation is a widely-shared page could be promoted past the gate (#2460).
 */
export const SHARED_CITATION_PROMOTION_THRESHOLD = 25;

export interface FacultyResearchPromotionCandidate {
  id: unknown;
  slug?: string | null;
  name?: string | null;
  entityType?: string | null;
  kind?: string | null;
  websiteUrl?: string | null;
  urlUsageCount?: number;
  sourceUrlUsageCounts?: number[];
}

export interface FacultyResearchPromotionRow {
  id: unknown;
  slug: string;
  decision: FacultyResearchPromotionDecision;
  name: string;
  fromEntityType: string;
  toEntityType?: ResearchEntityType;
  fromKind?: string;
  toKind?: string;
  websiteUrl?: string;
  holdReason?: FacultyResearchPromotionHoldReason;
}

export function hasPlaceholderFacultyResearchName(value?: string | null): boolean {
  if (typeof value !== 'string') return false;
  return PLACEHOLDER_NAME_SUFFIX.test(value.trim());
}

export function normalizeEntityName(value?: string | null): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
}

export function normalizeWebsiteUrl(value?: string | null): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function urlParts(value: string): { host: string; segments: string[] } | null {
  try {
    const parsed = new URL(value);
    return {
      host: parsed.hostname.replace(/^www\./i, '').toLowerCase(),
      segments: parsed.pathname.split('/').filter(Boolean),
    };
  } catch {
    return null;
  }
}

/**
 * A researcher's own site is a domain or subdomain root, or a `/lab/` microsite.
 * Anything two or more segments deep on a shared host is a program, division, or
 * service page grafted onto the row rather than that person's lab (#2460).
 * Unparseable input fails closed.
 */
export function looksLikeOrgPage(value?: string | null): boolean {
  if (typeof value !== 'string' || !value) return true;
  const parts = urlParts(value);
  if (!parts) return true;
  if (parts.segments.some((segment) => segment.toLowerCase() === LAB_PATH_SEGMENT)) return false;
  if (parts.segments.length >= 2) return true;
  if (parts.segments.length === 0) return INSTITUTIONAL_ROOT_HOSTS.has(parts.host);
  return false;
}

/**
 * A single path segment that spells the person's own name on a shared department
 * host is that person's bio page, not a lab site (`appliedphysics.yale.edu/paul-fleury`).
 * Promoting it would mint a lab that does not exist.
 */
export function looksLikeDepartmentBioPage(
  personName?: string | null,
  value?: string | null,
): boolean {
  if (typeof value !== 'string' || !value) return false;
  const parts = urlParts(value);
  if (!parts || parts.segments.length !== 1) return false;
  if (!parts.host.endsWith('yale.edu')) return false;
  const tokens = normalizeEntityName(personName)
    .replace(PLACEHOLDER_NAME_SUFFIX, '')
    .split(' ')
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return false;
  const segment = parts.segments[0].toLowerCase();
  return tokens.filter((token) => segment.includes(token)).length >= 2;
}

export function hasOnlySharedCitations(
  sourceUrlUsageCounts?: number[],
  threshold: number = SHARED_CITATION_PROMOTION_THRESHOLD,
): boolean {
  if (!Array.isArray(sourceUrlUsageCounts) || sourceUrlUsageCounts.length === 0) return false;
  return sourceUrlUsageCounts.every((count) => count > threshold);
}

export function classifyFacultyResearchPromotion(
  candidate: FacultyResearchPromotionCandidate,
): FacultyResearchPromotionRow {
  const name = String(candidate.name ?? '').trim();
  const row: FacultyResearchPromotionRow = {
    id: candidate.id,
    slug: String(candidate.slug ?? ''),
    decision: 'HOLD',
    name,
    fromEntityType: String(candidate.entityType ?? ''),
  };
  const websiteUrl = String(candidate.websiteUrl ?? '').trim();
  if (websiteUrl) row.websiteUrl = websiteUrl;

  if (candidate.entityType !== PROMOTABLE_SOURCE_ENTITY_TYPE) {
    row.holdReason = 'not_faculty_research_area';
    return row;
  }
  if (!hasPlaceholderFacultyResearchName(name)) {
    row.holdReason = 'name_not_placeholder';
    return row;
  }
  if (!websiteUrl) {
    row.holdReason = 'missing_website_url';
    return row;
  }
  if ((candidate.urlUsageCount ?? 0) !== 1) {
    row.holdReason = 'website_url_shared';
    return row;
  }
  if (looksLikeOrgPage(websiteUrl)) {
    row.holdReason = 'website_url_is_org_page';
    return row;
  }
  if (looksLikeDepartmentBioPage(name, websiteUrl)) {
    row.holdReason = 'website_url_is_department_bio_page';
    return row;
  }
  if (hasOnlySharedCitations(candidate.sourceUrlUsageCounts)) {
    row.holdReason = 'only_shared_citations';
    return row;
  }

  row.decision = 'PROMOTE';
  row.toEntityType = PROMOTED_ENTITY_TYPE;
  if (candidate.kind !== PROMOTED_KIND) {
    row.fromKind = candidate.kind == null ? '' : String(candidate.kind);
    row.toKind = PROMOTED_KIND;
  }
  return row;
}

export function planFacultyResearchPromotion(
  candidates: FacultyResearchPromotionCandidate[],
): FacultyResearchPromotionRow[] {
  return candidates.map((candidate) => classifyFacultyResearchPromotion(candidate));
}

export interface FacultyResearchPromotionSummary {
  scanned: number;
  promoted: number;
  held: number;
  kindRealigned: number;
  byHoldReason: Record<string, number>;
}

export function summarizeFacultyResearchPromotion(
  scanned: number,
  rows: FacultyResearchPromotionRow[],
): FacultyResearchPromotionSummary {
  const byHoldReason: Record<string, number> = {};
  let promoted = 0;
  let kindRealigned = 0;
  for (const row of rows) {
    if (row.decision === 'PROMOTE') {
      promoted += 1;
      if (row.toKind) kindRealigned += 1;
      continue;
    }
    const reason = row.holdReason ?? 'unknown';
    byHoldReason[reason] = (byHoldReason[reason] ?? 0) + 1;
  }
  return { scanned, promoted, held: rows.length - promoted, kindRealigned, byHoldReason };
}
