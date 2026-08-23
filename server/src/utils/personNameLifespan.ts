/**
 * Guards a rendered person name against a birth-death lifespan token glued onto
 * the name fields. Some faculty-directory pages document a deceased/emeritus
 * professor and encode the lifespan in the page slug/title
 * (e.g. `.../people/pierre-demarque-1932-2025`). The scraper can carry those
 * trailing year digits into `lname`/`displayName`, so the name renders as
 * "Pierre Demarque 1932-2025" wherever a member/lead name is shown (issue #982).
 *
 * A person name never legitimately ends in a `YYYY-YYYY` birth-death range, so
 * stripping a trailing lifespan token is safe. Career date ranges
 * ("Professor 1993-2000") live in title/bio text, not in the name field, so
 * this guard is scoped to name fields only and does not touch prose.
 */

const LIFESPAN_YEAR = '(?:1[89]\\d{2}|20\\d{2})';

const TRAILING_LIFESPAN_RE = new RegExp(
  `[\\s,]*\\(?\\s*${LIFESPAN_YEAR}\\s*[-‐‒–—―]\\s*${LIFESPAN_YEAR}\\s*\\)?\\s*$`,
);

export function stripPersonNameLifespanSuffix(value: string | null | undefined): string {
  const name = typeof value === 'string' ? value : '';
  const stripped = name.replace(TRAILING_LIFESPAN_RE, '').trim();
  return stripped.length > 0 ? stripped : name.trim();
}

export function personNameHasLifespanSuffix(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  return stripPersonNameLifespanSuffix(value) !== value.trim();
}
