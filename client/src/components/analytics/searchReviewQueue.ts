import type {
  AnalyticsActionNeededItem,
  AnalyticsSearchQualityQuery,
  AnalyticsSearchQualityResponse,
} from '../../reducers/analyticsReducer';

export interface SearchReviewQueue {
  total: number;
  zeroResultQueries: number;
  lowResultQueries: number;
}

const queryGroupKey = (entityType: string | undefined, query: string): string =>
  JSON.stringify([entityType ?? 'unknown', query]);

const actionCardKey = (card: AnalyticsActionNeededItem): string =>
  card.query !== undefined
    ? queryGroupKey(card.entityType, card.query)
    : JSON.stringify(['card', card.id ?? card._id ?? card.title]);

export const summarizeSearchReviewQueue = (
  actionCards: AnalyticsActionNeededItem[],
  zeroResultQueries: AnalyticsSearchQualityQuery[],
  lowResultQueries: AnalyticsSearchQualityQuery[],
): SearchReviewQueue => {
  const zeroResultKeys = new Set([
    ...actionCards.map(actionCardKey),
    ...zeroResultQueries.map((query) => queryGroupKey(query.entityType, query.query)),
  ]);
  const lowResultKeys = new Set(
    lowResultQueries
      .map((query) => queryGroupKey(query.entityType, query.query))
      .filter((key) => !zeroResultKeys.has(key)),
  );
  return {
    total: zeroResultKeys.size + lowResultKeys.size,
    zeroResultQueries: zeroResultKeys.size,
    lowResultQueries: lowResultKeys.size,
  };
};

export const searchesThatReachedTheCorpus = (
  searchQuality: AnalyticsSearchQualityResponse | null,
): number =>
  Math.max((searchQuality?.totalSearches || 0) - (searchQuality?.degradedSearches || 0), 0);
