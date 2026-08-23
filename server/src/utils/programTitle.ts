/**
 * Normalized identity key for a program/fellowship title.
 *
 * Punctuation-, case-, and whitespace-insensitive so a re-scrape whose title
 * drifted slightly (curly vs straight quotes, added qualifier) still resolves
 * to the same record instead of minting a duplicate (#609).
 *
 * The ampersand is folded to the word "and" so that "Sciences & Engineering"
 * and "Sciences and Engineering" resolve to the same program instead of two
 * cards (#655).
 */
export function normalizedProgramTitleKey(title: string): string {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

const AND_CONCATENATION_SPLIT = /\s+AND\s+/;

/**
 * Splits a source-corrupted "X AND Y" title (two fellowship names joined by a
 * literal all-caps "AND", distinct from the word "and" inside a normal title)
 * into normalized component keys, or [] when the title has no such join (#655).
 */
export function andConcatenationComponentKeys(title: string): string[] {
  const raw = String(title || '');
  if (!AND_CONCATENATION_SPLIT.test(raw)) return [];
  return raw
    .split(AND_CONCATENATION_SPLIT)
    .map((part) => normalizedProgramTitleKey(part))
    .filter(Boolean);
}

/**
 * True when two AND-concatenated titles share a component key, so title drift
 * on the *other* component (e.g. a prefix/qualifier rename) does not stop
 * them from resolving to the same underlying joint program (#655).
 */
export function shareAndConcatenatedTitleComponent(titleA: string, titleB: string): boolean {
  if (normalizedProgramTitleKey(titleA) === normalizedProgramTitleKey(titleB)) return false;
  const keysA = andConcatenationComponentKeys(titleA);
  const keysB = andConcatenationComponentKeys(titleB);
  if (keysA.length === 0 || keysB.length === 0) return false;
  return keysA.some((key) => keysB.includes(key));
}
