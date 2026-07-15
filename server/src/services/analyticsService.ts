/**
 * Analytics event logging and aggregation service.
 */
import { AnalyticsEvent, AnalyticsEventType, RESEARCH_ENTITY_TYPES } from '../models/analytics';
import { User, ResearchEntity } from '../models/index';
import { getListingModel } from '../db/connections';
import { Types, type PipelineStage } from 'mongoose';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeLogValue } from '../utils/logSanitizer';

export interface LogEventParams {
  eventType: AnalyticsEventType;
  netid: string;
  userType: string;
  listingId?: string;
  fellowshipId?: string;
  entityType?: string;
  entityId?: string;
  searchQuery?: string;
  searchDepartments?: string[];
  metadata?: any;
  dedupeKey?: string;
}

const MAX_ANALYTICS_METADATA_DEPTH = 5;
const MAX_ANALYTICS_TEXT_LENGTH = 512;
const MAX_ANALYTICS_ARRAY_ITEMS = 50;
const MAX_ANALYTICS_OBJECT_KEYS = 50;
const MAX_ANALYTICS_METADATA_KEY_LENGTH = 80;
const MAX_ANALYTICS_USER_TYPE_LENGTH = 40;
const ANALYTICS_USER_TYPE_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ANALYTICS_METADATA_KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
const ANALYTICS_OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const ANALYTICS_DEDUPE_KEY_RE = /^[A-Za-z0-9:_-]{1,160}$/;
const ANALYTICS_EVENT_TYPES = new Set<AnalyticsEventType>(Object.values(AnalyticsEventType));
const ANALYTICS_RESEARCH_ENTITY_TYPES = new Set<string>(RESEARCH_ENTITY_TYPES);

const sanitizeAnalyticsEventType = (value: unknown): AnalyticsEventType | undefined =>
  typeof value === 'string' && ANALYTICS_EVENT_TYPES.has(value as AnalyticsEventType)
    ? (value as AnalyticsEventType)
    : undefined;

const sanitizeAnalyticsText = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? redactDirectContactInfo(value).slice(0, MAX_ANALYTICS_TEXT_LENGTH)
    : undefined;

const sanitizeAnalyticsStringArray = (values: unknown): string[] | undefined =>
  Array.isArray(values)
    ? values
        .flatMap((value) => {
          const sanitized = sanitizeAnalyticsText(value);
          return sanitized !== undefined ? [sanitized] : [];
        })
        .slice(0, MAX_ANALYTICS_ARRAY_ITEMS)
    : undefined;

const sanitizeAnalyticsMetadataKey = (key: string): string | undefined => {
  const trimmed = key.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_ANALYTICS_METADATA_KEY_LENGTH ||
    trimmed === '__proto__' ||
    trimmed === 'constructor' ||
    trimmed === 'prototype' ||
    !ANALYTICS_METADATA_KEY_RE.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
};

const sanitizeAnalyticsMetadata = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return sanitizeAnalyticsText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean' || value === null) return value;
  if (value instanceof Date) return value;
  if (depth >= MAX_ANALYTICS_METADATA_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ANALYTICS_ARRAY_ITEMS)
      .map((item) => sanitizeAnalyticsMetadata(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ANALYTICS_OBJECT_KEYS)
        .map(([key, item]) => [
          sanitizeAnalyticsMetadataKey(key),
          sanitizeAnalyticsMetadata(item, depth + 1),
        ])
        .filter(([key]) => key !== undefined)
        .filter(([, item]) => item !== undefined),
    );
  }

  return undefined;
};

