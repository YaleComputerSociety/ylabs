/**
 * School name slug helper for linking into the canonical per-school research
 * page (issue #1707).
 *
 * Mirrors the server `slugify` (which `orgUnitMatchKey` and the server
 * `toSchoolSlug` share) so a `/research/school/<slug>` link built on the client
 * resolves to the same canonical school the server buckets under. Server-side
 * resolution is match-key based, so a minor slug difference still resolves; this
 * only has to produce the canonical form for the common case.
 */
const MAX_SCHOOL_SLUG_LENGTH = 100;

export const getSchoolSlug = (school: string): string =>
  (school || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019]s\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SCHOOL_SLUG_LENGTH);
