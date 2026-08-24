/**
 * Canonical school slug helpers for the per-school research page (issue #1707).
 *
 * A school slug is the `slugify` form of a canonical OrgUnit school name, the
 * same normalization `orgUnitMatchKey` applies when resolving a scraped school
 * string. Because resolution round-trips through the shared canonicalizer rather
 * than a second hardcoded school list, a `/research/school/<slug>` URL lines up
 * with the `school`/`schools[]` facet values and fails closed on anything that
 * does not resolve to a known SCHOOL/DIVISION OrgUnit.
 */
import { slugify } from '../scrapers/utils/scraperHelpers';

const MAX_SCHOOL_SLUG_LENGTH = 120;

/** Slug form of a canonical school name (`slugify`, capped). */
export function toSchoolSlug(school: string): string {
  return slugify(school).slice(0, MAX_SCHOOL_SLUG_LENGTH).replace(/^-+|-+$/g, '');
}

/**
 * Turn a raw URL slug back into a human-readable query string the school
 * canonicalizer can resolve, or an empty string for anything that is not a
 * plausible slug.
 */
export function schoolSlugToQuery(slug: unknown): string {
  if (typeof slug !== 'string') return '';
  const trimmed = slug.trim();
  if (!trimmed || trimmed.length > MAX_SCHOOL_SLUG_LENGTH) return '';
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) return '';
  return trimmed.replace(/-+/g, ' ').trim();
}
