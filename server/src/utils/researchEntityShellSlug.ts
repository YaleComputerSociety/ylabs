import { SLUG_MAX_LENGTH, slugify } from '../scrapers/utils/scraperHelpers';

export const FACULTY_RESEARCH_AREA_SLUG_PREFIX = 'faculty-research-area-';

export function isAreaShellSlug(slug: string | undefined): boolean {
  return (slug || '').toLowerCase().startsWith(FACULTY_RESEARCH_AREA_SLUG_PREFIX);
}

export function isFundingShellSlug(slug: string | undefined): boolean {
  const value = (slug || '').toLowerCase();
  return (
    value.startsWith('nih-pi-') ||
    value.startsWith('nsf-pi-') ||
    value.startsWith('federal-pi-') ||
    value.startsWith('doe-pi-')
  );
}

export function isLowTrustAreaShellSlug(slug: string | undefined): boolean {
  return isAreaShellSlug(slug) || isFundingShellSlug(slug);
}

export function facultyResearchAreaSlugForPersonName(personName: string): string {
  const personSlug = slugify(personName);
  return personSlug ? `${FACULTY_RESEARCH_AREA_SLUG_PREFIX}${personSlug}`.slice(0, SLUG_MAX_LENGTH) : '';
}
