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

function programTitleTokens(title: string): string[] {
  return String(title || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when the shorter title's tokens are fully contained in the longer
 * title's tokens, so a dropped/inserted qualifier ("Wu Tsai Undergraduate
 * Fellowships" vs "Undergraduate Fellowships") counts as the same program
 * (#609) while two distinct award names that merely share a boilerplate
 * suffix ("... Richter Summer Fellowship" vs "... Mellon Senior Research
 * Grant") do not, since neither title's tokens are a subset of the other's.
 * Requires at least 2 shared tokens so a single generic word never matches.
 */
export function isProgramTitleQualifierDrift(titleA: string, titleB: string): boolean {
  const tokensA = new Set(programTitleTokens(titleA));
  const tokensB = new Set(programTitleTokens(titleB));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  if (smaller.size < 2) return false;
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
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

const NAMED_AWARD_PHRASE =
  /\b(?:fellowships?|grants?|scholars?|scholarships?|awards?|prizes?|internships?|assistantships?|programs?)\b/i;

/**
 * Collapses a source-corrupted "X AND Y" title, where a page heading grouped
 * two distinct named awards under one literal all-caps "AND", down to its
 * primary (first) award component (#655).
 *
 * Only fires when every AND-joined component independently reads as a named
 * award phrase, so an ordinary award name that happens to contain an all-caps
 * "AND" is left untouched (the join is part of one award's real name, not a
 * two-award grouping). Titles with no such join are returned unchanged.
 */
export function primaryConcatenatedAwardTitle(title: string): string {
  const raw = String(title || '').trim();
  if (!AND_CONCATENATION_SPLIT.test(raw)) return raw;
  const parts = raw
    .split(AND_CONCATENATION_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return raw;
  if (!parts.every((part) => NAMED_AWARD_PHRASE.test(part))) return raw;
  return parts[0];
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
