/**
 * Client mirror of the server research-taxonomy slug helper
 * (`server/src/utils/researchAreaSlug.ts`), used to build canonical links to the
 * per-area (`/research/area/:slug`) and per-field (`/research/field/:slug`)
 * pages from the "Browse by field" entry point and the `/research` area facet.
 *
 * The slug spelling must stay identical to the server so a generated link
 * resolves back to the canonical taxonomy value; changing one requires changing
 * the other.
 */
const MAX_RESEARCH_TAXONOMY_SLUG_LENGTH = 120;

export const toResearchTaxonomySlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_RESEARCH_TAXONOMY_SLUG_LENGTH)
    .replace(/-+$/g, '');

export const researchAreaPath = (areaName: string): string =>
  `/research/area/${toResearchTaxonomySlug(areaName)}`;

export const researchFieldPath = (fieldName: string): string =>
  `/research/field/${toResearchTaxonomySlug(fieldName)}`;
