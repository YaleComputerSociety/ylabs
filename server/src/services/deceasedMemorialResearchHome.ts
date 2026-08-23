const EARLIEST_PLAUSIBLE_BIRTH_YEAR = 1850;
const LATEST_PLAUSIBLE_DEATH_YEAR = 2100;

const YEAR = String.raw`(1[89]\d{2}|20\d{2})`;
const DASH = String.raw`[-‐‑‒–—]`;

const SLUG_LIFESPAN_RE = new RegExp(`${DASH}${YEAR}${DASH}${YEAR}(?:/|$)`);
const PAREN_LIFESPAN_RE = new RegExp(`\\(\\s*${YEAR}\\s*${DASH}\\s*${YEAR}\\s*\\)`);
const NAME_LIFESPAN_RE = new RegExp(`(?:^|\\s)${YEAR}\\s*${DASH}\\s*${YEAR}(?:\\s|$)`);
const MEMORIAL_PHRASE_RE = /\b(?:in memoriam|in memory of|the late|passed away|posthumous(?:ly)?)\b/i;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const collectStrings = (...values: unknown[]): string[] =>
  values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(textValue)
    .filter(Boolean);

const isPlausibleLifespan = (birth: string, death: string): boolean => {
  const birthYear = Number(birth);
  const deathYear = Number(death);
  return (
    birthYear >= EARLIEST_PLAUSIBLE_BIRTH_YEAR &&
    deathYear <= LATEST_PLAUSIBLE_DEATH_YEAR &&
    birthYear < deathYear
  );
};

const matchesPlausibleLifespan = (value: string, pattern: RegExp): boolean => {
  const match = value.match(pattern);
  return Boolean(match && isPlausibleLifespan(match[1], match[2]));
};

/**
 * A deceased-PI in-memoriam/obituary page that was materialized as a live
 * research home should not be surfaced to students as an active reach-out
 * opportunity (#982). Detection is deliberately high precision so it never
 * suppresses a living faculty member: it fires only on birth-death lifespan
 * shapes that cannot be ordinary career date ranges (a lifespan glued into a
 * URL slug tail or a person's name, a parenthetical birth-death pair, or an
 * explicit memorial phrase), never on a bare mid-sentence range like
 * "Professor of Government from 1993-2000".
 */
export function isDeceasedMemorialResearchHome(entity: Record<string, any>): boolean {
  if (!entity || typeof entity !== 'object') return false;

  const sourceSlugs = collectStrings(entity.sourceUrls, entity.websiteUrl, entity.website);
  if (sourceSlugs.some((slug) => matchesPlausibleLifespan(slug, SLUG_LIFESPAN_RE))) return true;

  const names = collectStrings(entity.leadProfessorNames, entity.professorNames);
  if (names.some((name) => matchesPlausibleLifespan(name, NAME_LIFESPAN_RE))) return true;

  const descriptions = collectStrings(
    entity.fullDescription,
    entity.shortDescription,
    entity.profileSynthesisDescription,
  );
  if (descriptions.some((text) => matchesPlausibleLifespan(text, PAREN_LIFESPAN_RE))) return true;
  if (descriptions.some((text) => MEMORIAL_PHRASE_RE.test(text))) return true;

  return false;
}
