/**
 * Shared, pure helpers for scraper implementations.
 *
 * Kept dependency-free (no I/O, no DB, no axios) so they're trivially unit-testable
 * and reusable across any scraper that needs to derive stable keys from messy
 * external data (names, emails, URLs).
 */

/**
 * Lowercase, ASCII-fold (basic), strip diacritics, and replace any run of
 * non-alphanumeric characters with a single dash. Trims leading/trailing dashes.
 *
 * Used to build deterministic entity keys from human-readable strings such as
 * faculty names or research-group names.
 */
export function slugify(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/['\u2018\u2019]s\b/g, '') // drop possessive 's
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * Extract the netid (local-part) from a Yale email address.
 *
 * Returns null if the input is not a Yale email or is malformed. The local-part
 * is lowercased and has any `+tag` suffix stripped. We deliberately *only* trust
 * @yale.edu emails since other domains can collide across institutions.
 */
export function netidFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const cleaned = String(email).trim().toLowerCase().replace(/^mailto:/, '');
  const match = cleaned.match(/^([a-z0-9._-]+)(?:\+[a-z0-9._-]+)?@yale\.edu$/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

/**
 * Normalize a faculty display name: collapse whitespace, strip trailing
 * credential suffixes (", Ph.D.", ", M.D.", etc.), and remove leading honorifics.
 *
 * Returns the cleaned name suitable for slugification or display. Returns an
 * empty string on falsy input.
 */
export function normalizeName(name: string | undefined | null): string {
  if (!name) return '';
  let n = String(name).replace(/\s+/g, ' ').trim();
  // strip leading honorifics
  n = n.replace(/^(prof(\.|essor)?|dr\.?|mr\.?|mrs\.?|ms\.?|mx\.?)\s+/i, '');
  // strip trailing credential clauses after the last comma
  // e.g. "Ronald Breaker, Ph.D." -> "Ronald Breaker"
  n = n.replace(
    /,\s*(ph\.?\s*d\.?|m\.?\s*d\.?|m\.?\s*p\.?\s*h\.?|j\.?\s*d\.?|sc\.?\s*d\.?|d\.?\s*phil\.?|dphil|ed\.?\s*d\.?|m\.?\s*s\.?|m\.?\s*a\.?|m\.?\s*b\.?\s*a\.?|esq\.?)\.?\s*$/i,
    '',
  );
  // strip trailing parenthetical/credential-like trailing tokens
  n = n.trim().replace(/[,;]+$/, '').trim();
  return n;
}

/**
 * Best-effort split of a normalized name into { first, last }.
 *
 * Handles single-word names (returns first only), suffixes like "Jr." / "III"
 * (treats them as part of the last name), and hyphenated last names. This is a
 * heuristic — production user records should rely on authoritative sources
 * (CAS / Yalies) rather than these splits.
 */
export function splitName(name: string): { first: string; last: string } {
  const tokens = normalizeName(name).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: '' };
  // pull off trailing suffix tokens like "Jr.", "Sr.", "II", "III", "IV"
  const suffixRe = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  let lastIdx = tokens.length - 1;
  while (lastIdx > 1 && suffixRe.test(tokens[lastIdx])) lastIdx--;
  const first = tokens.slice(0, lastIdx).join(' ');
  const last = tokens.slice(lastIdx).join(' ');
  return { first, last };
}
