import {
  controlledVocabularyHeadings,
  noteUnwarmedVocabularySplit,
  normalizedVocabularyHeading,
} from './controlledVocabularyHeadings';

const MIN_COMMAS_FOR_SPLIT = 2;

const ENUMERATION_CONJUNCTION_PATTERN = /(?:^|\s)(?:and|or)(?:\s|$)|&/i;

const COLON_ELABORATION_PATTERN = /:/;

/**
 * Splitting a person's free-text list into separate chips is right: four topics typed with
 * commas are four topics, and each is its own facet value. Splitting a controlled-vocabulary
 * heading is not, because everything after its first part is a qualifier rather than a topic,
 * so "Lymphoma, T-Cell, Cutaneous" becomes three chips of which two say nothing (#3807).
 *
 * No shape separates the two, and that was measured rather than assumed: "Hepatitis, Viral,
 * Human" and "Technology, Industry, Agriculture" are both three single words and both are
 * whole headings, while a same-shaped three-word list typed by a person is three topics.
 * What separates them is whether a source that reads a published term list asserted the whole
 * string as one term, so that is what this asks.
 */
export function splitDelimitedResearchArea(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const commaCount = (trimmed.match(/,/g) || []).length;
  if (commaCount < MIN_COMMAS_FOR_SPLIT) return [trimmed];
  if (ENUMERATION_CONJUNCTION_PATTERN.test(trimmed)) return [trimmed];
  if (COLON_ELABORATION_PATTERN.test(trimmed)) return [trimmed];
  if (controlledVocabularyHeadings().has(normalizedVocabularyHeading(trimmed))) return [trimmed];
  noteUnwarmedVocabularySplit(trimmed);

  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeResearchAreaList(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const part of splitDelimitedResearchArea(value)) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }

  return out;
}
