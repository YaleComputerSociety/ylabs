/**
 * Analytics event logging and aggregation service.
 */
import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';
import { User } from '../models/index';
import { PostedOpportunity } from '../models/postedOpportunity';
import type { PipelineStage } from 'mongoose';

export interface LogEventParams {
  eventType: AnalyticsEventType;
  netid: string;
  userType: string;
  listingId?: string;
  fellowshipId?: string;
  searchQuery?: string;
  searchDepartments?: string[];
  metadata?: any;
}

export type AnalyticsUserSort = 'lastActive' | 'totalEvents' | 'logins' | 'searches' | 'views';
export type AnalyticsSortDirection = 'asc' | 'desc';

export interface AnalyticsUsersQuery {
  userType?: string;
  activeSince?: string;
  search?: string;
  sort?: AnalyticsUserSort;
  direction?: AnalyticsSortDirection;
  limit?: number;
}

export interface AnalyticsUserDrilldownQuery {
  limit?: number;
}

export interface AnalyticsUserSummary {
  netid: string;
  userType: string;
  fname?: string;
  lname?: string;
  email?: string;
  totalEvents: number;
  logins: number;
  searches: number;
  views: number;
  fellowshipViews: number;
  listingFavorites: number;
  listingUnfavorites: number;
  fellowshipFavorites: number;
  fellowshipUnfavorites: number;
  outreachClicks: number;
  outreachOutcomes: number;
  listingCreates: number;
  listingUpdates: number;
  listingArchives: number;
  listingUnarchives: number;
  profileUpdates: number;
  firstSeen?: Date;
  lastEventAt?: Date;
  lastActive?: Date;
  lastLogin?: Date;
  loginCount: number;
}

export interface AnalyticsUsersResult {
  users: AnalyticsUserSummary[];
  total: number;
  limit: number;
}

export interface AnalyticsUserEvent {
  id: string;
  eventType: AnalyticsEventType;
  userType: string;
  listingId?: string;
  fellowshipId?: string;
  searchQuery?: string;
  searchDepartments?: string[];
  metadata?: any;
  timestamp: Date;
}

export interface AnalyticsUserDrilldownResult {
  user: AnalyticsUserSummary;
  events: AnalyticsUserEvent[];
  limit: number;
}

export interface AnalyticsDateRange {
  start?: Date;
  end?: Date;
}

export interface SearchQualityQueryAnalytics {
  query: string;
  entityType: string;
  totalSearches: number;
  zeroResultSearches: number;
  uniqueSearchers: number;
  avgResultCount: number;
}

export interface SearchQualityAnalytics {
  totalSearches: number;
  zeroResultSearches: number;
  zeroResultRate: number;
  uniqueSearchers: number;
  byQueryAndEntityType: SearchQualityQueryAnalytics[];
  topZeroResultQueries: SearchQualityQueryAnalytics[];
  topQueries: SearchQualityQueryAnalytics[];
}

export interface SearchQuerySearcher {
  netid: string;
  userType: string;
  fname?: string;
  lname?: string;
  email?: string;
  searchCount: number;
  lastSearchedAt?: Date;
}

export interface SearchQueryAnalyticsRow {
  query: string;
  totalSearches: number;
  uniqueSearchers: number;
  zeroResultSearches: number;
  avgResultCount: number;
  lastSearchedAt?: Date;
  searchers: SearchQuerySearcher[];
}

export interface SearchQueryAnalytics {
  queries: SearchQueryAnalyticsRow[];
  limit: number;
}

export interface FunnelAnalytics {
  logins: number;
  searches: number;
  listingViews: number;
  fellowshipViews: number;
  favoritesOrSaves: number;
  outreachClicks: number;
  outreachOutcomes: number;
}

export interface TrendingOpportunityViewRow {
  listingId: any;
  views: number;
  uniqueViewers: number;
}

export interface OpportunityViewDataHealth {
  opportunityViewEventsLast30Days: number;
  resolvedOpportunityViewEventsLast30Days: number;
  orphanedOpportunityViewEventsLast30Days: number;
  orphanedOpportunityIds: string[];
}

export interface ResolvedTrendingOpportunity {
  listingId: string;
  sourceRecordId: string;
  sourceType: 'postedOpportunity' | 'legacyListing';
  opportunityId?: string;
  title: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  departments?: string[];
  status?: string;
  archived?: boolean;
  researchEntityId?: string;
  views: number;
  uniqueViewers: number;
}

export interface TrendingOpportunityResolution {
  trending: ResolvedTrendingOpportunity[];
  dataHealth: OpportunityViewDataHealth;
}

