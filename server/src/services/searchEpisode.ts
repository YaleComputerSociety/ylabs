/**
 * How a run of search requests from one student is recognized as one search.
 *
 * Pure decisions only, and the single owner of them: `analyticsService` applies
 * them on the write path and the history-collapse script applies them to rows
 * already recorded, so a copy in either place would let the report and the data
 * disagree about what a search is.
 */

/**
 * How long after a recorded search a further search from the same student still
 * belongs to the same typing episode.
 *
 * The programs surface searches from a 500ms debounce with no submit
 * affordance, so a student who pauses mid-word mints an event for the partial
 * string. Prod holds `"rosenfeld"` followed 3s later by `"rosenfel"`, and
 * `"mechanicaengineering"` followed 890ms later by `"mechanical engineering"`.
 * The window has to outlast a real pause between edits without swallowing the
 * next thing a student decides to look up.
 */
export const SEARCH_EPISODE_WINDOW_MS = 15 * 1000;

/**
 * How far back the candidate lookup reaches for the row a search might fold
 * into.
 *
 * The window above is measured from the episode's last snapshot, so a slowly
 * typed query keeps folding and the row's first timestamp can be arbitrarily
 * older than that. This bound keeps the lookup on a short range of the
 * `{eventType, netid, timestamp}` index instead of every search a student has
 * ever run, and caps a single episode at a span no real typing episode reaches.
 */
export const SEARCH_EPISODE_MAX_SPAN_MS = 10 * 60 * 1000;

export const normalizeSearchEpisodeQuery = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const isSubsequenceOf = (candidate: string, text: string): boolean => {
  let index = 0;
  for (const character of text) {
    if (character === candidate[index]) index += 1;
    if (index === candidate.length) return true;
  }
  return index === candidate.length;
};

const sharedPrefixLength = (first: string, second: string): number => {
  const limit = Math.min(first.length, second.length);
  let length = 0;
  while (length < limit && first[length] === second[length]) length += 1;
  return length;
};

/**
 * How much of the shorter query the longer one has to open with before
 * subsequence containment is allowed to fold them together.
 *
 * A short query is a subsequence of almost any longer phrase: `"ai"` sits inside
 * `"machine learning"`, and `"cs"` inside `"physics"`. Without a shared opening
 * the containment test merges two deliberate lookups into one row and destroys
 * the earlier one, so a continued edit has to start the same way.
 */
const SEARCH_EPISODE_SHARED_PREFIX_FLOOR = 3;

/**
 * Whether two queries are edits of one another rather than two different
 * searches.
 *
 * Subsequence containment rather than a prefix test, because the recorded
 * snapshots include mid-string insertions: `"mechengineering"`,
 * `"mechaniengineering"`, `"mechanicaengineering"`, `"mechanical engineering"`
 * is one student typing one query, and no pair there is a prefix of another.
 * Reversing the operands covers a backspace. An empty query folds only into
 * another empty query: a filter-only search is one search however many times its
 * result set is reissued inside the window, and the caller's filter signature
 * keeps two different filter sets in two rows.
 */
export const isSameSearchEpisodeQuery = (previous: string, next: string): boolean => {
  const before = normalizeSearchEpisodeQuery(previous);
  const after = normalizeSearchEpisodeQuery(next);
  if (before === '' || after === '') return before === after;
  if (before === after) return true;

  const shorter = before.length < after.length ? before : after;
  const longer = before.length < after.length ? after : before;
  const requiredPrefix = Math.min(SEARCH_EPISODE_SHARED_PREFIX_FLOOR, shorter.length);
  if (sharedPrefixLength(shorter, longer) < requiredPrefix) return false;

  return isSubsequenceOf(shorter, longer);
};

