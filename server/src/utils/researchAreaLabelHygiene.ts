const PROFILE_ROLE_LABEL_SUFFIX_RE = /\s*YSM\s+Researchers?\s*$/;
const TRAILING_SEPARATOR_RE = /[\s,;:]+$/;

export const stripProfileRoleLabelSuffix = (value: string): string => {
  if (typeof value !== 'string') return '';
  const stripped = value.replace(PROFILE_ROLE_LABEL_SUFFIX_RE, '');
  if (stripped === value) return value;
  return stripped.replace(TRAILING_SEPARATOR_RE, '');
};

/**
 * Words whose own trailing period is part of the word, so a chip ending in one
 * has not ended a sentence (#2553). A blunt "ends with a period" rule strips or
 * refuses these: "Bisulfite seq.", "Lynch et al.", "Centers for Disease Control
 * and Prevention, U.S.".
 */
const CHIP_TERMINAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'al',
  'approx',
  'cf',
  'co',
  'dept',
  'ed',
  'eds',
  'eg',
  'est',
  'etc',
  'fig',
  'figs',
  'ie',
  'inc',
  'jr',
  'llc',
  'ltd',
  'mt',
  'no',
  'nos',
  'pp',
  'prof',
  'resp',
  'seq',
  'sp',
  'spp',
  'sr',
  'st',
  'univ',
  'viz',
  'vol',
  'vols',
  'vs',
]);

const CHIP_TERMINAL_WORD_MIN_LENGTH = 3;
const CHIP_TERMINAL_SENTENCE_STOP_RE = /([A-Za-z][A-Za-z'’-]*)(["'’)\]]*)([.!?])(["'’)\]]*)$/;

/**
 * A chip has ended a sentence only when a whole word sits immediately before the
 * terminal punctuation. Anything else there is an abbreviation ("U.S.", "et
 * al."), an initial ("Papademetris X."), or bibliographic numbering ("59.1
 * (Spring 2013) 30-41."), and none of those is a sentence (#2553).
 */
export const endsWithChipSentenceStop = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const match = CHIP_TERMINAL_SENTENCE_STOP_RE.exec(value.trim());
  if (!match) return false;
  const word = match[1];
  if (word.length < CHIP_TERMINAL_WORD_MIN_LENGTH) return false;
  return !CHIP_TERMINAL_ABBREVIATIONS.has(word.toLowerCase().replace(/[^a-z]/g, ''));
};

const CHIP_CLAUSE_MIN_WORDS = 9;
const CHIP_TERMINAL_PUNCTUATION_RE = /[.!?](["'’)\]]*)$/;

const chipWordCount = (value: string): number => value.split(/\s+/).filter(Boolean).length;

/**
 * A chip that both closes with terminal punctuation and runs to clause length is
 * prose captured as a tag - a page's own section caption, an aim written out
 * longhand - and is refused rather than trimmed (#2553).
 *
 * Neither half refuses alone. Terminal punctuation alone is how a source's
 * bulleted research-interest list punctuates a perfectly good topic, and clause
 * length alone is the ordinary shape of a concrete technique ("human induced
 * pluripotent stem cell (iPSC) derived neuronal models").
 *
 * The abbreviation exemption deliberately does NOT apply here, only to the trim:
 * a clause-length chip is a sentence whatever its last token, and two served
 * method sentences ended "(blood, stool, CSF, etc.)." and "in the US.".
 */
export const isSentenceShapedChip = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const collapsed = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!collapsed) return false;
  if (!CHIP_TERMINAL_PUNCTUATION_RE.test(collapsed)) return false;
  return chipWordCount(collapsed) >= CHIP_CLAUSE_MIN_WORDS;
};

/**
 * Remove the stray sentence stop a source's punctuated list leaves on a
 * tag-shaped chip, so "Polymorphic Drug Metabolizing Enzymes." reads as the
 * topic it is instead of being discarded by the serve-time prose filter (#2553).
 */
export const stripChipSentenceStop = (value: string): string => {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!endsWithChipSentenceStop(collapsed)) return collapsed;
  return collapsed.replace(CHIP_TERMINAL_SENTENCE_STOP_RE, '$1$2$4').trim();
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

/**
 * A label so broad it distinguishes nothing, and so wrong for all three jobs a topic does:
 * it groups thousands of unlike rows as a facet, tells a student nothing about fit as
 * guidance, and matches everything as a search term. "Best fit for: Diseases" is the
 * clearest case.
 *
 * Deliberately a closed list of whole labels rather than a prefix or word rule. The
 * qualified forms are all legitimate topics - "Infectious Diseases", "Medical Education",
 * "Cancer Therapeutics" - so anything matching a stem would take the good ones with it.
 * Measured on Development: 12 labels over 80 served chip mentions, against 6,519 distinct
 * chips, and only 2 rows are left with no topic at all.
 *
 * A single-word umbrella is not automatically empty either, which is why this is a list and
 * not a word count: "Neuroscience", "Chemistry" and "Immunology" are single words and are
 * the most useful chips in the corpus.
 */
const CONTENTLESS_RESEARCH_AREA_LABELS: ReadonlySet<string> = new Set([
  'diseases',
  'education',
  'engineering',
  'evaluation',
  'health',
  'humanities',
  'management',
  'medicine',
  'methods',
  'policy',
  'research',
  'science',
  'sciences',
  'technology',
  'therapeutics',
]);

export const isContentlessResearchAreaLabel = (value: unknown): boolean =>
  typeof value === 'string' &&
  CONTENTLESS_RESEARCH_AREA_LABELS.has(value.replace(/\s+/g, ' ').trim().toLowerCase());

export const sanitizeResearchAreaLabel = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const stripped = stripProfileRoleLabelSuffix(collapsed).trim();
  if (!stripped) return '';
  if (isSentenceShapedChip(stripped)) return '';
  const trimmed = stripChipSentenceStop(stripped);
  if (!trimmed) return '';
  if (isNarrativeProseResearchAreaLabel(trimmed)) return '';
  if (isCorruptResearchAreaLabel(trimmed)) return '';
  if (isContentlessResearchAreaLabel(trimmed)) return '';
  return trimmed;
};

