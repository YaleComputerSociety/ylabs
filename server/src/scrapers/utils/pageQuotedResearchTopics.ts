import { inflectionalStems, sharesAnInflectionalStem } from '../../utils/groundedCardSynthesis';
import { sanitizeResearchAreaLabel } from '../../utils/researchAreaLabelHygiene';
import { textScanForm } from '../researchAreaCanonicalization';
import { RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME } from '../../models/fieldProvenanceBacking';

export const PAGE_QUOTED_RESEARCH_TOPICS_SOURCE = RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME;

/**
 * Recorded on a derived list's provenance and kept out of the cache key. The filters below
 * re-judge the cached reading on every resolve, so a filter change re-derives at no model cost.
 */
export const PAGE_QUOTED_TOPICS_FILTER_CONTRACT = 'page-quoted-topics-v1';

export const MAX_PAGE_QUOTED_TOPICS = 8;
const MIN_QUOTE_WORDS = 2;
const MAX_QUOTE_WORDS = 40;

export interface QuotedTopic {
  topic: string;
  quote: string;
  url: string;
}

export interface PageQuotedTopicExtraction {
  topics: QuotedTopic[];
  field: QuotedTopic | null;
}

export interface TopicSourcePage {
  url: string;
  text: string;
}

export type TopicRefusalReason =
  | 'quote-page-not-read'
  | 'quote-not-on-page'
  | 'topic-not-on-pages'
  | 'index-heading'
  | 'unusable-label'
  | 'split-fragment'
  | 'acronym-only'
  | 'duplicate'
  | 'generic-word'
  | 'over-limit'
  | 'field-without-topics';

export interface TopicRefusal {
  topic: string;
  reason: TopicRefusalReason;
}

export interface PageQuotedTopicsResult {
  topics: string[];
  mainTopicSourceUrl?: string;
  refusals: TopicRefusal[];
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function quotedTopicFrom(value: unknown): QuotedTopic | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const topic = textOf(record.topic);
  if (!topic) return null;
  return { topic, quote: textOf(record.quote), url: textOf(record.url) };
}

export function parsePageQuotedTopicExtraction(raw: unknown): PageQuotedTopicExtraction {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const topics = Array.isArray(record.topics)
    ? record.topics.map(quotedTopicFrom).filter((topic): topic is QuotedTopic => topic !== null)
    : [];
  return { topics, field: quotedTopicFrom(record.field) };
}

const scanWords = (value: string): string[] =>
  textScanForm(value).trim().split(' ').filter(Boolean);

const comparablePageUrl = (url: string): string =>
  url
    .trim()
    .replace(/#.*$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

export function pageQuotedBy(
  candidate: Pick<QuotedTopic, 'url'>,
  pages: readonly TopicSourcePage[],
): TopicSourcePage | null {
  const wanted = comparablePageUrl(candidate.url);
  if (!wanted) return null;
  return pages.find((page) => comparablePageUrl(page.url) === wanted) ?? null;
}

/**
 * Both sides go through the canonicalizer's scan form, which is padded with spaces, so the
 * quote can only match on whole-word boundaries: "innate immunity" never matches inside
 * "noninnate immunity", and case, punctuation and diacritics are forgiven.
 */
export function quoteAppearsOnPage(quote: string, pageText: string): boolean {
  const wordCount = scanWords(quote).length;
  if (wordCount < MIN_QUOTE_WORDS || wordCount > MAX_QUOTE_WORDS) return false;
  return textScanForm(pageText).includes(textScanForm(quote));
}

const TOPIC_FUNCTION_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'its',
  'of',
  'on',
  'or',
  'the',
  'their',
  'to',
  'with',
]);

const topicContentWords = (topic: string): string[] =>
  scanWords(topic).filter((word) => !TOPIC_FUNCTION_WORDS.has(word));

/**
 * The shared stemmer keeps a final "-as" or "-ae" whole so that "pancreas" and "alumnae"
 * stay intact, which also leaves "gliomas", "carcinomas" and "larvae" unmatched to their
 * singulars. A topic is a noun phrase, so those plurals are read back to "-a" here.
 */
function topicMatchStems(word: string): string[] {
  const stems = [...inflectionalStems(word)];
  if (word.length >= 5 && /[^aeiou]a[se]$/.test(word)) stems.push(word.slice(0, -1));
  return stems;
}

