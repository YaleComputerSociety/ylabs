/**
 * Query-time personalization for the default `/research` browse order.
 *
 * A student's declared research interests and engagement intent bias the
 * "Recommended" browse feed toward matching research homes without ever
 * mutating the persisted, global `browseRankScore`. The re-rank is a pure,
 * stable partition applied to the top-of-corpus candidate pool: homes whose
 * governed research-area vocabulary overlaps the student's declared interests
 * float up (more overlap ranks higher), then, within an equal-overlap tier,
 * homes whose already-materialized entry-pathway / access evidence matches the
 * student's declared engagement intent float above those that do not. Every
 * home keeps its global browse order within an equal signal tier, and homes past
 * the personalization pool are never reordered, so pagination stays consistent
 * as the student scrolls. See issues #1468 and #1655.
 */

export const MAX_STUDENT_RESEARCH_INTERESTS = 15;
export const PERSONALIZED_BROWSE_POOL_SIZE = 200;

/**
 * A student's declared research-engagement intent: the concrete kind of
 * research relationship they want. Kept in lockstep with the `lookingFor` enum
 * on the StudentProfile schema, which imports this list as its single source of
 * truth.
 */
export const studentEngagementIntents = [
  'exploring',
  'ra-position',
  'thesis-advisor',
  'independent-study',
] as const;

export type StudentEngagementIntent = (typeof studentEngagementIntents)[number];

export const DEFAULT_STUDENT_ENGAGEMENT_INTENT: StudentEngagementIntent = 'exploring';

export const isStudentEngagementIntent = (value: unknown): value is StudentEngagementIntent =>
  typeof value === 'string' && (studentEngagementIntents as readonly string[]).includes(value);

/**
 * `exploring` (and any absent/invalid value) places no constraint on the feed,
 * so it never contributes an intent bias.
 */
export const isActiveEngagementIntent = (
  value: unknown,
): value is Exclude<StudentEngagementIntent, 'exploring'> =>
  isStudentEngagementIntent(value) && value !== 'exploring';

const INTEREST_MATCH_FIELDS = [
  'researchAreas',
  'departments',
  'studentSearchTerms',
  'topics',
] as const;

export const normalizeResearchInterestTerm = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const normalizeResearchInterestSet = (interests: readonly string[]): Set<string> => {
  const normalized = new Set<string>();
  for (const interest of interests) {
    const term = normalizeResearchInterestTerm(interest);
    if (term) normalized.add(term);
  }
  return normalized;
};

const hitFieldValues = (hit: Record<string, any>, field: string): string[] =>
  Array.isArray(hit?.[field])
    ? hit[field].filter((value: unknown): value is string => typeof value === 'string')
    : [];

/**
 * Number of distinct declared interests that appear in the home's governed
 * research-area vocabulary. Interests that match no corpus term contribute
 * nothing, so an unmatched interest degrades gracefully rather than distorting
 * the feed.
 */
export const researchInterestMatchScore = (
  hit: Record<string, any>,
  normalizedInterests: Set<string>,
): number => {
  if (normalizedInterests.size === 0) return 0;
  const matched = new Set<string>();
  for (const field of INTEREST_MATCH_FIELDS) {
    for (const value of hitFieldValues(hit, field)) {
      const term = normalizeResearchInterestTerm(value);
      if (term && normalizedInterests.has(term)) matched.add(term);
    }
  }
  return matched.size;
};

const hitStringField = (hit: Record<string, any>, field: string): string =>
  typeof hit?.[field] === 'string' ? hit[field] : '';

const RA_POSITION_COMPENSATION = 'PAID_OR_STIPEND';
const RA_POSITION_AVAILABILITY = new Set(['OPEN', 'ROLLING']);
const THESIS_ADVISOR_ENTITY_TYPES = new Set(['LAB', 'FACULTY_RESEARCH_AREA', 'COURSE_SEQUENCE']);
const INDEPENDENT_STUDY_ENTITY_TYPE = 'COURSE_SEQUENCE';
const INDEPENDENT_STUDY_COMPENSATION = 'COURSE_CREDIT';