const NON_METHOD_ACTIVITY_HEADS = [
  'teaching',
  'teaches',
  'lecturing',
  'lectures',
  'lecture series',
  'seminars',
  'workshops',
  'presentations',
  'training',
  'trainings',
  'training programs',
  'consultation',
  'consultations',
  'consulting',
  'mentoring',
  'mentorship',
  'outreach',
  'outreach programs',
  'education',
  'courses',
  'patient care',
  'clinical care',
];

const NON_METHOD_ACTIVITY_MODIFIERS = [
  'annual',
  'classroom',
  'clinical',
  'community',
  'community based',
  'didactic',
  'educational',
  'graduate',
  'interactive',
  'interdisciplinary',
  'medical',
  'monthly',
  'on site',
  'peer',
  'peer to peer',
  'professional',
  'public',
  'research',
  'scientific',
  'site',
  'undergraduate',
  'user',
  'weekly',
];

const PUBLICATION_LABEL_MODIFIERS = [
  'academic',
  'peer reviewed',
  'recent',
  'scholarly',
  'selected',
];

const PUBLICATION_LABEL_HEADS = [
  'abstracts',
  'articles',
  'book chapters',
  'chapters',
  'commentaries',
  'commentary',
  'original research',
  'publications',
  'research',
  'reviews',
];

const longestFirstAlternation = (phrases: readonly string[]): string =>
  [...phrases].sort((a, b) => b.length - a.length).join('|');

const ACTIVITY_LABEL = `(?:(?:${longestFirstAlternation(NON_METHOD_ACTIVITY_MODIFIERS)}) )?(?:${longestFirstAlternation(NON_METHOD_ACTIVITY_HEADS)})`;
const ACTIVITY_LABEL_RE = new RegExp(`^${ACTIVITY_LABEL}(?: and ${ACTIVITY_LABEL})?$`);
const PUBLICATION_LABEL_RE = new RegExp(
  `^(?:(?:${longestFirstAlternation(PUBLICATION_LABEL_MODIFIERS)}) (?:${longestFirstAlternation(PUBLICATION_LABEL_HEADS)})` +
    '|publications|articles|commentaries|reviews|citations?|references|doi|pmid|pmcid' +
    '|peer reviewed (?:original research|publications|articles|reviews)(?: .+)?' +
    '|publications? (?:in|of) (?:(?:academic|scholarly|peer reviewed) )?(?:journals|articles))$',
);

const methodLabelWords = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u2010-\u2015-]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * An activity the person does (teaching, consultation, outreach) or a publication-list
 * heading names no technique, so it is not a method (#4049). Only the bare head, or the head
 * after a generic modifier, is refused: a modifier that names a technique keeps the chip, which
 * is what separates "simulation training", "rater training" and "systematic reviews" from
 * "clinical training" and "reviews".
 */
export const isActivityOrPublicationLabel = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const words = methodLabelWords(value);
  return ACTIVITY_LABEL_RE.test(words) || PUBLICATION_LABEL_RE.test(words);
};

/**
 * `methods` renders through the same chip pill as `researchAreas` but shares
 * none of its vocabulary, which is how a page's own prose reached students as a
 * "Methods and techniques" tag (#2553). Only the shape rules transfer: a method
 * is legitimately a longer, more descriptive phrase than a topic, so the
 * research-area denoiser's word ceiling and prose-lead-in rules would refuse 152
 * concrete techniques on 74 served cards.
 */
export const sanitizeMethodChipLabel = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (isSentenceShapedChip(collapsed)) return '';
  const trimmed = stripChipSentenceStop(collapsed);
  if (isActivityOrPublicationLabel(trimmed)) return '';
  return trimmed;
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
