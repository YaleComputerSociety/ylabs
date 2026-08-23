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
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : String(value ?? '').replace(/\s+/g, ' ').trim();

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