export const searchEpisodeFilterSignature = (metadata: unknown): string => {
  const filters = (metadata as { filters?: unknown } | undefined)?.filters;
  if (!filters || typeof filters !== 'object') return '';
  return Object.entries(filters as Record<string, unknown>)
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? [...value].sort().join('|') : value}`)
    .sort()
    .join('&');
};

export const searchEpisodeSurface = (metadata: unknown): string =>
  String((metadata as { entityType?: unknown } | undefined)?.entityType ?? '');

/**
 * What became of a search that belongs to a typing episode already recorded.
 *
 * `stale` is an out-of-order snapshot: the episode has already moved past this
 * typing state, so recording it would either overwrite the query the student
 * settled on or add a row for a partial string they left behind.
 */
export type SearchEpisodeOutcome = 'folded' | 'stale' | 'separate';

/**
 * How many of the student's recent searches the lookup reads to find the row a
 * search belongs to.
 *
 * The newest row is not always that row: a search issued while an earlier one
 * was still in flight lands after it, and an unrelated search in between pushes
 * the episode further down the list. Five covers the overlapping requests one
 * student can have outstanding inside the window while keeping the read a small
 * bounded slice of one index range.
 */
export const SEARCH_EPISODE_CANDIDATE_LIMIT = 5;

/**
 * Whether this search is the same question the recorded row already asked.
 *
 * An identical query with an identical filter set is one search on any surface:
 * re-running a result set, which a sort change does, is not asking again. An
 * edit of the query is only the same question where the surface mints keystroke
 * snapshots; where every search comes from a deliberate action, an edit is a
 * second question and keeps its own row, which is what stops a hand-edited
 * follow-up from erasing the zero-result search before it.
 *
 * The filter set has to match for an episode with no query text, which is the
 * filter-only search the signature was added to keep apart. A student who
 * toggles a filter mid-word is still typing one query, so on a snapshot surface
 * that folds; whether the row then takes the filters the arriving search ran with
 * is decided by `isFullerSearchEpisodeQuery`, because a query and its result count
 * belong to the same snapshot and cannot be split across two.
 */
export const continuesSearchEpisode = (
  previous: { searchQuery?: string | null; metadata?: unknown },
  eventPayload: Record<string, unknown>,
  foldQueryEdits: boolean,
): boolean => {
  if (searchEpisodeSurface(previous.metadata) !== searchEpisodeSurface(eventPayload.metadata)) {
    return false;
  }

  const previousQuery = previous.searchQuery ?? '';
  const searchQuery = String(eventPayload.searchQuery ?? '');
  const isSameQuery =
    normalizeSearchEpisodeQuery(previousQuery) === normalizeSearchEpisodeQuery(searchQuery);
  const isSameFilterSet =
    searchEpisodeFilterSignature(previous.metadata) ===
    searchEpisodeFilterSignature(eventPayload.metadata);

  if (isSameQuery && isSameFilterSet) return true;
  if (normalizeSearchEpisodeQuery(searchQuery) === '') return false;
  return foldQueryEdits && isSameSearchEpisodeQuery(previousQuery, searchQuery);
};

/**
 * Which snapshot of a typing episode the report should attribute to the student.
 *
 * The fullest query, with the newest breaking a tie. The last keystroke of an
 * episode is often a backspace, so keeping the newest snapshot reports the
 * truncation instead of the query: Prod holds `"rosenfeld"` with a hit followed
 * by `"rosenfel"` with none, `"Schultz"` corrected into the misspelling
 * `"Schulz"`, and `"math"` with no results followed by the fragment `"m"` with
 * five. Keeping the fullest query also keeps the coverage gap it exposed, which
 * a shorter fragment hides.
 *
 * A query and its result count belong together, so this decides the whole row:
 * when the stored query wins, the search that arrived changes nothing but the
 * episode's last-snapshot time.
 */
export const isFullerSearchEpisodeQuery = (candidate: string, incumbent: string): boolean =>
  normalizeSearchEpisodeQuery(candidate).length > normalizeSearchEpisodeQuery(incumbent).length;