export interface HighSearchLowResultsAction {
  query: string;
  entityType: string;
  totalSearches: number;
  zeroResultSearches: number;
  zeroResultRate: number;
  avgResultCount: number;
  uniqueSearchers: number;
}

export interface ListingHighViewsLowFavoritesAction {
  listingId: string;
  title?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  departments?: string[];
  rangeViews: number;
  rangeFavorites: number;
  lifetimeViews: number;
  lifetimeFavorites: number;
  favoriteRate: number;
}

export interface ActionNeededAnalytics {
  highSearchLowResults: HighSearchLowResultsAction[];
  listingsHighViewsLowFavorites: ListingHighViewsLowFavoritesAction[];
}

const toIdString = (value: any): string => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
};

export const resolveTrendingOpportunityViews = (
  rows: TrendingOpportunityViewRow[] = [],
  legacyListings: any[] = [],
  postedOpportunities: any[] = [],
): TrendingOpportunityResolution => {
  const postedById = new Map<string, any>();
  const postedByListingId = new Map<string, any>();
  const legacyById = new Map<string, any>();

  postedOpportunities.forEach((opportunity) => {
    const id = toIdString(opportunity._id);
    if (id) {
      postedById.set(id, opportunity);
    }

    const listingId = toIdString(opportunity.listingId);
    if (listingId) {
      postedByListingId.set(listingId, opportunity);
    }
  });

  legacyListings.forEach((listing) => {
    const id = toIdString(listing._id);
    if (id) {
      legacyById.set(id, listing);
    }
  });

  const trending: ResolvedTrendingOpportunity[] = [];
  const orphanedOpportunityIds: string[] = [];
  let resolvedOpportunityViewEventsLast30Days = 0;
  let orphanedOpportunityViewEventsLast30Days = 0;
  let opportunityViewEventsLast30Days = 0;

  rows.forEach((row) => {
    const sourceRecordId = toIdString(row.listingId);
    const views = row.views || 0;
    opportunityViewEventsLast30Days += views;

    const postedOpportunity = postedById.get(sourceRecordId) || postedByListingId.get(sourceRecordId);
    if (postedOpportunity) {
      resolvedOpportunityViewEventsLast30Days += views;
      trending.push({
        listingId: sourceRecordId,
        sourceRecordId,
        opportunityId: toIdString(postedOpportunity._id),
        sourceType: 'postedOpportunity',
        title: postedOpportunity.title || sourceRecordId,
        status: postedOpportunity.status,
        archived: postedOpportunity.archived,
        researchEntityId: toIdString(postedOpportunity.researchEntityId) || undefined,
        views,
        uniqueViewers: row.uniqueViewers || 0,
      });
      return;
    }

    const legacyListing = legacyById.get(sourceRecordId);
    if (legacyListing) {
      resolvedOpportunityViewEventsLast30Days += views;
      trending.push({
        listingId: sourceRecordId,
        sourceRecordId,
        sourceType: 'legacyListing',
        title: legacyListing.title || sourceRecordId,
        ownerFirstName: legacyListing.ownerFirstName,
        ownerLastName: legacyListing.ownerLastName,
        departments: legacyListing.departments,
        views,
        uniqueViewers: row.uniqueViewers || 0,
      });
      return;
    }

    orphanedOpportunityViewEventsLast30Days += views;
    if (sourceRecordId) {
      orphanedOpportunityIds.push(sourceRecordId);
    }
  });

  return {
    trending,
    dataHealth: {
      opportunityViewEventsLast30Days,
      resolvedOpportunityViewEventsLast30Days,
      orphanedOpportunityViewEventsLast30Days,
      orphanedOpportunityIds,
    },
  };
};

const USER_ANALYTICS_SORTS = new Set<AnalyticsUserSort>([
  'lastActive',
  'totalEvents',
  'logins',
  'searches',
  'views',
]);

