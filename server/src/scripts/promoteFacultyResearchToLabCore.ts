import type { ResearchEntityType } from '../models/researchAccessTypes';

export const PROMOTED_ENTITY_TYPE: ResearchEntityType = 'LAB';
export const PROMOTED_KIND = 'lab';
export const PROMOTABLE_SOURCE_ENTITY_TYPE: ResearchEntityType = 'FACULTY_RESEARCH_AREA';

const PLACEHOLDER_NAME_SUFFIX = /\s+faculty\s+research\s*$/i;

/**
 * A page declaring itself a laboratory, judged only on self-reference a visitor
 * would read as the site talking about its own lab.
 *
 * The looser marker set in `findLabWebsitesCore` is deliberately not reused: it
 * includes "publications" and "research interests", which appear on any
 * academic's personal homepage. Measured over the websites of 132 live
 * `FACULTY_RESEARCH_AREA` rows and 78 rows already typed `LAB`, the loose set
 * fires on 55% of the former, while this set fires on 7% of them against 63% of
 * the known labs. Promoting on the loose set would have typed roughly 240
 * personal homepages as laboratories (#2686).
 */
const LAB_SELF_DECLARATION_RE =
  /\b(?:our lab|the lab|lab members|join the lab|lab news|lab alumni|our group|group members|lab website|principal investigator)\b/i;

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
  | 'missing_website_url'
  | 'website_url_shared'
  | 'website_url_is_org_page'
  | 'website_url_is_department_bio_page'
  | 'only_shared_citations'
  | 'website_unreachable'
  | 'website_declares_no_lab'
  | 'website_states_no_lab_name'
  | 'website_is_a_shared_group';

/**
 * Promoting a row to `LAB` keeps it person-scoped, so the shared-citation defence
 * in studentVisibilityGateService still examines it afterwards. This threshold must
 * stay in step with SHARED_CITATION_PERSON_ROW_THRESHOLD there, or a promotion would
 * write a row the gate then hides for citing only widely-shared pages (#2460).
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
  websiteStatus?: number;
  websiteText?: string;
  /** The site's own title lines: `og:site_name`, `<title>`, and the first `<h1>`. */
  websiteTitles?: string[];
  nameLocked?: boolean;
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
  /** The lab's name as its own site states it, asserted with the type. */
  toName?: string;
  holdReason?: FacultyResearchPromotionHoldReason;
}

/**
 * Retained because the placeholder shape is still worth reporting on, and because
 * `looksLikeDepartmentBioPage` strips it to recover the person's name tokens. It is
 * no longer a promotion gate: the name shape answers "is this row still a
 * placeholder", which is a different question from "is this row a laboratory", and
 * only the page answers the second. Gating on it held 610 live rows that carry the
 * evidence, because the corpus mints placeholder names in at least three shapes and
 * this matches one of them (#2686).
 */
export function hasPlaceholderFacultyResearchName(value?: string | null): boolean {
  if (typeof value !== 'string') return false;
  return PLACEHOLDER_NAME_SUFFIX.test(value.trim());
}

/**
 * Whether the row's own cited website declares itself a laboratory.
 *
 * Deliberately does not re-check that the page names the row's lead, unlike
 * `isAdoptableLabSite`. That check exists because discovery starts from a search
 * result and must tie an unknown URL to a row; here the URL is already this row's
 * stored `websiteUrl`, harvested from this row's own profile page, so provenance
 * has made the tie. Re-demanding it refuses real lab sites that name their lead by
 * first name only.
 */
export function websiteDeclaresLaboratory(candidate: {
  websiteStatus?: number;
  websiteText?: string;
}): boolean {
  const status = candidate.websiteStatus ?? 0;
  if (status < 200 || status >= 400) return false;
  return LAB_SELF_DECLARATION_RE.test(candidate.websiteText ?? '');
}

export const TITLE_SEGMENT_SEPARATOR = /\s+[|\u2013\u2014\u00b7\u2022\u00bb:]\s+|\s+-\s+/;
const LAB_NOUN_RE = /\b(?:lab|labs|laboratory|group)\b/i;
const TITLE_SEGMENT_FURNITURE_RE = /^(?:welcome\s+to\s+(?:the\s+)?|home\s*$)/i;
const MAX_LAB_NAME_WORDS = 10;

/**
 * The lab's own name, read from the title lines the site gives itself.
 *
 * A title is the one place a lab's site states its name in a fixed slot, so this
 * reads a segment rather than prose: "Forest Ecology & Resilience Lab", or "Liu lab"
 * out of "Proteomics | West Haven | Liu lab". The segment must name a lab, laboratory
 * or group, which is also what makes the site a laboratory for promotion, and the
 * trailing noun is capitalised because a name is a proper noun ("DEEP lab" serves as
 * "DEEP Lab"). An institution's "National Laboratory" is never one person's lab.
 */
