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

interface CandidateScore<TCandidate> extends RankedResearchEntityCandidate<TCandidate> {
  hasSearchEvidence: boolean;
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
  'group',
  'home',
  'lab',
  'labs',
  'research',
]);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const getCandidateValue = (candidate: unknown, key: string): unknown =>
  candidate && typeof candidate === 'object'
    ? (candidate as Record<string, unknown>)[key]
    : undefined;

const normalizedTokens = (value: string): string[] =>
  value.split(/\s+/).filter(Boolean);

const includesPhrase = (searchableText: string, phrase: string): boolean => {
  const normalizedPhrase = normalize(phrase);
  return normalizedPhrase.length > 2 && searchableText.includes(normalizedPhrase);
};

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
      getCandidateValue(candidate, 'shortDescription'),
      getCandidateValue(candidate, 'fullDescription'),
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
    .map((candidate, index): CandidateScore<TCandidate> => {
      const searchableText = collectText(candidate);
      const queryTokens = significantQueryTokens(semantics.normalizedQuery);
      const searchableTokenSet = new Set(normalizedTokens(searchableText));
      const queryTokenHits = queryTokens.filter((token) => searchableTokenSet.has(token));
      const queryHit =
        Boolean(semantics.normalizedQuery) &&
        searchableText.includes(semantics.normalizedQuery);
      const conceptHits = semantics.concepts.filter((concept) =>
        includesPhrase(searchableText, concept),
      );
      const methodHits = semantics.methods.filter((method) =>
        includesPhrase(searchableText, method),
      );
      const phraseHits = semantics.phrases.filter((phrase) =>
        includesPhrase(searchableText, phrase),
      );
      const expansionHits = semantics.expansionQueries.filter((expansion) =>
        includesPhrase(searchableText, expansion),
      );
      const semanticRuleMatched =
        semantics.concepts.length > 0 ||
        semantics.methods.length > 0 ||
        semantics.expansionQueries.length > 1;
      const hasSearchEvidence =
        !semanticRuleMatched ||
        !semantics.normalizedQuery ||
        queryHit ||
        queryTokenHits.length > 0 ||
        phraseHits.length > 0 ||
        conceptHits.length > 0 ||
        methodHits.length > 0 ||
        expansionHits.length > 0;

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
      score += phraseHits.length * 220;
      score += expansionHits.length * 120;
      if (
        getCandidateValue(candidate, 'description') ||
        getCandidateValue(candidate, 'shortDescription') ||
        getCandidateValue(candidate, 'fullDescription') ||
        getCandidateValue(candidate, 'summary')
      ) {
        score += 180;
      }
      if (sourceCount(candidate) > 0) score += 120;
      if (
        getCandidateValue(candidate, 'entityType') === 'center' ||
        getCandidateValue(candidate, 'kind') === 'center'
      ) {
        score += 80;
      }

      const concepts =
        conceptHits.length > 0 || expansionHits.length > 0 ? semantics.concepts.slice(0, 2) : [];
      const methods =
        methodHits.length > 0 || expansionHits.length > 0 ? semantics.methods.slice(0, 2) : [];
      const reasonParts = [
        ...methodHits,
        ...conceptHits,
        ...phraseHits,
        ...(methodHits.length === 0 && conceptHits.length === 0 && expansionHits.length > 0
          ? [...methods, ...concepts, ...expansionHits.slice(0, 2)]
          : []),
      ].filter(Boolean);
      const reason =
        reasonParts.length > 0
          ? `Matches ${reasonParts.slice(0, 3).join(', ')}.`
          : `Matches "${semantics.originalQuery}".`;

      return {
        candidate,
        score,
        hasSearchEvidence,
        searchMatch: {
          mode,
          concepts,
          methods,
          reason,
        },
      };
    })
    .filter((record) => record.hasSearchEvidence)
    .sort((a, b) => b.score - a.score);
}
