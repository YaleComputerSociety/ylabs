/**
 * Word-grounding for extracted research methods/techniques.
 *
 * Method terms are LLM-extracted, so they must be checked against the source
 * text before they are trusted: a candidate survives only when every one of its
 * significant words appears in the text it was extracted from. This blocks
 * fabricated or hallucinated techniques while tolerating light reordering and
 * stopword differences, and it rejects content-free phrases ("research
 * methods", "various techniques") that carry no concrete technique.
 */
const METHOD_TOKEN_STOPWORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'using',
  'based',
  'via',
  'from',
  'into',
  'onto',
  'per',
  'this',
  'that',
  'these',
  'those',
  'their',
  'our',
  'its',
  'research',
  'study',
  'studies',
  'method',
  'methods',
  'technique',
  'techniques',
  'approach',
  'approaches',
  'various',
  'including',
  'such',
  'other',
  'general',
]);

const CONTENT_FREE_METHOD_PHRASES = new Set([
  'research',
  'research methods',
  'methods',
  'techniques',
  'methods and techniques',
  'various methods',
  'various techniques',
  'analysis',
  'data analysis',
  'experiments',
  'experimental methods',
  'approaches',
  'other methods',
]);

const significantMethodTokens = (phrase: string): string[] =>
  (phrase.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (token) => token.length >= 3 && !METHOD_TOKEN_STOPWORDS.has(token),
  );

const normalizeGroundingText = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ');

export function isMethodGroundedInText(method: string, sourceText: string): boolean {
  const normalizedMethod = method.trim().replace(/\s+/g, ' ');
  if (!normalizedMethod) return false;
  if (CONTENT_FREE_METHOD_PHRASES.has(normalizedMethod.toLowerCase())) return false;
  const tokens = significantMethodTokens(normalizedMethod);
  if (tokens.length === 0) return false;
  const haystack = normalizeGroundingText(sourceText);
  return tokens.every((token) => haystack.includes(token));
}

export function groundMethods(methods: unknown, sourceText: string, limit = 12): string[] {
  if (!Array.isArray(methods)) return [];
  const seen = new Set<string>();
  const grounded: string[] = [];
  for (const raw of methods) {
    if (typeof raw !== 'string') continue;
    const method = raw.trim().replace(/\s+/g, ' ');
    if (!method) continue;
    const dedupeKey = method.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    if (!isMethodGroundedInText(method, sourceText)) continue;
    seen.add(dedupeKey);
    grounded.push(method);
    if (grounded.length >= limit) break;
  }
  return grounded;
}