export function labNameFromSiteTitles(titles: readonly string[] | undefined): string {
  for (const raw of titles ?? []) {
    const title = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) continue;
    for (const piece of title.split(TITLE_SEGMENT_SEPARATOR)) {
      const segment = piece.replace(TITLE_SEGMENT_FURNITURE_RE, '').trim();
      if (!segment || !LAB_NOUN_RE.test(segment)) continue;
      if (/\bnational\s+laborator(?:y|ies)\b/i.test(segment)) continue;
      if (segment.split(/\s+/).length > MAX_LAB_NAME_WORDS) continue;
      return segment
        .replace(/(?:,\s*|\s+at\s+)(?:yale(?:\s+university)?|yale\s+school\s+of\s+[a-z ]+)$/i, '')
        .trim()
        .replace(
          /\b(lab|labs|laboratory|group)$/i,
          (noun) => noun.charAt(0).toUpperCase() + noun.slice(1).toLowerCase(),
        );
    }
  }
  return '';
}

export function websiteWasReachable(candidate: { websiteStatus?: number }): boolean {
  const status = candidate.websiteStatus ?? 0;
  return status >= 200 && status < 400;
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

/**
 * Whether a site-stated lab name may become this row's name. Supplied by the caller,
 * because the judgement needs the name-identity authority and the surname roster,
 * which refuse an umbrella organization or another person's lab.
 */
export type LabNameAdmissibility = (
  labName: string,
  candidate: FacultyResearchPromotionCandidate,
) => boolean;

/**
 * A group site one level below a department or sites host: `<group>.cs.yale.edu`,
 * `<group>.sites.yale.edu`. Both shared groups the 2026-10-16 dry run would have renamed
 * a member after sat on this shape, and none of the single-lead labs it promoted did.
 */
export function isDepartmentGroupSubdomain(value: string): boolean {
  const parts = urlParts(value);
  if (!parts) return false;
  const labels = parts.host.split('.');
  return labels.length >= 4 && labels.slice(-2).join('.') === 'yale.edu';
}

function labNameNamesThePerson(labName: string, rowName: string): boolean {
  const tokens = normalizeEntityName(rowName)
    .replace(PLACEHOLDER_NAME_SUFFIX, '')
    .split(/[^a-z]+/)
    .filter((token) => token.length > 2);
  const name = normalizeEntityName(labName);
  return tokens.some((token) => new RegExp(`\\b${token}\\b`).test(name));
}

const ADMIT_EVERY_LAB_NAME: LabNameAdmissibility = () => true;

export function classifyFacultyResearchPromotion(
  candidate: FacultyResearchPromotionCandidate,
  isAdmissibleLabName: LabNameAdmissibility = ADMIT_EVERY_LAB_NAME,
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
  // The URL guards above decide whether the page belongs to this row at all. Only
  // once it does is what the page SAYS worth reading, so the page evidence is the
  // last gate rather than the first.
  if (!websiteWasReachable(candidate)) {
    row.holdReason = 'website_unreachable';
    return row;
  }
  // A lab that names itself in its own title has declared itself a laboratory, and a
  // promotion without that name would serve a LAB still titled "<Name> Faculty
  // Research", so the stated name is what the promotion rests on (#5059).
  const labName = labNameFromSiteTitles(candidate.websiteTitles);
  if (!labName && !websiteDeclaresLaboratory(candidate)) {
    row.holdReason = 'website_declares_no_lab';
    return row;
  }
  if (!labName || !isAdmissibleLabName(labName, candidate)) {
    row.holdReason = 'website_states_no_lab_name';
    return row;
  }
  // A topic-named group on a department's group subdomain (`graphics.cs.yale.edu`,
  // `cmtheory.sites.yale.edu`) is shared by the department's faculty in that area, so
  // naming one member's row after it would hand that member the whole group (#5059).
  // The member keeps the group site as a website; only the rename is held. An eponymous
  // name on such a host still names its own lead.
  if (isDepartmentGroupSubdomain(websiteUrl) && !labNameNamesThePerson(labName, name)) {
    row.holdReason = 'website_is_a_shared_group';
    return row;
  }

  row.decision = 'PROMOTE';
  row.toEntityType = PROMOTED_ENTITY_TYPE;
  if (!candidate.nameLocked) row.toName = labName;
  if (candidate.kind !== PROMOTED_KIND) {
    row.fromKind = candidate.kind == null ? '' : String(candidate.kind);
    row.toKind = PROMOTED_KIND;
  }
  return row;
}

export function planFacultyResearchPromotion(
  candidates: FacultyResearchPromotionCandidate[],
  isAdmissibleLabName?: LabNameAdmissibility,
): FacultyResearchPromotionRow[] {
  return candidates.map((candidate) =>
    classifyFacultyResearchPromotion(candidate, isAdmissibleLabName),
  );
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