const EVENT_COUNT_FIELDS: Record<string, AnalyticsEventType> = {
  logins: AnalyticsEventType.LOGIN,
  searches: AnalyticsEventType.SEARCH,
  views: AnalyticsEventType.LISTING_VIEW,
  fellowshipViews: AnalyticsEventType.FELLOWSHIP_VIEW,
  listingFavorites: AnalyticsEventType.LISTING_FAVORITE,
  listingUnfavorites: AnalyticsEventType.LISTING_UNFAVORITE,
  fellowshipFavorites: AnalyticsEventType.FELLOWSHIP_FAVORITE,
  fellowshipUnfavorites: AnalyticsEventType.FELLOWSHIP_UNFAVORITE,
  outreachClicks: AnalyticsEventType.OUTREACH_CLICK,
  outreachOutcomes: AnalyticsEventType.OUTREACH_OUTCOME,
  listingCreates: AnalyticsEventType.LISTING_CREATE,
  listingUpdates: AnalyticsEventType.LISTING_UPDATE,
  listingArchives: AnalyticsEventType.LISTING_ARCHIVE,
  listingUnarchives: AnalyticsEventType.LISTING_UNARCHIVE,
  profileUpdates: AnalyticsEventType.PROFILE_UPDATE,
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clampLimit = (value: unknown, defaultValue: number, maxValue: number): number => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Invalid limit');
  }

  return Math.min(Math.floor(parsed), maxValue);
};