export function pageWordsOf(pages: readonly TopicSourcePage[]): ReadonlySet<string> {
  return new Set(pages.flatMap((page) => scanWords(page.text).flatMap(topicMatchStems)));
}

/**
 * Every content word of the topic shares an inflectional stem with some word of the row's
 * stored page text, any page. Checking against the short quote instead refused topics the
 * page states a sentence away ("glioma" beside a quote about "gliomas and meningiomas"),
 * 69 of 188 on the bench (#5396); the quote itself must still be on its page.
 */
export function topicIsSupportedByPageWords(
  topic: string,
  pageWordStems: ReadonlySet<string>,
): boolean {
  const topicWords = topicContentWords(topic);
  if (topicWords.length === 0) return false;
  return topicWords.every((topicWord) =>
    topicMatchStems(topicWord).some((stem) => pageWordStems.has(stem)),
  );
}

const ADJECTIVAL_HEADING_MODIFIER = /^[A-Za-z-]+(?:al|an|ar|ary|ed|ian|ic|ical|ine|ive|ous)$/;

/**
 * An inverted index heading ("Neoplasms, Prostatic", "Asia, Central") reads back in the
 * order a student types when the part after the comma is a short adjectival modifier.
 * Any other comma-carrying topic is a heading or a list the filter cannot read safely, so
 * it is dropped: the serve path would split it at the comma anyway.
 */
export function uninvertedIndexHeading(topic: string): string | null {
  if (!topic.includes(',')) return topic;
  const match = /^([^,]+),\s*([^,]+)$/.exec(topic);
  if (!match) return null;
  const head = match[1].trim();
  const modifier = match[2].trim();
  const modifierWords = modifier.split(/\s+/);
  if (head.split(/\s+/).length > 3 || modifierWords.length > 2) return null;
  if (!modifierWords.every((word) => ADJECTIVAL_HEADING_MODIFIER.test(word))) return null;
  return `${modifier} ${head}`;
}

const MODIFIER_SUFFIX = /(?:al|ar|ary|ic|ive|ous)$/i;
const MIN_SUFFIX_JUDGED_WORD_LENGTH = 5;

const LONE_MODIFIERS_WITHOUT_A_MODIFIER_SUFFIX = new Set([
  'acute',
  'adult',
  'early',
  'innate',
  'late',
  'mature',
  'novel',
]);

const NOUNS_WITH_A_MODIFIER_SUFFIX = new Set([
  'animal',
  'antarctic',
  'antibiotic',
  'archive',
  'arctic',
  'arithmetic',
  'artery',
  'atlantic',
  'boundary',
  'canal',
  'capital',
  'cathedral',
  'clinic',
  'collective',
  'coral',
  'crystal',
  'documentary',
  'epidemic',
  'estuary',
  'executive',
  'festival',
  'grammar',
  'hospital',
  'incentive',
  'initiative',
  'interval',
  'journal',
  'library',
  'lidar',
  'logic',
  'material',
  'mineral',
  'mosaic',
  'music',
  'narrative',
  'pacific',
  'pandemic',
  'perspective',
  'radar',
  'referral',
  'representative',
  'rhetoric',
  'ritual',
  'sanctuary',
  'scholar',
  'seminar',
  'signal',
  'sonar',
  'sugar',
  'summary',
  'survival',
  'traffic',
  'tribunal',
]);

/**
 * A lone modifier such as "central", "autonomic" or "innate" is what an extraction leaves
 * when it splits "central nervous system" or "innate immunity" at a line break. A single
 * word with a modifier suffix is read as one, except for the listed nouns that share the
 * suffix.
 */
export function isSplitFragmentTopic(topic: string): boolean {
  const words = scanWords(topic);
  if (words.length !== 1) return false;
  const [word] = words;
  if (LONE_MODIFIERS_WITHOUT_A_MODIFIER_SUFFIX.has(word)) return true;
  if (word.length < MIN_SUFFIX_JUDGED_WORD_LENGTH) return false;
  return MODIFIER_SUFFIX.test(word) && !NOUNS_WITH_A_MODIFIER_SUFFIX.has(word);
}

const ACRONYM_ONLY_TOPIC = /^[A-Z][A-Z0-9-]*[A-Z0-9]s?$/;

export const STUDENT_SEARCHED_ACRONYMS: ReadonlySet<string> = new Set([
  'ADHD',
  'AI',
  'COVID',
  'COVID-19',
  'CRISPR',
  'DNA',
  'HIV',
  'MRI',
  'OCD',
  'PTSD',
  'RNA',
]);

