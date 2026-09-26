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
  | 'source_host_is_another_institution'
  | 'text_narrates_the_source_page';

/**
 * A ccTLD university cannot be told from a personal site by its string: a Yale
 * professor's own `barbarabiasi.com` and McGill's `ostry.lab.mcgill.ca` are both
 * non-Yale, non-`.edu` hosts. `.edu`, `.ac.<cc>` and `.edu.<cc>` are
 * degree-granting by construction, so they need no list; every other institutional
 * domain is enumerated, and this list grows by measuring a citation the corpus
 * actually holds rather than by guessing at world universities (#1750).
 */
const NON_EDU_INSTITUTIONAL_DOMAINS: readonly string[] = ['mcgill.ca'];

/**
 * Hosts that end in `.edu` and are nonetheless not a university speaking about its
 * own research. `academia.edu` is a company that happens to own a `.edu` domain, and
 * `muse.jhu.edu` is a journal-publishing platform: an article abstract on it is a
 * different defect from another university's faculty page, and folding the two
 * together would make this reason state the wrong thing about the row (#1750).
 */
const NON_INSTITUTIONAL_EDU_HOSTS: readonly string[] = ['academia.edu', 'muse.jhu.edu'];

const hostnameOfSourceUrl = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const isYaleHost = (host: string): boolean =>
  host === 'yale.edu' || host.endsWith('.yale.edu') || host.endsWith('.yale.org');

/**
 * Whether a cited page is served by a degree-granting institution other than Yale.
 *
 * Another university's own page speaks for that university's entity, never for a
 * Yale row, so it is disqualified as a source rather than merely doubted. This is a
 * probe of the cited host and not of the prose: a text-pattern rule was measured
 * first and rejected, because "was a faculty member at Cornell University" is a
 * biography every real Yale row is entitled to.
 */
export function sourceHostIsAnotherInstitution(sourceUrl: unknown): boolean {
  const host = hostnameOfSourceUrl(sourceUrl);
  if (!host || isYaleHost(host)) return false;
  if (
    NON_INSTITUTIONAL_EDU_HOSTS.some(
      (excluded) => host === excluded || host.endsWith(`.${excluded}`),
    )
  ) {
    return false;
  }
  if (/\.edu$/.test(host) || /\.ac\.[a-z]{2,3}$/.test(host) || /\.edu\.[a-z]{2}$/.test(host)) {
    return true;
  }
  return NON_EDU_INSTITUTIONAL_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

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
  if (sourceHostIsAnotherInstitution(observation.sourceUrl)) {
    reasons.push('source_host_is_another_institution');
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
  'source_host_is_another_institution',
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
