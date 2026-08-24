/**
 * Canonical research-area and research-field slug helpers for the per-area and
 * per-field research pages (issue #1696).
 *
 * Slugs are derived from the canonical `ResearchArea` name and the top-level
 * `ResearchField` enum value, so a `/research/area/<slug>` or
 * `/research/field/<slug>` URL is driven by the existing taxonomy rather than a
 * third free-text spelling. Reverse resolution slugifies every taxonomy value
 * and matches the requested slug against it, which keeps the destination bound
 * to the canonical value the `/research` area facet also reports.
 */
const MAX_RESEARCH_TAXONOMY_SLUG_LENGTH = 120;

export function toResearchTaxonomySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_RESEARCH_TAXONOMY_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * Normalize a raw URL slug to the canonical slug spelling, or null when it is
 * not a plausible slug. Collapses repeated hyphens so `machine--learning`
 * resolves to the same value as `machine-learning`.
 */
export function normalizeResearchTaxonomySlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_RESEARCH_TAXONOMY_SLUG_LENGTH) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) return null;
  const normalized = trimmed
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || null;
}
