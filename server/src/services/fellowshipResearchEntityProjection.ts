/**
 * Projects a curated `Fellowship`/program record into the fields of a
 * first-class `ResearchEntity` typed `RA_PROGRAM` or `FELLOWSHIP_PROGRAM`, so
 * structured research programs and fellowships become discoverable in the
 * primary `/research` corpus alongside labs and centers (issue #1381).
 *
 * Pure and DB-free so the projection shape (type selection, stable keying,
 * copy hygiene, access shape) is unit-testable in isolation. The DB writer that
 * consumes this lives in `fellowshipResearchEntityProjectionService.ts`.
 */
import { sanitizeResearchEntityDescription } from '../utils/descriptionHygiene';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';
import {
  isBareDomainRootUrl,
  isDisallowedResearchEntitySourceUrl,
} from '../utils/researchHomeWebsiteUrl';
import { normalizedProgramTitleKey } from '../utils/programTitle';
import { deriveShortDescriptionFromFullDescription } from '../utils/researchEntityDescriptionQuality';
import { classifyProgramResearchRelevance } from './programResearchRelevance';
import { STUDENT_VISIBILITY_VERSION } from './studentVisibilityTier';

export interface FellowshipProjectionInput {
  sourceKey?: string;
  title?: string;
  summary?: string;
  description?: string;
  eligibility?: string;
  applicationInformation?: string;
  additionalInformation?: string;
  studentFacingCategory?: string;
  programKind?: string;
  programCategory?: string;
  entryMode?: string;
  purpose?: string[];
  sourceUrl?: string;
  sourceName?: string;
  applicationLink?: string;
  links?: Array<{ label?: string; url?: string }>;
  studentVisibilityTier?: string;
  archived?: boolean;
}

export type ProjectedProgramEntityType = 'RA_PROGRAM' | 'FELLOWSHIP_PROGRAM';

export type ProjectedAccessSignalType =
  | 'APPLICATION_ONLY'
  | 'APPLICATION_FORM_EXISTS'
  | 'RECURRING_PROGRAM';

export interface ProjectedAccessSignal {
  type: ProjectedAccessSignalType;
  excerpt: string;
}

export interface FellowshipResearchEntityProjection {
  slug: string;
  entityType: ProjectedProgramEntityType;
  set: Record<string, unknown>;
  accessSignals: ProjectedAccessSignal[];
  sourceUrl: string;
}

export interface FellowshipProjectionSkip {
  skip: string;
  slug?: string;
}

const PROJECTED_PROGRAM_SLUG_PREFIX = 'program-';

const RESEARCH_PARTICIPATION_PROGRAM_KINDS = new Set([
  'RA_PROGRAM',
  'STRUCTURED_PROGRAM',
  'CENTER_INTERNSHIP',
  'MENTOR_MATCHING',
]);

const RESEARCH_PARTICIPATION_PROGRAM_CATEGORIES = new Set([
  'RECURRING_PROGRAM',
  'SUMMER_RESEARCH_PROGRAM',
  'CENTER_INTERNSHIP',
]);

const RECURRING_PROGRAM_CATEGORIES = new Set([
  'RECURRING_PROGRAM',
  'SUMMER_RESEARCH_PROGRAM',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function slugifyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Stable, collision-free slug for a projected program. Keyed off the
 * Fellowship's own unique `sourceKey` (falling back to a normalized title key)
 * and namespaced with a `program-` prefix so a re-run of the projection updates
 * the same ResearchEntity rather than minting a duplicate, and so it never
 * collides with a scraper-produced research-home slug.
 */
export function projectedProgramSlug(fellowship: FellowshipProjectionInput): string | null {
  const rawKey = textValue(fellowship.sourceKey);
  const keySource = rawKey || normalizedProgramTitleKey(textValue(fellowship.title));
  const slugBody = slugifyKey(keySource);
  return slugBody ? `${PROJECTED_PROGRAM_SLUG_PREFIX}${slugBody}` : null;
}

export function selectProjectedProgramEntityType(
  fellowship: FellowshipProjectionInput,
): ProjectedProgramEntityType {
  const kind = textValue(fellowship.programKind).toUpperCase();
  const category = textValue(fellowship.programCategory).toUpperCase();
  if (
    RESEARCH_PARTICIPATION_PROGRAM_KINDS.has(kind) ||
    RESEARCH_PARTICIPATION_PROGRAM_CATEGORIES.has(category)
  ) {
    return 'RA_PROGRAM';
  }
  return 'FELLOWSHIP_PROGRAM';
}

function collectPublicSourceUrls(fellowship: FellowshipProjectionInput): string[] {
  const candidates = [
    textValue(fellowship.sourceUrl),
    textValue(fellowship.applicationLink),
    ...(Array.isArray(fellowship.links) ? fellowship.links.map((link) => textValue(link?.url)) : []),
  ];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const url of candidates) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (
      isPublicHttpUrl(url) &&
      !isBareDomainRootUrl(url) &&
      !isDisallowedResearchEntitySourceUrl(url)
    ) {
      kept.push(url);
    }
  }
  return kept;
}

