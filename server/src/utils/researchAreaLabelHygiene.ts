const PROFILE_ROLE_LABEL_SUFFIX_RE = /\s*YSM\s+Researchers?\s*$/;
const TRAILING_SEPARATOR_RE = /[\s,;:]+$/;

const CITATION_TAIL_RE = /\b(?:19|20)\d{2}[a-z]?\)/;
const SCIENTIFIC_LATIN_PREFIX_RE = /^(?:in\s+(?:vivo|vitro|situ|silico)|de\s+novo|ex\s+vivo)\b/i;

const LOWERCASE_FRAGMENT_LEADING_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'from',
  'as',
  'into',
  'onto',
  'upon',
  'about',
  'over',
  'under',
  'between',
  'among',
  'through',
  'has',
  'have',
  'had',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'may',
  'might',
  'should',
  'must',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'he',
  'she',
  'they',
  'we',
  'who',
  'which',
  'what',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]);

export const stripProfileRoleLabelSuffix = (value: string): string => {
  if (typeof value !== 'string') return '';
  const stripped = value.replace(PROFILE_ROLE_LABEL_SUFFIX_RE, '');
  if (stripped === value) return value;
  return stripped.replace(TRAILING_SEPARATOR_RE, '');
};

const NARRATIVE_PROSE_MAX_TOPIC_LENGTH = 120;
const NARRATIVE_PROSE_FIRST_PERSON_RE = /^(?:i|we|our|my)\s/i;
const NARRATIVE_PROSE_SENTENCE_STEM_RE =
  /^(?:the\s+(?:study|development|goal|aim|purpose|focus|analysis|role)\s+of\b|research\s+(?:in|at)\s+(?:the|our|my|his|her|their)\b|research\s+(?:focuses|focus\s+on|is|aims|seeks)\b|studies\s+(?:in|at)\s+(?:the|our|my|his|her|their)\b|treatment\s+with\b|how\s+(?:do|does|to|can|could|would|might|are|is|much|many)\b|wh(?:y|at|ich|ere|en)\b)/i;

export const isNarrativeProseResearchAreaLabel = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const collapsed = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!collapsed) return false;
  if (collapsed.length > NARRATIVE_PROSE_MAX_TOPIC_LENGTH) return true;
  if (NARRATIVE_PROSE_FIRST_PERSON_RE.test(collapsed)) return true;
  return NARRATIVE_PROSE_SENTENCE_STEM_RE.test(collapsed);
};

/**
 * Rejects `researchAreas[]` values that are extraction artifacts, not topics:
 * symbol-only tokens with no letter (e.g. an ellipsis "continue the list"
 * artifact), citation tails (`Wagner 1989b)`), and lowercase prose fragments
 * that open with a function or auxiliary word (`has occupied morphologists`).
 * Scientific-Latin phrases (`in vivo`, `de novo`) legitimately open lowercase
 * and are kept. Shared by the read path (facet + entity chips fail closed) and
 * the write path (materialization drops them) so the same junk class is never
 * stored and never rendered (issue #980).
 */
export const isJunkResearchAreaLabel = (value: string): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (!/\p{L}/u.test(normalized)) return true;
  if (CITATION_TAIL_RE.test(normalized)) return true;
  if (SCIENTIFIC_LATIN_PREFIX_RE.test(normalized)) return false;
  if (/^[a-z]/.test(normalized)) {
    const firstToken = normalized.split(' ')[0].replace(/[^a-z]/g, '');
    if (LOWERCASE_FRAGMENT_LEADING_WORDS.has(firstToken)) return true;
  }
  return false;
};

export const sanitizeResearchAreaLabel = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const stripped = stripProfileRoleLabelSuffix(collapsed).trim();
  if (!stripped) return '';
  if (isNarrativeProseResearchAreaLabel(stripped)) return '';
  if (isJunkResearchAreaLabel(stripped)) return '';
  return stripped;
};

export const sanitizeResearchAreaLabelList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of values) {
    const cleaned = sanitizeResearchAreaLabel(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(cleaned);
  }
  return labels;
};

export const sanitizeResearchAreaFacetDistribution = (
  distribution: Record<string, number> | undefined,
): Record<string, number> | undefined => {
  if (!distribution) return distribution;
  const merged: Record<string, number> = {};
  for (const [rawKey, rawCount] of Object.entries(distribution)) {
    const cleaned = sanitizeResearchAreaLabel(rawKey);
    if (!cleaned) continue;
    const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 0;
    merged[cleaned] = (merged[cleaned] || 0) + count;
  }
  return merged;
};
