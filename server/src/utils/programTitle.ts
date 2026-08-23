/**
 * Normalized identity key for a program/fellowship title.
 *
 * Punctuation-, case-, and whitespace-insensitive so a re-scrape whose title
 * drifted slightly (curly vs straight quotes, added qualifier) still resolves
 * to the same record instead of minting a duplicate (#609).
 */
export function normalizedProgramTitleKey(title: string): string {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
