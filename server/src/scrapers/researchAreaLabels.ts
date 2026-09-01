export const RESEARCH_SECTION_LABELS = new Set([
  'research area',
  'research areas',
  'research interest',
  'research interests',
  'field of interest',
  'fields of interest',
  'field of study',
  'fields of study',
  'area of interest',
  'areas of interest',
  'topic',
  'topics',
]);

export const RESEARCH_SECTION_LABEL_PREFIX =
  /^(?:research\s+areas?|research\s+interests?|fields?\s+of\s+(?:study|interest)|areas?\s+of\s+interest|topics?)\s*:?\s+/i;

const normalizeLabelText = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();

export function stripResearchSectionLabelPrefix(value: unknown): string {
  return normalizeLabelText(value).replace(RESEARCH_SECTION_LABEL_PREFIX, '');
}

export function isResearchSectionLabel(value: unknown): boolean {
  const key = normalizeLabelText(value)
    .replace(/[:\s]+$/g, '')
    .toLowerCase();
  return key.length === 0 || RESEARCH_SECTION_LABELS.has(key);
}

export function isProseNotTopicPhrase(value: unknown): boolean {
  const text = normalizeLabelText(value);
  if (!text) return true;
  if (text.length > 80) return true;
  if (text.split(/\s+/).filter(Boolean).length > 8) return true;
  return /[.!?]\s+[A-Za-z]/.test(text);
}

export function isFullProseParagraph(value: unknown): boolean {
  const text = normalizeLabelText(value);
  if (!text) return false;
  if (text.split(/\s+/).filter(Boolean).length > 20) return true;
  return /[.!?]\s+[A-Za-z]/.test(text);
}

const PAGE_SECTION_HEADING_PATTERNS = [
  /^selected\s+(?:presentations?|publications?|articles?|media|press|talks?)\b/i,
  /^(?:in\s+the\s+)?news$/i,
  /^publications?$/i,
  /^presentations?$/i,
  /^media(?:\s+coverage)?$/i,
  /^press$/i,
  /^events?$/i,
  /^awards?(?:\s*(?:&|and)\s*honors?)?$/i,
  /for\s+a\s+general\s+audience$/i,
];

/**
 * A department-profile section heading ("Selected Presentations and Articles
 * for a General Audience", "In the News") is short and phrase-shaped enough
 * to slip past isProseNotTopicPhrase's word-count/punctuation heuristics, but
 * it is page furniture, not a research topic (#1678).
 */
export function isPageSectionHeadingPhrase(value: unknown): boolean {
  const text = normalizeLabelText(value);
  if (!text) return false;
  return PAGE_SECTION_HEADING_PATTERNS.some((pattern) => pattern.test(text));
}
