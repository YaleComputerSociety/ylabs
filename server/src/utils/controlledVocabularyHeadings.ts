import { Observation } from '../models/observation';

/**
 * Lanes that read a published term list and record each term verbatim, so a comma inside a
 * value they assert is part of one heading rather than a separator.
 *
 * Both read the same MeSH keyword vocabulary, one from its index and one from a profile page
 * that cites it. Measured on Development: they assert 524 and 533 comma-carrying terms
 * respectively, and between them they assert whole 18 of the 32 stored labels the serve path
 * was splitting.
 *
 * Deliberately not every lane that happens to emit a comma. `lab-microsite-description-llm`
 * asserts 181 comma-carrying values and covers 6 of the same labels, but it reads prose and a
 * model can emit a list, so its commas carry no claim about term boundaries. Adding it would
 * stop splitting genuine lists, which is the defect running in the other direction.
 */
export const CONTROLLED_VOCABULARY_RESEARCH_AREA_SOURCES = [
  'ysm-mesh-keyword',
  'ysm-faculty-directory',
] as const;

/**
 * Long, because the vocabulary is a published term list that changes on the source's release
 * schedule rather than with the corpus. The cost of a stale entry is that one newly published
 * heading is split until the next load, which is the behaviour that already exists today.
 */
const HEADING_CACHE_TTL_MS = 60 * 60 * 1000;

export const normalizedVocabularyHeading = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase();

let cached: { headings: ReadonlySet<string>; loadedAt: number } | undefined;

/** Drops the cached vocabulary so the next load re-reads the observation log. */
export function resetControlledVocabularyHeadingsCache(): void {
  cached = undefined;
}

/**
 * The headings loaded so far, readable synchronously because the split runs inside a
 * synchronous label normalizer that several serve paths share.
 *
 * Empty until a warm completes, and an empty set means today's behaviour: the value is
 * split. That is the safe direction for a cold process - it cannot serve anything the
 * current code does not already serve - but it is a window where the fix does not apply, so
 * `noteUnwarmedVocabularySplit` makes it visible rather than silent.
 */
export function controlledVocabularyHeadings(): ReadonlySet<string> {
  return cached?.headings ?? new Set<string>();
}

export function controlledVocabularyHeadingsAreWarm(): boolean {
  return cached !== undefined;
}

/**
 * Only the comma-carrying terms are kept. A term with no comma can never reach the split, so
 * holding the whole 3,400-term vocabulary in memory would cost six times the entries to
 * decide nothing.
 */
export async function warmControlledVocabularyHeadings(
  now: number = Date.now(),
): Promise<ReadonlySet<string>> {
  if (cached && now - cached.loadedAt < HEADING_CACHE_TTL_MS) return cached.headings;
  const rows = await Observation.find({
    sourceName: { $in: [...CONTROLLED_VOCABULARY_RESEARCH_AREA_SOURCES] },
    field: 'researchAreas',
  })
    .select('value')
    .lean();
  const headings = new Set<string>();
  for (const row of rows as Array<{ value?: unknown }>) {
    const entries = Array.isArray(row.value) ? row.value : [row.value];
    for (const entry of entries) {
      if (typeof entry !== 'string' || !entry.includes(',')) continue;
      const normalized = normalizedVocabularyHeading(entry);
      if (normalized) headings.add(normalized);
    }
  }
  cached = { headings, loadedAt: now };
  return headings;
}

let unwarmedSplitReported = false;

/**
 * Said once per process, because the alternative is a fix that is inert for an unknown window
 * and reports nothing: #3418 and #2513 are both cases where a green-looking signal had never
 * been exercised. Once is enough to tell an operator the warm did not run, and more would
 * drown the log on a path that runs per request.
 */
export function noteUnwarmedVocabularySplit(value: string): void {
  if (unwarmedSplitReported || controlledVocabularyHeadingsAreWarm()) return;
  unwarmedSplitReported = true;
  console.warn(
    `[research-area] split a ${value.split(',').length}-part label with no controlled vocabulary loaded, ` +
      'so a published heading may be served as fragments; call warmControlledVocabularyHeadings on start (#3807)',
  );
}

export function resetUnwarmedVocabularySplitReport(): void {
  unwarmedSplitReported = false;
}
