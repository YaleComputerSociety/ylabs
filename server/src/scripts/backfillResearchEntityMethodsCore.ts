export const RESEARCH_HOME_METHODS_ENTITY_TYPES = new Set<string>([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'INDIVIDUAL_RESEARCH',
  'CENTER',
  'INSTITUTE',
  'GROUP',
  'CORE_FACILITY',
]);

export interface SourceLinkHealthEntry {
  url?: string;
  healthStatus?: string;
  httpStatusCode?: number;
}

export interface MethodsBackfillCandidateDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  archived?: boolean;
  studentVisibilityTier?: string;
  methods?: unknown;
  fullDescription?: unknown;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  sourceLinkHealth?: SourceLinkHealthEntry[];
  manuallyLockedFields?: string[];
}

const VISIBLE_TIERS = new Set(['student_ready', 'directory_backed']);

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

const hasNonEmptyMethods = (value: unknown): boolean =>
  Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim().length > 0);

const isHttpUrl = (url: unknown): url is string =>
  typeof url === 'string' && /^https?:\/\//i.test(url.trim());

const normalizeUrlKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

function isUrlKnownUnavailable(
  url: string,
  health: SourceLinkHealthEntry[] | undefined,
): boolean {
  if (!Array.isArray(health) || health.length === 0) return false;
  const key = normalizeUrlKey(url);
  return health.some(
    (entry) =>
      typeof entry?.url === 'string' &&
      normalizeUrlKey(entry.url) === key &&
      (entry.healthStatus === 'UNAVAILABLE' ||
        (typeof entry.httpStatusCode === 'number' && entry.httpStatusCode >= 400)),
  );
}

export function fetchablePageUrls(doc: MethodsBackfillCandidateDoc): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of [doc.websiteUrl, doc.website, ...(doc.sourceUrls || [])]) {
    if (!isHttpUrl(raw)) continue;
    const url = raw.trim();
    const key = normalizeUrlKey(url);
    if (seen.has(key)) continue;
    if (isUrlKnownUnavailable(url, doc.sourceLinkHealth)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

export function isMethodsBackfillCandidate(doc: MethodsBackfillCandidateDoc): boolean {
  if (doc.archived === true) return false;
  if (!doc.studentVisibilityTier || !VISIBLE_TIERS.has(doc.studentVisibilityTier)) return false;
  if (typeof doc.entityType !== 'string' || !RESEARCH_HOME_METHODS_ENTITY_TYPES.has(doc.entityType)) {
    return false;
  }
  if (hasNonEmptyMethods(doc.methods)) return false;
  if ((doc.manuallyLockedFields || []).includes('methods')) return false;
  return true;
}

export function selectMethodsBackfillTargets(
  docs: MethodsBackfillCandidateDoc[],
): MethodsBackfillCandidateDoc[] {
  return docs.filter(isMethodsBackfillCandidate);
}

export function hasFetchablePageSource(doc: MethodsBackfillCandidateDoc): boolean {
  return fetchablePageUrls(doc).length > 0;
}

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

export function parseMethodsExtraction(content: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const methods = (parsed as { methods?: unknown })?.methods;
  if (!Array.isArray(methods)) return [];
  return methods.filter((item): item is string => typeof item === 'string');
}
