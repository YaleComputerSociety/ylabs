/**
 * Which stored description observations the microsite undergrad lane would no
 * longer assert, now that a crawled page must be shown to be about this entity
 * before it may be cited as the entity's description source (#2570).
 *
 * Every reason is a probe of the observation itself - its cited URL, its stored
 * text, the entity it is keyed to - rather than of any earlier repair's plan
 * state, so a re-run re-derives the same verdict instead of going blind once the
 * first pass has written (#2858).
 */
import { isCrawlSeedListingUrl } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import {
  personProfileSourceNamesADifferentPerson,
  type ResearchEntityIdentity,
} from '../scrapers/utils/personProfileEntityMatch';
import { isSourcePageNarrationDescription } from '../utils/researchEntityDescriptionText';

export const UNASSERTABLE_DESCRIPTION_FIELDS = ['fullDescription', 'shortDescription'] as const;

export type UnassertableDescriptionReason =
  | 'source_is_a_crawl_seed_listing'
  | 'source_page_names_another_person'
  | 'text_narrates_the_source_page';

export interface StoredDescriptionObservation {
  field: string;
  value: unknown;
  sourceUrl?: unknown;
}

export function unassertableDescriptionReasons(
  observation: StoredDescriptionObservation,
  entity: ResearchEntityIdentity,
): UnassertableDescriptionReason[] {
  if (!UNASSERTABLE_DESCRIPTION_FIELDS.includes(observation.field as never)) return [];
  const reasons: UnassertableDescriptionReason[] = [];
  if (isCrawlSeedListingUrl(observation.sourceUrl)) {
    reasons.push('source_is_a_crawl_seed_listing');
  }
  if (personProfileSourceNamesADifferentPerson(observation.sourceUrl, entity)) {
    reasons.push('source_page_names_another_person');
  }
  if (isSourcePageNarrationDescription(observation.value)) {
    reasons.push('text_narrates_the_source_page');
  }
  return reasons;
}

export interface StoredDescriptionClear {
  field: string;
  reason: 'text_narrates_the_source_page' | 'provenance_cites_a_disqualified_page';
}

export const SOURCE_DISQUALIFYING_REASONS: readonly UnassertableDescriptionReason[] = [
  'source_is_a_crawl_seed_listing',
  'source_page_names_another_person',
];

/**
 * A stored description field the row should stop carrying: either the text is one
 * the serve gate already refuses, so the row is holding prose no student can see,
 * or the field's provenance cites a page that may not speak for this entity at
 * all.
 *
 * `disqualifiedSourceUrls` must carry ONLY the pages disqualified as sources - a
 * crawl-seed listing, or somebody else's person page. A narration-shaped text is a
 * judgement about that one sentence, not about its page, and the same page is
 * commonly the entity's own correct profile, so passing narration-retired URLs
 * here would clear good prose harvested from a page that is genuinely this
 * entity's.
 */
export function planStoredDescriptionClears(
  entity: Record<string, unknown>,
  disqualifiedSourceUrls: ReadonlySet<string>,
): StoredDescriptionClear[] {
  const clears: StoredDescriptionClear[] = [];
  const provenance = (entity.fieldProvenance || {}) as Record<string, { sourceUrl?: unknown }>;
  for (const field of UNASSERTABLE_DESCRIPTION_FIELDS) {
    const stored = entity[field];
    if (typeof stored !== 'string' || !stored.trim()) continue;
    if (isSourcePageNarrationDescription(stored)) {
      clears.push({ field, reason: 'text_narrates_the_source_page' });
      continue;
    }
    const citedUrl = provenance[field]?.sourceUrl;
    if (
      typeof citedUrl === 'string' &&
      disqualifiedSourceUrls.has(normalizeRetiredSourceUrl(citedUrl))
    ) {
      clears.push({ field, reason: 'provenance_cites_a_disqualified_page' });
    }
  }
  return clears;
}

export function normalizeRetiredSourceUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : '';
}