export function isUnsearchedAcronymTopic(topic: string): boolean {
  const trimmed = topic.trim();
  if (!ACRONYM_ONLY_TOPIC.test(trimmed)) return false;
  const singular = trimmed.replace(/s$/, '');
  return !STUDENT_SEARCHED_ACRONYMS.has(singular);
}

function isCoveredByAMoreSpecificTopic(topic: string, others: readonly string[]): boolean {
  const words = topicContentWords(topic);
  if (words.length !== 1) return false;
  return others.some((other) => {
    if (other === topic) return false;
    const otherWords = topicContentWords(other);
    return (
      otherWords.length > 1 &&
      otherWords.some((otherWord) => sharesAnInflectionalStem(otherWord, words[0]))
    );
  });
}

interface AdmittedTopic {
  label: string;
  url: string;
}

const dedupeKey = (label: string): string => textScanForm(label).trim();

function admitQuotedTopic(
  candidate: QuotedTopic,
  pages: readonly TopicSourcePage[],
  pageWords: ReadonlySet<string> | null,
  refuse: (reason: TopicRefusalReason) => null,
): AdmittedTopic | null {
  const page = pageQuotedBy(candidate, pages);
  if (!page) return refuse('quote-page-not-read');
  if (!quoteAppearsOnPage(candidate.quote, page.text)) return refuse('quote-not-on-page');
  if (pageWords && !topicIsSupportedByPageWords(candidate.topic, pageWords)) {
    return refuse('topic-not-on-pages');
  }
  const uninverted = uninvertedIndexHeading(candidate.topic);
  if (uninverted === null) return refuse('index-heading');
  const label = sanitizeResearchAreaLabel(uninverted);
  if (!label) return refuse('unusable-label');
  if (isSplitFragmentTopic(label)) return refuse('split-fragment');
  if (isUnsearchedAcronymTopic(label)) return refuse('acronym-only');
  return { label, url: page.url };
}

/**
 * The research-area list a model's quoted topics support, in the model's order: the main
 * subject first, then the other topics, then exactly one field topic when the field
 * survives. A topic whose quote is not on the page it names, or whose words the stored
 * pages do not carry, is dropped rather than repaired; the field topic needs only its quote,
 * because a discipline name is often the page's framing rather than its wording. A list in which only the field
 * survives is no list, so it returns no topics, as it does when nothing survives.
 */
export function derivePageQuotedResearchTopics(
  extraction: PageQuotedTopicExtraction,
  pages: readonly TopicSourcePage[],
): PageQuotedTopicsResult {
  const refusals: TopicRefusal[] = [];
  const pageWords = pageWordsOf(pages);
  const admitWith =
    (words: ReadonlySet<string> | null) =>
    (candidate: QuotedTopic): AdmittedTopic | null =>
      admitQuotedTopic(candidate, pages, words, (reason) => {
        refusals.push({ topic: candidate.topic, reason });
        return null;
      });
  const admit = admitWith(pageWords);

  const field = extraction.field ? admitWith(null)(extraction.field) : null;
  const seen = new Set<string>(field ? [dedupeKey(field.label)] : []);
  const unique: AdmittedTopic[] = [];
  for (const candidate of extraction.topics) {
    const admitted = admit(candidate);
    if (!admitted) continue;
    const key = dedupeKey(admitted.label);
    if (seen.has(key)) {
      refusals.push({ topic: candidate.topic, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    unique.push(admitted);
  }

  const allLabels = [...unique.map((topic) => topic.label), ...(field ? [field.label] : [])];
  const specific = unique.filter((topic) => {
    if (!isCoveredByAMoreSpecificTopic(topic.label, allLabels)) return true;
    refusals.push({ topic: topic.label, reason: 'generic-word' });
    return false;
  });
  for (const overflow of specific.slice(MAX_PAGE_QUOTED_TOPICS)) {
    refusals.push({ topic: overflow.label, reason: 'over-limit' });
  }
  const kept = specific.slice(0, MAX_PAGE_QUOTED_TOPICS);

  if (kept.length === 0) {
    if (field) refusals.push({ topic: field.label, reason: 'field-without-topics' });
    return { topics: [], refusals };
  }
  return {
    topics: [...kept.map((topic) => topic.label), ...(field ? [field.label] : [])],
    mainTopicSourceUrl: kept[0].url,
    refusals,
  };
}