const publicAnalyticsUserEvent = (event: any): AnalyticsUserEvent => {
  const eventType = sanitizeAnalyticsEventType(event?.eventType) || AnalyticsEventType.VISITOR;
  const listingId = normalizeAnalyticsStoredObjectIdString(event?.listingId);
  const fellowshipId = normalizeAnalyticsStoredObjectIdString(event?.fellowshipId);
  const searchQuery = sanitizeAnalyticsText(event?.searchQuery);
  const searchDepartments = sanitizeAnalyticsStringArray(event?.searchDepartments);
  const metadata = sanitizeAnalyticsMetadata(event?.metadata);

  return {
    id: normalizeAnalyticsStoredObjectIdString(event?._id) || '',
    eventType,
    userType: sanitizeAnalyticsUserType(event?.userType),
    ...(listingId ? { listingId } : {}),
    ...(fellowshipId ? { fellowshipId } : {}),
    ...(searchQuery !== undefined ? { searchQuery } : {}),
    ...(searchDepartments !== undefined ? { searchDepartments } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    timestamp: event?.timestamp instanceof Date ? event.timestamp : new Date(event?.timestamp || 0),
  };
};

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

export interface AnalyticsUserTypeCount {
  userType: string;
  count: number;
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
  engagedSearches: number;
  returnedButIgnoredSearches: number;
  engagementRate: number;
  attributionWindowMinutes: number;
}

export interface SearchQuerySearcherAnalytics {
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
  searchers: SearchQuerySearcherAnalytics[];
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
  researchSearches: number;
  researchProfileOpens: number;
  researchSaves: number;
  researchComparisons: number;
  researchPlanUpdates: number;
  sourceInspections: number;
  qualifiedActions: number;
  officialRouteAttempts: number;
  applicationOpens: number;
  confirmedOutcomes: number;
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

const USER_ANALYTICS_SORTS = new Set<AnalyticsUserSort>([
  'lastActive',
  'totalEvents',
  'logins',
  'searches',
  'views',
]);

const CANONICAL_ACADEMIC_USER_TYPE = 'professor';
const LEGACY_ACADEMIC_USER_TYPES = [CANONICAL_ACADEMIC_USER_TYPE, 'faculty'];

const appUserAccountMatch = (): PipelineStage.Match['$match'] => ({
  archived: { $ne: true },
  dedupedIntoUserId: { $exists: false },
  $or: [
    { loginCount: { $gt: 0 } },
    { lastLogin: { $exists: true, $ne: null } },
    { lastLoginAt: { $exists: true, $ne: null } },
    { lastActive: { $exists: true, $ne: null } },
  ],
});

export const normalizeAnalyticsUserTypeBucket = (userType?: string | null): string => {
  const normalized =
    String(userType || 'unknown')
      .trim()
      .toLowerCase() || 'unknown';
  return LEGACY_ACADEMIC_USER_TYPES.includes(normalized)
    ? CANONICAL_ACADEMIC_USER_TYPE
    : normalized;
};

export const combineAnalyticsUserTypeCounts = (
  rows: Array<{ userType?: string | null; count?: number }>,
): AnalyticsUserTypeCount[] => {
  const counts = new Map<string, number>();

  for (const row of rows || []) {
    const bucket = normalizeAnalyticsUserTypeBucket(row.userType);
    counts.set(bucket, (counts.get(bucket) || 0) + (row.count || 0));
  }

  return Array.from(counts.entries())
    .map(([userType, count]) => ({ userType, count }))
    .sort((a, b) => b.count - a.count || a.userType.localeCompare(b.userType));
};

const analyticsUserTypeMatch = (userType: string) =>
  normalizeAnalyticsUserTypeBucket(userType) === CANONICAL_ACADEMIC_USER_TYPE
    ? { $in: LEGACY_ACADEMIC_USER_TYPES }
    : normalizeAnalyticsUserTypeBucket(userType);

export const MAX_USER_ANALYTICS_SEARCH_LENGTH = 120;

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

const BETA_STUDENT_USER_TYPES = new Set(['student', 'undergraduate', 'graduate']);

const isBetaRuntime = (): boolean => process.env.SCRAPER_ENV === 'beta';

const isFixtureNetid = (netid: string): boolean => {
  const normalized = netid.trim().toLowerCase();
  return (
    normalized === 'devadmin' ||
    normalized === 'test123' ||
    normalized.startsWith('dev') ||
    normalized.startsWith('test')
  );
};

export const shouldSuppressBetaAnalyticsEvent = (
  params: Pick<LogEventParams, 'netid' | 'userType'>,
): boolean => {
  if (!isBetaRuntime()) {
    return false;
  }

  if (isFixtureNetid(params.netid)) {
    return false;
  }

  return BETA_STUDENT_USER_TYPES.has(
    String(params.userType || '')
      .trim()
      .toLowerCase(),
  );
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANALYTICS_NETID_RE = /^[A-Za-z0-9]{2,12}$/;
const ANALYTICS_NON_USER_NETIDS = new Set(['anonymous', 'unknown']);

const normalizeAnalyticsNetid = (value: string): string => {
  const trimmed = value.trim();
  if (!ANALYTICS_NETID_RE.test(trimmed)) {
    throw new Error('Invalid netid');
  }
  return trimmed;
};

const normalizeAnalyticsEventNetid = (value: string): string => {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (ANALYTICS_NON_USER_NETIDS.has(lower)) {
    return lower;
  }
  return normalizeAnalyticsNetid(trimmed);
};

const isAnalyticsUserNetid = (value: string): boolean =>
  !ANALYTICS_NON_USER_NETIDS.has(value) && ANALYTICS_NETID_RE.test(value);

const sanitizeAnalyticsUserType = (value: unknown): string => {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim().slice(0, MAX_ANALYTICS_USER_TYPE_LENGTH);
  return ANALYTICS_USER_TYPE_RE.test(trimmed) ? trimmed : 'unknown';
};

const normalizeAnalyticsObjectIdString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return ANALYTICS_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
};

const sanitizeAnalyticsObjectId = (value: unknown): string | undefined =>
  normalizeAnalyticsObjectIdString(value);

const sanitizeResearchEntityType = (value: unknown): string | undefined =>
  typeof value === 'string' && ANALYTICS_RESEARCH_ENTITY_TYPES.has(value) ? value : undefined;

const sanitizeResearchEntityId = (value: unknown): string | undefined => {
  const sanitized = sanitizeAnalyticsText(value);
  return sanitized && sanitized.trim() !== '' ? sanitized.slice(0, 128) : undefined;
};

const sanitizeAnalyticsDedupeKey = (value: unknown): string | undefined =>
  typeof value === 'string' && ANALYTICS_DEDUPE_KEY_RE.test(value) ? value : undefined;

const normalizeAnalyticsStoredObjectIdString = (value: unknown): string | undefined => {
  if (value instanceof Types.ObjectId) {
    return value.toHexString();
  }
  return normalizeAnalyticsObjectIdString(value);
};

const validateUserAnalyticsSearch = (value?: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value.length > MAX_USER_ANALYTICS_SEARCH_LENGTH) {
    throw new Error('Invalid search');
  }

  return value;
};

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
  const search = validateUserAnalyticsSearch(query.search);
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
    postLookupMatch.userType = analyticsUserTypeMatch(query.userType);
  }
  if (activeSince) {
    postLookupMatch.lastActive = { $gte: activeSince };
  }
  if (search) {
    const searchRegex = { $regex: escapeRegex(search), $options: 'i' };
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
  const [result] = await AnalyticsEvent.aggregate(
    userSummaryPipeline(undefined, { ...query, limit }),
  );

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
  const normalizedNetid = normalizeAnalyticsNetid(netid);
  const limit = clampLimit(query.limit, 100, 300);
  const [summaryResult] = await AnalyticsEvent.aggregate(
    userSummaryPipeline(normalizedNetid, { sort: 'lastActive', direction: 'desc', limit: 1 }),
  );
  const user = summaryResult?.users?.[0] as AnalyticsUserSummary | undefined;

  if (!user) {
    return null;
  }

  const events = await AnalyticsEvent.find({
    netid: { $regex: `^${escapeRegex(normalizedNetid)}$`, $options: 'i' },
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  return {
    user,
    events: events.map(publicAnalyticsUserEvent),
    limit,
  };
};

export const logEvent = async (params: LogEventParams): Promise<void> => {
  try {
    const eventType = sanitizeAnalyticsEventType(params.eventType);
    if (!eventType) {
      return;
    }
    const netid = normalizeAnalyticsEventNetid(params.netid);
    const userType = sanitizeAnalyticsUserType(params.userType);
    const normalizedParams = { ...params, eventType, netid, userType };

    if (shouldSuppressBetaAnalyticsEvent(normalizedParams)) {
      return;
    }

    const listingId = sanitizeAnalyticsObjectId(params.listingId);
    const fellowshipId = sanitizeAnalyticsObjectId(params.fellowshipId);
    const entityType = sanitizeResearchEntityType(params.entityType);
    const entityId = sanitizeResearchEntityId(params.entityId);
    const dedupeKey = sanitizeAnalyticsDedupeKey(params.dedupeKey);
    const eventPayload: Record<string, unknown> = {
      eventType,
      netid,
      userType,
      searchQuery: sanitizeAnalyticsText(params.searchQuery),
      searchDepartments: sanitizeAnalyticsStringArray(params.searchDepartments),
      metadata: sanitizeAnalyticsMetadata(params.metadata),
      timestamp: new Date(),
    };
    if (listingId) eventPayload.listingId = listingId;
    if (fellowshipId) eventPayload.fellowshipId = fellowshipId;
    if (entityType) eventPayload.entityType = entityType;
    if (entityId) eventPayload.entityId = entityId;
    if (dedupeKey) eventPayload.dedupeKey = dedupeKey;

    if (dedupeKey) {
      const result = await AnalyticsEvent.updateOne(
        { netid, dedupeKey },
        { $setOnInsert: eventPayload },
        { upsert: true },
      );
      if (result.upsertedCount === 0) return;
    } else {
      await AnalyticsEvent.create(eventPayload);
    }

    const now = new Date();
    const updateFields: any = {
      lastActive: now,
    };

    if (eventType === AnalyticsEventType.LOGIN) {
      updateFields.lastLogin = now;
      updateFields.$inc = { loginCount: 1 };
    }

    if (isAnalyticsUserNetid(netid)) {
      User.findOneAndUpdate({ netid }, updateFields).catch((err: any) => {
        console.error('Error updating user metrics:', sanitizeLogValue(err));
      });
    }
  } catch (error) {
    console.error('Error logging analytics event:', sanitizeLogValue(error));
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
      $lookup: {
        from: 'analytics_events',
        let: { searchNetid: '$netid', searchAt: '$timestamp' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$netid', '$$searchNetid'] },
                  { $gt: ['$timestamp', '$$searchAt'] },
                  {
                    $lte: [
                      '$timestamp',
                      { $dateAdd: { startDate: '$$searchAt', unit: 'minute', amount: 30 } },
                    ],
                  },
                  {
                    $in: [
                      '$eventType',
                      [
                        AnalyticsEventType.SEARCH,
                        AnalyticsEventType.LISTING_VIEW,
                        AnalyticsEventType.LISTING_FAVORITE,
                        AnalyticsEventType.FELLOWSHIP_VIEW,
                        AnalyticsEventType.FELLOWSHIP_FAVORITE,
                        AnalyticsEventType.RESEARCH_VIEW,
                        AnalyticsEventType.PATHWAY_SAVE,
                      ],
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { timestamp: 1 } },
        ],
        as: 'attributionEvents',
      },
    },
    {
      $addFields: {
        nextSearchAt: {
          $min: {
            $map: {
              input: {
                $filter: {
                  input: '$attributionEvents',
                  as: 'event',
                  cond: { $eq: ['$$event.eventType', AnalyticsEventType.SEARCH] },
                },
              },
              as: 'event',
              in: '$$event.timestamp',
            },
          },
        },
      },
    },
    {
      $addFields: {
        hasAttributedAction: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: '$attributionEvents',
                  as: 'event',
                  cond: {
                    $and: [
                      { $ne: ['$$event.eventType', AnalyticsEventType.SEARCH] },
                      {
                        $or: [
                          { $eq: [{ $type: '$nextSearchAt' }, 'missing'] },
                          { $eq: ['$nextSearchAt', null] },
                          { $lt: ['$$event.timestamp', '$nextSearchAt'] },
                        ],
                      },
                    ],
                  },
                },
              },
            },
            0,
          ],
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
              engagedSearches: {
                $sum: {
                  $cond: [{ $and: [{ $gt: ['$resultCount', 0] }, '$hasAttributedAction'] }, 1, 0],
                },
              },
              returnedButIgnoredSearches: {
                $sum: {
                  $cond: [
                    { $and: [{ $gt: ['$resultCount', 0] }, { $not: ['$hasAttributedAction'] }] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              totalSearches: 1,
              zeroResultSearches: 1,
              uniqueSearchers: { $size: '$uniqueSearchers' },
              engagedSearches: 1,
              returnedButIgnoredSearches: 1,
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
    engagedSearches: 0,
    returnedButIgnoredSearches: 0,
  };
  const byQueryAndEntityType = (result?.byQueryAndEntityType ??
    []) as SearchQualityQueryAnalytics[];
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
    engagedSearches: overall.engagedSearches,
    returnedButIgnoredSearches: overall.returnedButIgnoredSearches,
    engagementRate:
      overall.totalSearches > 0
        ? Number((overall.engagedSearches / overall.totalSearches).toFixed(4))
        : 0,
    attributionWindowMinutes: 30,
  };
};

export const getSearchQueryAnalytics = async (
  range: AnalyticsDateRange = {},
  options: { limit?: number } = {},
): Promise<SearchQueryAnalytics> => {
  const limit = clampLimit(options.limit, 25, 100);
  const match: Record<string, any> = {
    eventType: AnalyticsEventType.SEARCH,
    ...buildRangeTimestampMatch(range),
  };

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $project: {
        netid: { $ifNull: ['$netid', 'unknown'] },
        userType: { $ifNull: ['$userType', 'unknown'] },
        normalizedQuery: { $trim: { input: { $ifNull: ['$searchQuery', ''] } } },
        resultCount: {
          $convert: {
            input: '$metadata.resultCount',
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
        timestamp: 1,
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
    { $sort: { query: 1, searchCount: -1, lastSearchedAt: -1, netid: 1 } },
    {
      $group: {
        _id: '$query',
        totalSearches: { $sum: '$searchCount' },
        zeroResultSearches: { $sum: '$zeroResultSearches' },
        resultCountTotal: { $sum: '$resultCountTotal' },
        uniqueSearchers: { $sum: 1 },
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
          $cond: [
            { $gt: ['$totalSearches', 0] },
            { $round: [{ $divide: ['$resultCountTotal', '$totalSearches'] }, 2] },
            0,
          ],
        },
        lastSearchedAt: 1,
        searchers: { $slice: ['$searchers', 8] },
      },
    },
    { $sort: { totalSearches: -1, zeroResultSearches: -1, lastSearchedAt: -1, query: 1 } },
    { $limit: limit },
  ];

  const queries = (await AnalyticsEvent.aggregate(pipeline)) as SearchQueryAnalyticsRow[];
  return { queries, limit };
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
            AnalyticsEventType.RESEARCH_SEARCH,
            AnalyticsEventType.RESEARCH_PROFILE_OPEN,
            AnalyticsEventType.RESEARCH_SOURCE_REVIEW,
            AnalyticsEventType.RESEARCH_SAVE,
            AnalyticsEventType.RESEARCH_COMPARE,
            AnalyticsEventType.RESEARCH_PLAN_UPDATE,
            AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
          ],
        },
        ...buildRangeTimestampMatch(range),
      },
    },
    {
      $group: {
        _id: {
          eventType: '$eventType',
          actionCategory: '$metadata.actionCategory',
        },
        uniqueNetids: { $addToSet: '$netid' },
      },
    },
    {
      $project: {
        _id: 0,
        eventType: '$_id.eventType',
        actionCategory: '$_id.actionCategory',
        count: { $size: '$uniqueNetids' },
      },
    },
  ]);

  const counts = rows.reduce(
    (
      result: Partial<Record<AnalyticsEventType, number>>,
      row: { eventType: AnalyticsEventType; count: number },
    ) => {
      result[row.eventType] = (result[row.eventType] || 0) + row.count;
      return result;
    },
    {},
  );
  const qualifiedActionRows = rows.filter(
    (row: { eventType: AnalyticsEventType }) =>
      row.eventType === AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
  );
  const countQualifiedCategories = (categories: string[]) =>
    qualifiedActionRows
      .filter((row: { actionCategory?: string }) => categories.includes(row.actionCategory || ''))
      .reduce((sum: number, row: { count: number }) => sum + row.count, 0);

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
    researchSearches: counts[AnalyticsEventType.RESEARCH_SEARCH] ?? 0,
    researchProfileOpens: counts[AnalyticsEventType.RESEARCH_PROFILE_OPEN] ?? 0,
    researchSaves: counts[AnalyticsEventType.RESEARCH_SAVE] ?? 0,
    researchComparisons: counts[AnalyticsEventType.RESEARCH_COMPARE] ?? 0,
    researchPlanUpdates: counts[AnalyticsEventType.RESEARCH_PLAN_UPDATE] ?? 0,
    sourceInspections: counts[AnalyticsEventType.RESEARCH_SOURCE_REVIEW] ?? 0,
    qualifiedActions: counts[AnalyticsEventType.RESEARCH_QUALIFIED_ACTION] ?? 0,
    officialRouteAttempts: countQualifiedCategories([
      'open_position',
      'official_application',
      'reviewed_route',
      'qualified_participation',
    ]),
    applicationOpens: countQualifiedCategories(['open_position', 'official_application']),
    confirmedOutcomes: counts[AnalyticsEventType.OUTREACH_OUTCOME] ?? 0,
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

  const listingCollectionName = getListingModel().collection.name;
  const listingsHighViewsLowFavorites = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: {
          $in: [AnalyticsEventType.LISTING_VIEW, AnalyticsEventType.LISTING_FAVORITE],
        },
        listingId: { $exists: true, $ne: null },
        ...buildRangeTimestampMatch(range),
      },
    },
    {
      $group: {
        _id: '$listingId',
        rangeViews: {
          $sum: { $cond: [{ $eq: ['$eventType', AnalyticsEventType.LISTING_VIEW] }, 1, 0] },
        },
        rangeFavorites: {
          $sum: {
            $cond: [{ $eq: ['$eventType', AnalyticsEventType.LISTING_FAVORITE] }, 1, 0],
          },
        },
      },
    },
    {
      $lookup: {
        from: listingCollectionName,
        localField: '_id',
        foreignField: '_id',
        as: 'listing',
      },
    },
    { $unwind: '$listing' },
    {
      $match: {
        rangeViews: { $gte: 3 },
        'listing.confirmed': true,
        'listing.archived': false,
      },
    },
    {
      $addFields: {
        favoriteRate: {
          $cond: [{ $gt: ['$rangeViews', 0] }, { $divide: ['$rangeFavorites', '$rangeViews'] }, 0],
        },
      },
    },
    { $sort: { favoriteRate: 1, rangeViews: -1, 'listing.views': -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        listingId: { $toString: '$_id' },
        title: '$listing.title',
        ownerFirstName: '$listing.ownerFirstName',
        ownerLastName: '$listing.ownerLastName',
        departments: '$listing.departments',
        rangeViews: 1,
        rangeFavorites: 1,
        lifetimeViews: { $ifNull: ['$listing.views', 0] },
        lifetimeFavorites: { $ifNull: ['$listing.favorites', 0] },
        favoriteRate: { $round: ['$favoriteRate', 4] },
      },
    },
  ]);

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
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

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

  const researchEventTypes = [
    AnalyticsEventType.RESEARCH_VIEW,
    AnalyticsEventType.PATHWAY_SAVE,
    AnalyticsEventType.WAYS_IN_CLICK,
    AnalyticsEventType.CONTACT_ROUTE_CLICK,
    AnalyticsEventType.SOURCE_LINK_CLICK,
    AnalyticsEventType.RESEARCH_SEARCH,
    AnalyticsEventType.RESEARCH_ENTITY_IMPRESSION,
    AnalyticsEventType.RESEARCH_PROFILE_OPEN,
    AnalyticsEventType.RESEARCH_SOURCE_REVIEW,
    AnalyticsEventType.RESEARCH_FILTER_CHANGE,
    AnalyticsEventType.RESEARCH_SAVE,
    AnalyticsEventType.RESEARCH_COMPARE,
    AnalyticsEventType.RESEARCH_PLAN_UPDATE,
    AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
  ];
  const researchStats = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: { $in: researchEventTypes },
      },
    },
    {
      $facet: {
        byEventType: [
          {
            $group: {
              _id: '$eventType',
              total: { $sum: 1 },
              last7Days: {
                $sum: { $cond: [{ $gte: ['$timestamp', sevenDaysAgo] }, 1, 0] },
              },
              today: {
                $sum: { $cond: [{ $gte: ['$timestamp', today] }, 1, 0] },
              },
            },
          },
          { $sort: { total: -1, _id: 1 } },
          {
            $project: {
              _id: 0,
              eventType: '$_id',
              total: 1,
              last7Days: 1,
              today: 1,
            },
          },
        ],
        byEntityType: [
          {
            $match: {
              entityType: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: { entityType: '$entityType', eventType: '$eventType' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, '_id.entityType': 1, '_id.eventType': 1 } },
          {
            $project: {
              _id: 0,
              entityType: '$_id.entityType',
              eventType: '$_id.eventType',
              count: 1,
            },
          },
        ],
        byUserType: [
          {
            $group: {
              _id: '$userType',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          {
            $project: {
              _id: 0,
              userType: '$_id',
              count: 1,
            },
          },
        ],
        topEntities: [
          {
            $match: {
              eventType: AnalyticsEventType.RESEARCH_VIEW,
              timestamp: { $gte: thirtyDaysAgo },
              entityType: { $exists: true, $ne: null },
              entityId: { $exists: true, $ne: '' },
            },
          },
          {
            $group: {
              _id: { entityType: '$entityType', entityId: '$entityId' },
              views: { $sum: 1 },
              uniqueViewers: { $addToSet: '$netid' },
            },
          },
          {
            $project: {
              _id: 0,
              entityType: '$_id.entityType',
              entityId: '$_id.entityId',
              views: 1,
              uniqueViewers: { $size: '$uniqueViewers' },
            },
          },
          { $sort: { views: -1, uniqueViewers: -1, entityType: 1, entityId: 1 } },
          { $limit: 10 },
        ],
      },
    },
  ]);

  const listingStats = await getListingModel().aggregate([
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: {
                $sum: {
                  $cond: [
                    { $and: [{ $eq: ['$archived', false] }, { $eq: ['$confirmed', true] }] },
                    1,
                    0,
                  ],
                },
              },
              archived: { $sum: { $cond: ['$archived', 1, 0] } },
              unconfirmed: { $sum: { $cond: ['$confirmed', 0, 1] } },
            },
          },
        ],
        newListingsLast7Days: [
          {
            $match: {
              createdAt: { $gte: sevenDaysAgo },
            },
          },
          { $count: 'count' },
        ],
        newListingsToday: [
          {
            $match: {
              createdAt: { $gte: today },
            },
          },
          { $count: 'count' },
        ],
        listingsByDepartment: [
          { $match: { archived: false, confirmed: true } },
          { $unwind: '$departments' },
          {
            $group: {
              _id: '$departments',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          {
            $project: {
              _id: 0,
              department: '$_id',
              count: 1,
            },
          },
        ],
        listingsPerProfessor: [
          { $match: { archived: false, confirmed: true } },
          {
            $group: {
              _id: {
                ownerId: '$ownerId',
                ownerFirstName: '$ownerFirstName',
                ownerLastName: '$ownerLastName',
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 20 },
          {
            $project: {
              _id: 0,
              professorName: {
                $concat: ['$_id.ownerFirstName', ' ', '$_id.ownerLastName'],
              },
              netId: '$_id.ownerId',
              count: 1,
            },
          },
        ],
        viewsAndFavorites: [
          {
            $group: {
              _id: null,
              totalViews: { $sum: '$views' },
              totalFavorites: { $sum: '$favorites' },
              avgViews: { $avg: '$views' },
              avgFavorites: { $avg: '$favorites' },
            },
          },
        ],
        topViewedListings: [
          { $match: { confirmed: true, archived: false } },
          { $sort: { views: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 1,
              title: 1,
              ownerFirstName: 1,
              ownerLastName: 1,
              views: 1,
              departments: 1,
            },
          },
        ],
        topFavoritedListings: [
          { $match: { confirmed: true, archived: false } },
          { $sort: { favorites: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 1,
              title: 1,
              ownerFirstName: 1,
              ownerLastName: 1,
              favorites: 1,
              departments: 1,
            },
          },
        ],
        viewsByDepartment: [
          { $match: { confirmed: true, archived: false } },
          { $unwind: '$departments' },
          {
            $group: {
              _id: '$departments',
              totalViews: { $sum: '$views' },
              listingCount: { $sum: 1 },
              avgViews: { $avg: '$views' },
            },
          },
          { $sort: { totalViews: -1 } },
          {
            $project: {
              _id: 0,
              department: '$_id',
              totalViews: 1,
              listingCount: 1,
              avgViews: { $round: ['$avgViews', 2] },
            },
          },
        ],
        listingsWithZeroViews: [
          { $match: { views: 0, confirmed: true, archived: false } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  const outreachEventTypes = [
    AnalyticsEventType.OUTREACH_CONTACT_REVEAL,
    AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT,
    AnalyticsEventType.OUTREACH_OUTCOME,
  ];
  const outreachStats = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: { $in: outreachEventTypes },
      },
    },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalReveals: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AnalyticsEventType.OUTREACH_CONTACT_REVEAL] },
                    1,
                    0,
                  ],
                },
              },
              totalAttempts: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT] },
                    1,
                    0,
                  ],
                },
              },
              totalOutcomes: {
                $sum: {
                  $cond: [{ $eq: ['$eventType', AnalyticsEventType.OUTREACH_OUTCOME] }, 1, 0],
                },
              },
              revealsLast7Days: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$eventType', AnalyticsEventType.OUTREACH_CONTACT_REVEAL] },
                        { $gte: ['$timestamp', sevenDaysAgo] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              attemptsLast7Days: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$eventType', AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT] },
                        { $gte: ['$timestamp', sevenDaysAgo] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              outcomesLast7Days: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$eventType', AnalyticsEventType.OUTREACH_OUTCOME] },
                        { $gte: ['$timestamp', sevenDaysAgo] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        byOutcome: [
          {
            $match: {
              eventType: AnalyticsEventType.OUTREACH_OUTCOME,
              'metadata.outcome': { $exists: true },
            },
          },
          {
            $group: {
              _id: '$metadata.outcome',
              count: { $sum: 1 },
              last7Days: {
                $sum: { $cond: [{ $gte: ['$timestamp', sevenDaysAgo] }, 1, 0] },
              },
            },
          },
          { $sort: { count: -1 } },
          {
            $project: {
              _id: 0,
              outcome: '$_id',
              count: 1,
              last7Days: 1,
            },
          },
        ],
        topListings: [
          {
            $match: {
              listingId: { $exists: true },
            },
          },
          {
            $group: {
              _id: '$listingId',
              reveals: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AnalyticsEventType.OUTREACH_CONTACT_REVEAL] },
                    1,
                    0,
                  ],
                },
              },
              attempts: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT] },
                    1,
                    0,
                  ],
                },
              },
              outcomes: {
                $sum: {
                  $cond: [{ $eq: ['$eventType', AnalyticsEventType.OUTREACH_OUTCOME] }, 1, 0],
                },
              },
              uniqueUsers: { $addToSet: '$netid' },
              lastEventAt: { $max: '$timestamp' },
            },
          },
          {
            $project: {
              listingId: '$_id',
              reveals: 1,
              attempts: 1,
              outcomes: 1,
              uniqueUsers: { $size: '$uniqueUsers' },
              lastEventAt: 1,
            },
          },
          { $sort: { attempts: -1, reveals: -1, lastEventAt: -1 } },
          { $limit: 10 },
        ],
        recentEvents: [
          {
            $match: {
              eventType: {
                $in: [
                  AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT,
                  AnalyticsEventType.OUTREACH_OUTCOME,
                ],
              },
            },
          },
          { $sort: { timestamp: -1 } },
          { $limit: 20 },
          {
            $project: {
              _id: 0,
              eventType: 1,
              netid: 1,
              userType: 1,
              listingId: 1,
              outcome: '$metadata.outcome',
              channel: '$metadata.channel',
              timestamp: 1,
            },
          },
        ],
      },
    },
  ]);

  const userStats = await User.aggregate([
    {
      $match: appUserAccountMatch(),
    },
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

  // Scraped-data coverage. The product's primary value is the materialized
  // ResearchEntity corpus, not the legacy posted-opportunity (listing) supply,
  // so the dashboard leads with how complete and fresh that corpus is.
  // "Active" means not archived (archived: { $ne: true }) — the canonical
  // active filter for research entities.
  const researchEntityStats = await ResearchEntity.aggregate([
    { $match: { archived: { $ne: true } } },
    {
      $facet: {
        overview: [{ $group: { _id: null, total: { $sum: 1 } } }],
        byType: [
          { $group: { _id: '$entityType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $project: { _id: 0, entityType: '$_id', count: 1 } },
        ],
        byVisibilityTier: [
          { $group: { _id: '$studentVisibilityTier', count: { $sum: 1 } } },
          { $project: { _id: 0, tier: '$_id', count: 1 } },
        ],
        byOpenness: [
          { $group: { _id: '$opennessStatusCache', count: { $sum: 1 } } },
          { $project: { _id: 0, status: '$_id', count: 1 } },
        ],
        freshness: [
          {
            $group: {
              _id: null,
              observedLast7Days: {
                $sum: { $cond: [{ $gte: ['$lastObservedAt', sevenDaysAgo] }, 1, 0] },
              },
              observedLast30Days: {
                $sum: { $cond: [{ $gte: ['$lastObservedAt', thirtyDaysAgo] }, 1, 0] },
              },
              neverObserved: {
                $sum: {
                  $cond: [{ $eq: [{ $ifNull: ['$lastObservedAt', null] }, null] }, 1, 0],
                },
              },
              staleOver90Days: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: [{ $ifNull: ['$lastObservedAt', null] }, null] },
                        { $lt: ['$lastObservedAt', ninetyDaysAgo] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        scholarly: [
          {
            $group: {
              _id: null,
              withRecentPapers: {
                $sum: { $cond: [{ $gt: ['$recentPaperCount', 0] }, 1, 0] },
              },
              withRecentGrants: {
                $sum: { $cond: [{ $gt: ['$recentGrantCount', 0] }, 1, 0] },
              },
            },
          },
        ],
      },
    },
  ]);

  const archivedResearchEntityCount = await ResearchEntity.countDocuments({ archived: true });

  const visitors = visitorStats[0];
  const engagement = engagementStats[0];
  const listings = listingStats[0];
  const outreach = outreachStats[0] || {};
  const users = userStats[0];
  const research = researchStats[0];
  const researchEntities = researchEntityStats[0];
  const activeResearchEntityCount = researchEntities.overview[0]?.total || 0;

  const trendingListingIds = engagement.trendingListings
    .map((t: any) => normalizeAnalyticsStoredObjectIdString(t.listingId))
    .filter((id: string | undefined): id is string => Boolean(id));
  const trendingListingsData = await getListingModel()
    .find({ _id: { $in: trendingListingIds.map((id: string) => new Types.ObjectId(id)) } })
    .lean();
  const trendingListingsById = new Map(
    trendingListingsData
      .map(
        (listing: any) => [normalizeAnalyticsStoredObjectIdString(listing._id), listing] as const,
      )
      .filter(([id]) => Boolean(id)),
  );
  const enrichedTrending = engagement.trendingListings.map((t: any) => {
    const listingId = normalizeAnalyticsStoredObjectIdString(t.listingId);
    const listing = listingId ? trendingListingsById.get(listingId) : undefined;
    return {
      ...t,
      listingId,
      title: listing?.title,
      ownerFirstName: listing?.ownerFirstName,
      ownerLastName: listing?.ownerLastName,
      departments: listing?.departments,
    };
  });

  const outreachListingIds = [
    ...(outreach.topListings || []).map((item: any) => item.listingId),
    ...(outreach.recentEvents || []).map((item: any) => item.listingId),
  ].filter(Boolean);
  const outreachListingsData = await getListingModel()
    .find({ _id: { $in: outreachListingIds } })
    .select('title ownerFirstName ownerLastName departments')
    .lean();
  const findOutreachListing = (listingId: any) =>
    outreachListingsData.find((listing: any) => listing._id.toString() === listingId.toString());
  const enrichOutreachListing = (item: any) => {
    const listing = findOutreachListing(item.listingId);
    return {
      ...item,
      listingId: item.listingId?.toString(),
      title: listing?.title,
      ownerFirstName: listing?.ownerFirstName,
      ownerLastName: listing?.ownerLastName,
      departments: listing?.departments || [],
    };
  };

  return {
    visitors: {
      lifetime: {
        total: visitors.lifetimeVisitors[0]?.total || 0,
        byType: combineAnalyticsUserTypeCounts(visitors.lifetimeVisitorsByType || []),
      },
      last7Days: {
        total: visitors.last7DaysVisitors[0]?.total || 0,
        byType: combineAnalyticsUserTypeCounts(visitors.last7DaysVisitorsByType || []),
      },
      today: {
        total: visitors.todayVisitors[0]?.total || 0,
        byType: combineAnalyticsUserTypeCounts(visitors.todayVisitorsByType || []),
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
      outreach: {
        summary: outreach.summary?.[0] || {
          totalReveals: 0,
          totalAttempts: 0,
          totalOutcomes: 0,
          revealsLast7Days: 0,
          attemptsLast7Days: 0,
          outcomesLast7Days: 0,
        },
        byOutcome: outreach.byOutcome || [],
        topListings: (outreach.topListings || []).map(enrichOutreachListing),
        recentEvents: (outreach.recentEvents || []).map(enrichOutreachListing),
      },
      totalViewsFromCounters: listings.viewsAndFavorites[0]?.totalViews || 0,
      totalFavoritesFromCounters: listings.viewsAndFavorites[0]?.totalFavorites || 0,
      avgViews: listings.viewsAndFavorites[0]?.avgViews || 0,
      avgFavorites: listings.viewsAndFavorites[0]?.avgFavorites || 0,
      viewsByDepartment: listings.viewsByDepartment || [],
    },
    research: {
      byEventType: research.byEventType || [],
      byEntityType: research.byEntityType || [],
      byUserType: combineAnalyticsUserTypeCounts(research.byUserType || []),
      topEntities: research.topEntities || [],
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
      byType: combineAnalyticsUserTypeCounts(users.byType || []),
      newUsersLast7Days: users.newUsersLast7Days[0]?.count || 0,
      newUsersToday: users.newUsersToday[0]?.count || 0,
      newUsersTodayByType: combineAnalyticsUserTypeCounts(users.newUsersTodayByType || []),
    },
    researchEntities: {
      overview: {
        active: activeResearchEntityCount,
        archived: archivedResearchEntityCount,
        total: activeResearchEntityCount + archivedResearchEntityCount,
      },
      byType: researchEntities.byType || [],
      byVisibilityTier: researchEntities.byVisibilityTier || [],
      byOpenness: researchEntities.byOpenness || [],
      freshness: researchEntities.freshness[0] || {
        observedLast7Days: 0,
        observedLast30Days: 0,
        neverObserved: 0,
        staleOver90Days: 0,
      },
      scholarly: researchEntities.scholarly[0] || {
        withRecentPapers: 0,
        withRecentGrants: 0,
      },
    },
    timestamp: now.toISOString(),
  };
};