/**
 * Whether a home carries the already-materialized entry-pathway / access
 * evidence that matches a declared engagement intent. Reads only fields the
 * browse-rank service already materializes onto each home (compensation model,
 * current availability, entity type); it never inspects free text and never
 * fabricates a pathway an entity's evidence does not support. A home lacking the
 * evidence returns false and therefore keeps its global browse position.
 *
 *  - `ra-position`        -> paid/stipended RA compensation or a posted opening
 *                            (currently OPEN/ROLLING for undergrads).
 *  - `thesis-advisor`     -> faculty-led homes (LAB / FACULTY_RESEARCH_AREA) and
 *                            senior-thesis COURSE_SEQUENCE pathways.
 *  - `independent-study`  -> directed-study COURSE_SEQUENCE pathways or
 *                            course-credit compensation.
 *  - `exploring`          -> no constraint, so never a positive match.
 */
export const researchHomeMatchesEngagementIntent = (
  hit: Record<string, any>,
  intent: StudentEngagementIntent | undefined,
): boolean => {
  switch (intent) {
    case 'ra-position':
      return (
        hitStringField(hit, 'undergraduateCompensationModel') === RA_POSITION_COMPENSATION ||
        RA_POSITION_AVAILABILITY.has(hitStringField(hit, 'undergraduateCurrentAvailability'))
      );
    case 'thesis-advisor':
      return THESIS_ADVISOR_ENTITY_TYPES.has(hitStringField(hit, 'entityType'));
    case 'independent-study':
      return (
        hitStringField(hit, 'entityType') === INDEPENDENT_STUDY_ENTITY_TYPE ||
        hitStringField(hit, 'undergraduateCompensationModel') === INDEPENDENT_STUDY_COMPENSATION
      );
    default:
      return false;
  }
};

export interface BrowsePersonalizationSignals {
  interests?: readonly string[];
  lookingFor?: StudentEngagementIntent;
}

/**
 * Stable re-rank of the browse candidate pool toward the declared interests and
 * engagement intent. Only the first `poolSize` hits are eligible to move; hits
 * beyond the pool keep their exact global browse position. Ordering is a
 * lexicographic stable partition: research-interest overlap first (more overlap
 * ranks higher), then intent-evidence match within an equal-overlap tier, then
 * the original global browse order. With no active signal (or no overlap and no
 * intent match in the pool) the input order is returned unchanged, byte-for-byte.
 */
export const personalizeBrowseHits = <T extends Record<string, any>>(
  hits: readonly T[],
  signals: BrowsePersonalizationSignals,
  poolSize: number = PERSONALIZED_BROWSE_POOL_SIZE,
): T[] => {
  if (!Array.isArray(hits) || hits.length < 2) return [...hits];
  const normalizedInterests = normalizeResearchInterestSet(signals.interests ?? []);
  const intent = isActiveEngagementIntent(signals.lookingFor) ? signals.lookingFor : undefined;
  if (normalizedInterests.size === 0 && !intent) return [...hits];

  const boundedPoolSize = Math.max(0, Math.min(poolSize, hits.length));
  const pool = hits.slice(0, boundedPoolSize);
  const tail = hits.slice(boundedPoolSize);

  const scored = pool.map((hit, index) => ({
    hit,
    index,
    interestScore: researchInterestMatchScore(hit, normalizedInterests),
    intentMatch: researchHomeMatchesEngagementIntent(hit, intent) ? 1 : 0,
  }));
  if (scored.every((entry) => entry.interestScore === 0 && entry.intentMatch === 0)) {
    return [...hits];
  }

  scored.sort(
    (a, b) =>
      b.interestScore - a.interestScore ||
      b.intentMatch - a.intentMatch ||
      a.index - b.index,
  );
  return [...scored.map((entry) => entry.hit), ...tail];
};
