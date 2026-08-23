const PROFILE_ROLE_LABEL_SUFFIX_RE = /\s*YSM\s+Researchers?\s*$/;
const TRAILING_SEPARATOR_RE = /[\s,;:]+$/;

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

const CONTAINS_LETTER_RE = /[A-Za-z]/;
const CITATION_AUTHOR_YEAR_RE = /\b(?:18|19|20)\d{2}[a-z]\b/;
const RESEARCH_AREA_LABEL_LEAK_RE =
  /^research\s+areas?\b\s*(?::|includes?\b|included\b|are\b|comprises?\b|encompass(?:es)?\b|of\b)/i;
const SENTENCE_CLAUSE_VERB_LEAD_RE =
  /^(?:has|have|had|is|are|was|were|be|been|being|do|does|did)\b/i;
const NUMBER_WORD_PHRASE_RE =
  /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|and|or|to|through|[\s-])+$/i;

const hasUnbalancedClosingParen = (value: string): boolean =>
  value.includes(')') && !value.includes('(');

const isLowercaseSentenceFragment = (value: string): boolean => {
  if (!/^[a-z]/.test(value)) return false;
  return SENTENCE_CLAUSE_VERB_LEAD_RE.test(value) || NUMBER_WORD_PHRASE_RE.test(value);
};

export const isCorruptResearchAreaLabel = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const collapsed = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!collapsed) return false;
  if (!CONTAINS_LETTER_RE.test(collapsed)) return true;
  if (RESEARCH_AREA_LABEL_LEAK_RE.test(collapsed)) return true;
  if (hasUnbalancedClosingParen(collapsed) || CITATION_AUTHOR_YEAR_RE.test(collapsed)) return true;
  return isLowercaseSentenceFragment(collapsed);
};

export const sanitizeResearchAreaLabel = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const stripped = stripProfileRoleLabelSuffix(collapsed).trim();
  if (!stripped) return '';
  if (isNarrativeProseResearchAreaLabel(stripped)) return '';
  if (isCorruptResearchAreaLabel(stripped)) return '';
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