function hasApplicationRoute(fellowship: FellowshipProjectionInput): boolean {
  const routes = [
    textValue(fellowship.applicationLink),
    ...(Array.isArray(fellowship.links) ? fellowship.links.map((link) => textValue(link?.url)) : []),
  ];
  return routes.some((url) => isPublicHttpUrl(url));
}

export function selectProjectedAccessSignals(
  fellowship: FellowshipProjectionInput,
): ProjectedAccessSignal[] {
  const category = textValue(fellowship.programCategory).toUpperCase();
  const title = textValue(fellowship.title);
  const signals: ProjectedAccessSignal[] = [
    { type: 'APPLICATION_ONLY', excerpt: `Apply to ${title} through its official program page.` },
  ];
  if (RECURRING_PROGRAM_CATEGORIES.has(category)) {
    signals.push({
      type: 'RECURRING_PROGRAM',
      excerpt: `${title} runs as a recurring research program with its own application cycle.`,
    });
  } else if (hasApplicationRoute(fellowship)) {
    signals.push({
      type: 'APPLICATION_FORM_EXISTS',
      excerpt: `${title} has an application route students can use to apply.`,
    });
  }
  return signals;
}

function cleanDescription(raw: string): string {
  return sanitizeResearchEntityDescription(redactDirectContactInfo(raw));
}

/**
 * Only emit a card when the shared deriver can ground a quality-passing summary
 * in the program's own description; otherwise return '' so the browse card falls
 * back to the full description rather than serving a truncated fragment. A
 * program-like home is not gated on having a lab-style card (see
 * `researchEntityPublicDescription`), so an empty card is safe here.
 */
function buildShortDescription(fullDescription: string): string {
  return deriveShortDescriptionFromFullDescription(fullDescription);
}

/**
 * Build the ResearchEntity projection for one Fellowship, or a skip reason.
 *
 * Fails closed: only `student_ready`, research-related programs with a usable
 * public source URL are projected, and all served copy is contact-redacted and
 * run through the research-entity description sanitizer at write time (the same
 * copy is re-sanitized at serve time by the shared serve-time sanitizer).
 */
export function buildFellowshipResearchEntityProjection(
  fellowship: FellowshipProjectionInput,
): FellowshipResearchEntityProjection | FellowshipProjectionSkip {
  const slug = projectedProgramSlug(fellowship);
  const title = textValue(fellowship.title);

  if (fellowship.archived === true) return { skip: 'archived', ...(slug ? { slug } : {}) };
  if (textValue(fellowship.studentVisibilityTier) !== 'student_ready') {
    return { skip: 'not-student-ready', ...(slug ? { slug } : {}) };
  }
  if (!title) return { skip: 'missing-title' };
  if (!slug) return { skip: 'no-stable-key' };
  if (!classifyProgramResearchRelevance(fellowship).researchRelated) {
    return { skip: 'not-research-related', slug };
  }

  const sourceUrls = collectPublicSourceUrls(fellowship);
  if (sourceUrls.length === 0) return { skip: 'no-public-source-url', slug };

  const entityType = selectProjectedProgramEntityType(fellowship);
  const fullDescription = cleanDescription(
    textValue(fellowship.description) || textValue(fellowship.summary),
  );
  const shortDescription = buildShortDescription(fullDescription);

  const set: Record<string, unknown> = {
    name: title,
    displayName: title,
    kind: 'program',
    entityType,
    fullDescription,
    shortDescription,
    sourceUrls,
    websiteUrl: sourceUrls[0],
    activeAtYaleCache: true,
    yaleStatusCache: 'active',
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityComputedTier: 'student_ready',
    studentVisibilityOverrideTier: 'student_ready',
    studentVisibilityReasons: ['projected_from_student_ready_fellowship'],
    studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
  };

  return {
    slug,
    entityType,
    set,
    accessSignals: selectProjectedAccessSignals(fellowship),
    sourceUrl: sourceUrls[0],
  };
}