const validateRangeDate = (value: Date | undefined, field: 'start' | 'end'): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid range.${field}`);
  }

  return value;
};

const buildRangeTimestampMatch = (range: AnalyticsDateRange = {}): Record<string, any> => {
  const start = validateRangeDate(range.start, 'start');
  const end = validateRangeDate(range.end, 'end');

  if (start && end && start.getTime() > end.getTime()) {
    throw new Error('Invalid range: start must be before end');
  }

  const timestamp: Record<string, Date> = {};
  if (start) {
    timestamp.$gte = start;
  }
  if (end) {
    timestamp.$lte = end;
  }

  return Object.keys(timestamp).length > 0 ? { timestamp } : {};
};

const parseActiveSince = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid activeSince');
  }

  return parsed;
};

const buildEventCountAccumulator = (eventType: AnalyticsEventType) => ({
  $sum: {
    $cond: [{ $eq: ['$eventType', eventType] }, 1, 0],
  },
});

const userSummaryPipeline = (netid?: string, query: AnalyticsUsersQuery = {}): PipelineStage[] => {
  const activeSince = parseActiveSince(query.activeSince);
  const limit = clampLimit(query.limit, 50, 200);
  const sort = query.sort && USER_ANALYTICS_SORTS.has(query.sort) ? query.sort : 'lastActive';
  const direction = query.direction === 'asc' ? 1 : -1;
  const match: PipelineStage.Match['$match'] = {};

  if (netid) {
    match.netid = { $regex: `^${escapeRegex(netid)}$`, $options: 'i' };
  }

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: '$netid',
        analyticsUserType: { $last: '$userType' },
        totalEvents: { $sum: 1 },
        firstEventAt: { $min: '$timestamp' },
        lastEventAt: { $max: '$timestamp' },
        ...Object.fromEntries(
          Object.entries(EVENT_COUNT_FIELDS).map(([field, eventType]) => [
            field,
            buildEventCountAccumulator(eventType),
          ]),
        ),
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: 'netid',
        as: 'user',
      },
    },
    {
      $unwind: {
        path: '$user',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        netid: '$_id',
        userType: { $ifNull: ['$user.userType', '$analyticsUserType'] },
        fname: '$user.fname',
        lname: '$user.lname',
        email: '$user.email',
        firstSeen: { $ifNull: ['$user.createdAt', '$firstEventAt'] },
        lastActive: { $ifNull: ['$user.lastActive', '$lastEventAt'] },
        lastLogin: { $ifNull: ['$user.lastLogin', '$user.lastLoginAt'] },
        loginCount: { $ifNull: ['$user.loginCount', 0] },
      },
    },
  ];

  const postLookupMatch: PipelineStage.Match['$match'] = {};
  if (query.userType) {
    postLookupMatch.userType = query.userType;
  }
  if (activeSince) {
    postLookupMatch.lastActive = { $gte: activeSince };
  }
  if (query.search) {
    const searchRegex = { $regex: escapeRegex(query.search), $options: 'i' };
    postLookupMatch.$or = [
      { netid: searchRegex },
      { fname: searchRegex },
      { lname: searchRegex },
      { email: searchRegex },
    ];
  }

  if (Object.keys(postLookupMatch).length > 0) {
    pipeline.push({ $match: postLookupMatch });
  }

  pipeline.push(
    {
      $project: {
        _id: 0,
        netid: 1,
        userType: 1,
        fname: 1,
        lname: 1,
        email: 1,
        totalEvents: 1,
        logins: 1,
        searches: 1,
        views: 1,
        fellowshipViews: 1,
        listingFavorites: 1,
        listingUnfavorites: 1,
        fellowshipFavorites: 1,
        fellowshipUnfavorites: 1,
        outreachClicks: 1,
        outreachOutcomes: 1,
        listingCreates: 1,
        listingUpdates: 1,
        listingArchives: 1,
        listingUnarchives: 1,
        profileUpdates: 1,
        firstSeen: 1,
        lastEventAt: 1,
        lastActive: 1,
        lastLogin: 1,
        loginCount: 1,
      },
    },
    {
      $sort: {
        [sort]: direction,
        netid: 1,
      },
    },
    {
      $facet: {
        users: [{ $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
    {
      $project: {
        users: 1,
        total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
      },
    },
  );

  return pipeline;
};

export const getUserAnalytics = async (
  query: AnalyticsUsersQuery = {},
): Promise<AnalyticsUsersResult> => {
  const limit = clampLimit(query.limit, 50, 200);
  const [result] = await AnalyticsEvent.aggregate(userSummaryPipeline(undefined, { ...query, limit }));

  return {
    users: result?.users ?? [],
    total: result?.total ?? 0,
    limit,
  };
};

export const getUserAnalyticsDrilldown = async (
  netid: string,
  query: AnalyticsUserDrilldownQuery = {},
): Promise<AnalyticsUserDrilldownResult | null> => {
  const limit = clampLimit(query.limit, 100, 300);
  const [summaryResult] = await AnalyticsEvent.aggregate(
    userSummaryPipeline(netid, { sort: 'lastActive', direction: 'desc', limit: 1 }),
  );
  const user = summaryResult?.users?.[0] as AnalyticsUserSummary | undefined;

  if (!user) {
    return null;
  }

  const events = await AnalyticsEvent.find({
    netid: { $regex: `^${escapeRegex(netid)}$`, $options: 'i' },
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  return {
    user,
    events: events.map((event: any) => ({
      id: String(event._id),
      eventType: event.eventType,
      userType: event.userType,
      listingId: event.listingId ? String(event.listingId) : undefined,
      fellowshipId: event.fellowshipId ? String(event.fellowshipId) : undefined,
      searchQuery: event.searchQuery,
      searchDepartments: event.searchDepartments,
      metadata: event.metadata,
      timestamp: event.timestamp,
    })),
    limit,
  };
};

export const logEvent = async (params: LogEventParams): Promise<void> => {
  try {
    await AnalyticsEvent.create({
      eventType: params.eventType,
      netid: params.netid,
      userType: params.userType,
      listingId: params.listingId,
      fellowshipId: params.fellowshipId,
      searchQuery: params.searchQuery,
      searchDepartments: params.searchDepartments,
      metadata: params.metadata,
      timestamp: new Date(),
    });

    const now = new Date();
    const updateFields: any = {
      lastActive: now,
    };

    if (params.eventType === AnalyticsEventType.LOGIN) {
      updateFields.lastLogin = now;
      updateFields.$inc = { loginCount: 1 };
    }

    User.findOneAndUpdate({ netid: params.netid }, updateFields).catch((err: any) => {
      console.error('Error updating user metrics:', err);
    });
  } catch (error) {
    console.error('Error logging analytics event:', error);
  }
};

export const getSearchQualityAnalytics = async (
  range: AnalyticsDateRange = {},
): Promise<SearchQualityAnalytics> => {
  const [result] = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: AnalyticsEventType.SEARCH,
        ...buildRangeTimestampMatch(range),
      },
    },
    {
      $addFields: {
        normalizedQuery: { $trim: { input: { $ifNull: ['$searchQuery', ''] } } },
        searchEntityType: { $ifNull: ['$metadata.entityType', 'listing'] },
        resultCount: {
          $convert: {
            input: '$metadata.resultCount',
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: null,
              totalSearches: { $sum: 1 },
              zeroResultSearches: {
                $sum: { $cond: [{ $lte: ['$resultCount', 0] }, 1, 0] },
              },
              uniqueSearchers: { $addToSet: '$netid' },
            },
          },
          {
            $project: {
              _id: 0,
              totalSearches: 1,
              zeroResultSearches: 1,
              uniqueSearchers: { $size: '$uniqueSearchers' },
            },
          },
        ],
        byQueryAndEntityType: [
          {
            $group: {
              _id: {
                query: '$normalizedQuery',
                entityType: '$searchEntityType',
              },
              totalSearches: { $sum: 1 },
              zeroResultSearches: {
                $sum: { $cond: [{ $lte: ['$resultCount', 0] }, 1, 0] },
              },
              uniqueSearchers: { $addToSet: '$netid' },
              avgResultCount: { $avg: '$resultCount' },
            },
          },
          {
            $project: {
              _id: 0,
              query: '$_id.query',
              entityType: '$_id.entityType',
              totalSearches: 1,
              zeroResultSearches: 1,
              uniqueSearchers: { $size: '$uniqueSearchers' },
              avgResultCount: { $round: ['$avgResultCount', 2] },
            },
          },
          { $sort: { totalSearches: -1, zeroResultSearches: -1, query: 1 } },
          { $limit: 100 },
        ],
      },
    },
  ]);

  const overall = result?.overall?.[0] ?? {
    totalSearches: 0,
    zeroResultSearches: 0,
    uniqueSearchers: 0,
  };
  const byQueryAndEntityType = (result?.byQueryAndEntityType ?? []) as SearchQualityQueryAnalytics[];
  const topQueries = byQueryAndEntityType.slice(0, 10);
  const topZeroResultQueries = [...byQueryAndEntityType]
    .filter((query) => query.zeroResultSearches > 0)
    .sort(
      (a, b) =>
        b.zeroResultSearches - a.zeroResultSearches ||
        b.totalSearches - a.totalSearches ||
        a.query.localeCompare(b.query),
    )
    .slice(0, 10);

  return {
    totalSearches: overall.totalSearches,
    zeroResultSearches: overall.zeroResultSearches,
    zeroResultRate:
      overall.totalSearches > 0
        ? Number((overall.zeroResultSearches / overall.totalSearches).toFixed(4))
        : 0,
    uniqueSearchers: overall.uniqueSearchers,
    byQueryAndEntityType,
    topZeroResultQueries,
    topQueries,
  };
};

export const getSearchQueryAnalytics = async (
  range: AnalyticsDateRange = {},
  query: { limit?: number } = {},
): Promise<SearchQueryAnalytics> => {
  const limit = clampLimit(query.limit, 25, 100);
  const queries = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: AnalyticsEventType.SEARCH,
        searchQuery: { $exists: true, $ne: '' },
        ...buildRangeTimestampMatch(range),
      },
    },
    {
      $addFields: {
        normalizedQuery: { $trim: { input: { $ifNull: ['$searchQuery', ''] } } },
        resultCount: {
          $convert: {
            input: '$metadata.resultCount',
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    {
      $match: {
        normalizedQuery: { $ne: '' },
      },
    },
    {
      $group: {
        _id: {
          query: '$normalizedQuery',
          netid: '$netid',
        },
        userType: { $last: '$userType' },
        searchCount: { $sum: 1 },
        zeroResultSearches: {
          $sum: { $cond: [{ $lte: ['$resultCount', 0] }, 1, 0] },
        },
        resultCountTotal: { $sum: '$resultCount' },
        lastSearchedAt: { $max: '$timestamp' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id.netid',
        foreignField: 'netid',
        as: 'user',
      },
    },
    {
      $unwind: {
        path: '$user',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        query: '$_id.query',
        netid: '$_id.netid',
        userType: { $ifNull: ['$user.userType', '$userType'] },
        fname: '$user.fname',
        lname: '$user.lname',
        email: '$user.email',
        searchCount: 1,
        zeroResultSearches: 1,
        resultCountTotal: 1,
        lastSearchedAt: 1,
      },
    },
    {
      $sort: {
        query: 1,
        searchCount: -1,
        lastSearchedAt: -1,
        netid: 1,
      },
    },
    {
      $group: {
        _id: '$query',
        totalSearches: { $sum: '$searchCount' },
        uniqueSearchers: { $sum: 1 },
        zeroResultSearches: { $sum: '$zeroResultSearches' },
        resultCountTotal: { $sum: '$resultCountTotal' },
        lastSearchedAt: { $max: '$lastSearchedAt' },
        searchers: {
          $push: {
            netid: '$netid',
            userType: '$userType',
            fname: '$fname',
            lname: '$lname',
            email: '$email',
            searchCount: '$searchCount',
            lastSearchedAt: '$lastSearchedAt',
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        query: '$_id',
        totalSearches: 1,
        uniqueSearchers: 1,
        zeroResultSearches: 1,
        avgResultCount: {
          $round: [
            {
              $cond: [
                { $gt: ['$totalSearches', 0] },
                { $divide: ['$resultCountTotal', '$totalSearches'] },
                0,
              ],
            },
            2,
          ],
        },
        lastSearchedAt: 1,
        searchers: { $slice: ['$searchers', 25] },
      },
    },
    {
      $sort: {
        totalSearches: -1,
        uniqueSearchers: -1,
        lastSearchedAt: -1,
        query: 1,
      },
    },
    { $limit: limit },
  ]);

  return {
    queries: queries as SearchQueryAnalyticsRow[],
    limit,
  };
};

export const getFunnelAnalytics = async (
  range: AnalyticsDateRange = {},
): Promise<FunnelAnalytics> => {
  const rows = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: {
          $in: [
            AnalyticsEventType.LOGIN,
            AnalyticsEventType.SEARCH,
            AnalyticsEventType.LISTING_VIEW,
            AnalyticsEventType.FELLOWSHIP_VIEW,
            AnalyticsEventType.LISTING_FAVORITE,
            AnalyticsEventType.FELLOWSHIP_FAVORITE,
            AnalyticsEventType.OUTREACH_CLICK,
            AnalyticsEventType.OUTREACH_OUTCOME,
          ],
        },
        ...buildRangeTimestampMatch(range),
      },
    },
    {
      $group: {
        _id: '$eventType',
        uniqueNetids: { $addToSet: '$netid' },
      },
    },
    {
      $project: {
        _id: 0,
        eventType: '$_id',
        count: { $size: '$uniqueNetids' },
      },
    },
  ]);

  const counts = Object.fromEntries(
    rows.map((row: { eventType: AnalyticsEventType; count: number }) => [row.eventType, row.count]),
  ) as Partial<Record<AnalyticsEventType, number>>;

  return {
    logins: counts[AnalyticsEventType.LOGIN] ?? 0,
    searches: counts[AnalyticsEventType.SEARCH] ?? 0,
    listingViews: counts[AnalyticsEventType.LISTING_VIEW] ?? 0,
    fellowshipViews: counts[AnalyticsEventType.FELLOWSHIP_VIEW] ?? 0,
    favoritesOrSaves:
      (counts[AnalyticsEventType.LISTING_FAVORITE] ?? 0) +
      (counts[AnalyticsEventType.FELLOWSHIP_FAVORITE] ?? 0),
    outreachClicks: counts[AnalyticsEventType.OUTREACH_CLICK] ?? 0,
    outreachOutcomes: counts[AnalyticsEventType.OUTREACH_OUTCOME] ?? 0,
  };
};

export const getActionNeededAnalytics = async (
  range: AnalyticsDateRange = {},
): Promise<ActionNeededAnalytics> => {
  const searchQuality = await getSearchQualityAnalytics(range);
  const highSearchLowResults = searchQuality.byQueryAndEntityType
    .filter((query) => query.totalSearches >= 2 && query.zeroResultSearches > 0)
    .map((query) => ({
      ...query,
      zeroResultRate: Number((query.zeroResultSearches / query.totalSearches).toFixed(4)),
    }))
    .sort(
      (a, b) =>
        b.zeroResultRate - a.zeroResultRate ||
        b.zeroResultSearches - a.zeroResultSearches ||
        b.totalSearches - a.totalSearches,
    )
    .slice(0, 10);

  const listingsHighViewsLowFavorites: ListingHighViewsLowFavoritesAction[] = [];

  return {
    highSearchLowResults,
    listingsHighViewsLowFavorites,
  };
};

export const getAnalytics = async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const visitorStats = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: { $in: [AnalyticsEventType.LOGIN, AnalyticsEventType.VISITOR] },
      },
    },
    {
      $facet: {
        lifetimeVisitors: [
          {
            $group: {
              _id: '$netid',
              userType: { $first: '$userType' },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
            },
          },
        ],
        lifetimeVisitorsByType: [
          {
            $group: {
              _id: { netid: '$netid', userType: '$userType' },
            },
          },
          {
            $group: {
              _id: '$_id.userType',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              userType: '$_id',
              count: 1,
            },
          },
        ],
        last7DaysVisitors: [
          {
            $match: {
              timestamp: { $gte: sevenDaysAgo },
            },
          },
          {
            $group: {
              _id: '$netid',
              userType: { $first: '$userType' },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
            },
          },
        ],
        last7DaysVisitorsByType: [
          {
            $match: {
              timestamp: { $gte: sevenDaysAgo },
            },
          },
          {
            $group: {
              _id: { netid: '$netid', userType: '$userType' },
            },
          },
          {
            $group: {
              _id: '$_id.userType',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              userType: '$_id',
              count: 1,
            },
          },
        ],
        todayVisitors: [
          {
            $match: {
              timestamp: { $gte: today },
            },
          },
          {
            $group: {
              _id: '$netid',
              userType: { $first: '$userType' },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
            },
          },
        ],
        todayVisitorsByType: [
          {
            $match: {
              timestamp: { $gte: today },
            },
          },
          {
            $group: {
              _id: { netid: '$netid', userType: '$userType' },
            },
          },
          {
            $group: {
              _id: '$_id.userType',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              userType: '$_id',
              count: 1,
            },
          },
        ],
        totalLogins: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
            },
          },
        ],
        loginsLast7Days: [
          {
            $match: {
              timestamp: { $gte: sevenDaysAgo },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
            },
          },
        ],
        loginsToday: [
          {
            $match: {
              timestamp: { $gte: today },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const engagementStats = await AnalyticsEvent.aggregate([
    {
      $facet: {
        searchStats: [
          {
            $match: {
              eventType: AnalyticsEventType.SEARCH,
            },
          },
          {
            $group: {
              _id: null,
              totalSearches: { $sum: 1 },
              searchesLast7Days: {
                $sum: { $cond: [{ $gte: ['$timestamp', sevenDaysAgo] }, 1, 0] },
              },
              searchesToday: {
                $sum: { $cond: [{ $gte: ['$timestamp', today] }, 1, 0] },
              },
            },
          },
        ],
        topSearchQueries: [
          {
            $match: {
              eventType: AnalyticsEventType.SEARCH,
              timestamp: { $gte: thirtyDaysAgo },
              searchQuery: { $exists: true, $ne: '' },
            },
          },
          {
            $group: {
              _id: '$searchQuery',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              query: '$_id',
              count: 1,
            },
          },
        ],
        viewStats: [
          {
            $match: {
              eventType: AnalyticsEventType.LISTING_VIEW,
            },
          },
          {
            $group: {
              _id: null,
              totalViews: { $sum: 1 },
              viewsLast7Days: {
                $sum: { $cond: [{ $gte: ['$timestamp', sevenDaysAgo] }, 1, 0] },
              },
              viewsToday: {
                $sum: { $cond: [{ $gte: ['$timestamp', today] }, 1, 0] },
              },
            },
          },
        ],
        favoriteStats: [
          {
            $match: {
              eventType: {
                $in: [AnalyticsEventType.LISTING_FAVORITE, AnalyticsEventType.LISTING_UNFAVORITE],
              },
            },
          },
          {
            $group: {
              _id: '$eventType',
              total: { $sum: 1 },
              last7Days: {
                $sum: { $cond: [{ $gte: ['$timestamp', sevenDaysAgo] }, 1, 0] },
              },
            },
          },
          {
            $project: {
              _id: 0,
              eventType: '$_id',
              total: 1,
              last7Days: 1,
            },
          },
        ],
        trendingListings: [
          {
            $match: {
              eventType: AnalyticsEventType.LISTING_VIEW,
              timestamp: { $gte: thirtyDaysAgo },
              listingId: { $exists: true },
            },
          },
          {
            $group: {
              _id: '$listingId',
              views: { $sum: 1 },
              uniqueViewers: { $addToSet: '$netid' },
            },
          },
          {
            $project: {
              listingId: '$_id',
              views: 1,
              uniqueViewers: { $size: '$uniqueViewers' },
            },
          },
          { $sort: { views: -1 } },
          { $limit: 10 },
        ],
        userActivityStats: [
          {
            $match: {
              timestamp: { $gte: sevenDaysAgo },
            },
          },
          {
            $group: {
              _id: '$netid',
              totalEvents: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: null,
              activeUsers: { $sum: 1 },
              avgEventsPerUser: { $avg: '$totalEvents' },
            },
          },
        ],
        mostActiveUsers: [
          {
            $match: {
              timestamp: { $gte: thirtyDaysAgo },
            },
          },
          {
            $group: {
              _id: { netid: '$netid', userType: '$userType' },
              eventCount: { $sum: 1 },
            },
          },
          { $sort: { eventCount: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              userId: '$_id.netid',
              userType: '$_id.userType',
              eventCount: 1,
            },
          },
        ],
      },
    },
  ]);

  const listingStats = [
    {
      overview: [{ total: 0, active: 0, archived: 0, unconfirmed: 0 }],
      newListingsLast7Days: [{ count: 0 }],
      newListingsToday: [{ count: 0 }],
      listingsByDepartment: [],
      listingsPerProfessor: [],
      viewsAndFavorites: [{ totalViews: 0, totalFavorites: 0, avgViews: 0, avgFavorites: 0 }],
      topViewedListings: [],
      topFavoritedListings: [],
      viewsByDepartment: [],
      listingsWithZeroViews: [{ count: 0 }],
    },
  ];

  const userStats = await User.aggregate([
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              confirmed: { $sum: { $cond: ['$userConfirmed', 1, 0] } },
            },
          },
        ],
        byType: [
          {
            $group: {
              _id: '$userType',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              userType: '$_id',
              count: 1,
            },
          },
        ],
        newUsersLast7Days: [
          {
            $match: {
              createdAt: { $gte: sevenDaysAgo },
            },
          },
          { $count: 'count' },
        ],
        newUsersToday: [
          {
            $match: {
              createdAt: { $gte: today },
            },
          },
          { $count: 'count' },
        ],
        newUsersTodayByType: [
          {
            $match: {
              createdAt: { $gte: today },
            },
          },
          {
            $group: {
              _id: '$userType',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              userType: '$_id',
              count: 1,
            },
          },
        ],
      },
    },
  ]);

  const visitors = visitorStats[0];
  const engagement = engagementStats[0];
  const listings = listingStats[0];
  const users = userStats[0];

  const trendingListingIds = engagement.trendingListings.map((t: any) => t.listingId);
  const trendingListingsData: any[] = [];
  const trendingPostedOpportunitiesData = await PostedOpportunity.find({
      $or: [{ _id: { $in: trendingListingIds } }, { listingId: { $in: trendingListingIds } }],
    }).lean();
  const { trending: enrichedTrending, dataHealth: opportunityViewDataHealth } =
    resolveTrendingOpportunityViews(
      engagement.trendingListings || [],
      trendingListingsData,
      trendingPostedOpportunitiesData,
    );

  return {
    visitors: {
      lifetime: {
        total: visitors.lifetimeVisitors[0]?.total || 0,
        byType: visitors.lifetimeVisitorsByType || [],
      },
      last7Days: {
        total: visitors.last7DaysVisitors[0]?.total || 0,
        byType: visitors.last7DaysVisitorsByType || [],
      },
      today: {
        total: visitors.todayVisitors[0]?.total || 0,
        byType: visitors.todayVisitorsByType || [],
      },
      loginFrequency: {
        totalLogins: visitors.totalLogins[0]?.total || 0,
        loginsLast7Days: visitors.loginsLast7Days[0]?.total || 0,
        loginsToday: visitors.loginsToday[0]?.total || 0,
      },
    },
    engagement: {
      search: engagement.searchStats[0] || {
        totalSearches: 0,
        searchesLast7Days: 0,
        searchesToday: 0,
      },
      topSearchQueries: engagement.topSearchQueries || [],
      views: engagement.viewStats[0] || { totalViews: 0, viewsLast7Days: 0, viewsToday: 0 },
      favorites: engagement.favoriteStats || [],
      trendingListings: enrichedTrending || [],
      userActivity: engagement.userActivityStats[0] || { activeUsers: 0, avgEventsPerUser: 0 },
      mostActiveUsers: engagement.mostActiveUsers || [],
      totalViewsFromCounters: listings.viewsAndFavorites[0]?.totalViews || 0,
      totalFavoritesFromCounters: listings.viewsAndFavorites[0]?.totalFavorites || 0,
      avgViews: listings.viewsAndFavorites[0]?.avgViews || 0,
      avgFavorites: listings.viewsAndFavorites[0]?.avgFavorites || 0,
      viewsByDepartment: listings.viewsByDepartment || [],
      opportunityViewDataHealth,
    },
    listings: {
      overview: listings.overview[0] || { total: 0, active: 0, archived: 0, unconfirmed: 0 },
      newListingsLast7Days: listings.newListingsLast7Days[0]?.count || 0,
      newListingsToday: listings.newListingsToday[0]?.count || 0,
      byDepartment: listings.listingsByDepartment || [],
      byProfessor: listings.listingsPerProfessor || [],
      listingsWithZeroViews: listings.listingsWithZeroViews[0]?.count || 0,
      topViewedListings: listings.topViewedListings || [],
      topFavoritedListings: listings.topFavoritedListings || [],
    },
    users: {
      overview: users.overview[0] || { total: 0, confirmed: 0 },
      byType: users.byType || [],
      newUsersLast7Days: users.newUsersLast7Days[0]?.count || 0,
      newUsersToday: users.newUsersToday[0]?.count || 0,
      newUsersTodayByType: users.newUsersTodayByType || [],
    },
    timestamp: now.toISOString(),
  };
};
