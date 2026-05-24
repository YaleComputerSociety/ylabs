import type { ResearchSearchQuerySemantics } from './researchSearchQuerySemantics';

export type ResearchSearchMode = 'semantic' | 'hybrid' | 'expanded-keyword' | 'keyword';

export interface ResearchEntitySearchMatch {
  mode: ResearchSearchMode;
  concepts: string[];
  methods: string[];
  reason: string;
}

export interface RankedResearchEntityCandidate<TCandidate = unknown> {
  candidate: TCandidate;
  score: number;
  searchMatch: ResearchEntitySearchMatch;
}

const normalize = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const getCandidateValue = (candidate: unknown, key: string): unknown =>
  candidate && typeof candidate === 'object'
    ? (candidate as Record<string, unknown>)[key]
    : undefined;

const normalizedTokens = (value: string): string[] =>
  value.split(/\s+/).filter(Boolean);

const significantQueryTokens = (normalizedQuery: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const token of normalizedTokens(normalizedQuery)) {
    if (token.length <= 2 || QUERY_STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }

  return out;
};

const collectText = (candidate: unknown): string =>
  normalize(
    [
      getCandidateValue(candidate, 'name'),
      getCandidateValue(candidate, 'displayName'),
      getCandidateValue(candidate, 'description'),
      getCandidateValue(candidate, 'summary'),
      ...asStringArray(getCandidateValue(candidate, 'researchAreas')),
      ...asStringArray(getCandidateValue(candidate, 'keywords')),
      ...asStringArray(getCandidateValue(candidate, 'departments')),
      ...asStringArray(getCandidateValue(candidate, 'methodSignals')),
      ...asStringArray(getCandidateValue(candidate, 'conceptSignals')),
      getCandidateValue(candidate, 'semanticText'),
    ].join(' '),
  );

const sourceCount = (candidate: unknown): number => {
  const sourceUrls = getCandidateValue(candidate, 'sourceUrls');
  return Array.isArray(sourceUrls) ? sourceUrls.length : 0;
};

const meiliRankingScore = (candidate: unknown): number => {
  const score = getCandidateValue(candidate, '_rankingScore');
  return typeof score === 'number' && Number.isFinite(score) ? score : 0;
};

export function rankResearchEntityCandidates<TCandidate>(
  candidates: TCandidate[],
  semantics: ResearchSearchQuerySemantics,
  mode: ResearchSearchMode,
): RankedResearchEntityCandidate<TCandidate>[] {
  return candidates
    .map((candidate, index) => {
      const searchableText = collectText(candidate);
      const queryTokens = significantQueryTokens(semantics.normalizedQuery);
      const searchableTokenSet = new Set(normalizedTokens(searchableText));
      const queryTokenHits = queryTokens.filter((token) => searchableTokenSet.has(token));
      const queryHit =
        Boolean(semantics.normalizedQuery) &&
        searchableText.includes(semantics.normalizedQuery);
      const conceptHits = semantics.concepts.filter((concept) =>
        searchableText.includes(normalize(concept)),
      );
      const methodHits = semantics.methods.filter((method) =>
        searchableText.includes(normalize(method)),
      );
      const expansionHits = semantics.expansionQueries.filter((expansion) =>
        searchableText.includes(normalize(expansion)),
      );

      let score = Math.max(0, 1000 - index);
      score += Math.round(meiliRankingScore(candidate) * 240);
      if (queryHit) score += 800;
      if (queryTokens.length > 0) {
        score += queryTokenHits.length * 180;
        if (queryTokens.length > 1 && queryTokenHits.length === queryTokens.length) {
          score += 420;
        }
        if (queryTokens.length > 1 && queryTokenHits.length < queryTokens.length && !queryHit) {
          score -= (queryTokens.length - queryTokenHits.length) * 260;
        }
        if (
          queryTokens.length > 1 &&
          queryTokenHits.length === 0 &&
          conceptHits.length === 0 &&
          methodHits.length === 0 &&
          expansionHits.length === 0
        ) {
          score -= 500;
        }
      }
      score += conceptHits.length * 500;
      score += methodHits.length * 400;
      score += expansionHits.length * 120;
      if (getCandidateValue(candidate, 'description') || getCandidateValue(candidate, 'summary')) {
        score += 180;
      }
      if (sourceCount(candidate) > 0) score += 120;
      if (
        getCandidateValue(candidate, 'entityType') === 'center' ||
        getCandidateValue(candidate, 'kind') === 'center'
      ) {
        score += 80;
      }

      const concepts = conceptHits.length > 0 ? conceptHits : semantics.concepts.slice(0, 2);
      const methods = methodHits.length > 0 ? methodHits : semantics.methods.slice(0, 2);
      const reasonParts = [...methods, ...concepts].filter(Boolean);
      const reason =
        reasonParts.length > 0
          ? `Matches ${reasonParts.slice(0, 3).join(', ')}.`
          : `Matches "${semantics.originalQuery}".`;

      return {
        candidate,
        score,
        searchMatch: {
          mode,
          concepts,
          methods,
          reason,
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}
