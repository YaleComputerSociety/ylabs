/**
 * Query-time personalization for the default `/research` browse order.
 *
 * A student's declared research interests bias the "Recommended" browse feed
 * toward matching research homes without ever mutating the persisted, global
 * `browseRankScore`. The re-rank is a pure, stable partition applied to the
 * top-of-corpus candidate pool: homes whose governed research-area vocabulary
 * overlaps the student's declared interests float up (more overlap ranks
 * higher), and every home keeps its global browse order within an equal-overlap
 * tier. Homes past the personalization pool are never reordered, so pagination
 * stays consistent as the student scrolls. See issue #1468.
 */

export const MAX_STUDENT_RESEARCH_INTERESTS = 15;
export const PERSONALIZED_BROWSE_POOL_SIZE = 200;

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

/**
 * Stable re-rank of the browse candidate pool toward the declared interests.
 * Only the first `poolSize` hits are eligible to move; hits beyond the pool
 * keep their exact global browse position. With no interests (or no overlap in
 * the pool) the input order is returned unchanged, byte-for-byte.
 */
export const personalizeBrowseHits = <T extends Record<string, any>>(
  hits: readonly T[],
  interests: readonly string[],
  poolSize: number = PERSONALIZED_BROWSE_POOL_SIZE,
): T[] => {
  if (!Array.isArray(hits) || hits.length < 2) return [...hits];
  const normalizedInterests = normalizeResearchInterestSet(interests);
  if (normalizedInterests.size === 0) return [...hits];

  const boundedPoolSize = Math.max(0, Math.min(poolSize, hits.length));
  const pool = hits.slice(0, boundedPoolSize);
  const tail = hits.slice(boundedPoolSize);

  const scored = pool.map((hit, index) => ({
    hit,
    index,
    score: researchInterestMatchScore(hit, normalizedInterests),
  }));
  if (scored.every((entry) => entry.score === 0)) return [...hits];

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return [...scored.map((entry) => entry.hit), ...tail];
};
