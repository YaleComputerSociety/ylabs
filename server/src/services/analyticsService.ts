/**
 * Analytics event logging and aggregation service.
 */
import { AnalyticsEvent, AnalyticsEventType, RESEARCH_ENTITY_TYPES } from '../models/analytics';
import { ResearchEntity, Fellowship } from '../models/index';
import { Account } from '../models/account';
import { Researcher } from '../models/researcher';
import { Types, type PipelineStage } from 'mongoose';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeLogValue } from '../utils/logSanitizer';

export interface LogEventParams {
  eventType: AnalyticsEventType;
  netid: string;
  userType?: string;
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
  const fellowshipId = normalizeAnalyticsStoredObjectIdString(event?.fellowshipId);
  const searchQuery = sanitizeAnalyticsText(event?.searchQuery);
  const searchDepartments = sanitizeAnalyticsStringArray(event?.searchDepartments);
  const metadata = sanitizeAnalyticsMetadata(event?.metadata);

  return {
    id: normalizeAnalyticsStoredObjectIdString(event?._id) || '',
    eventType,
    userType: sanitizeAnalyticsUserType(event?.userType),
    ...(fellowshipId ? { fellowshipId } : {}),
    ...(searchQuery !== undefined ? { searchQuery } : {}),
    ...(searchDepartments !== undefined ? { searchDepartments } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    timestamp: event?.timestamp instanceof Date ? event.timestamp : new Date(event?.timestamp || 0),
  };
};

export type AnalyticsUserSort =
  | 'lastActive'
  | 'totalEvents'
  | 'logins'
  | 'searches'
  | 'researchViews';
export type AnalyticsSortDirection = 'asc' | 'desc';

export interface AnalyticsUsersQuery {
  userType?: string;
  activeSince?: string;
  search?: string;
  sort?: AnalyticsUserSort;
  direction?: AnalyticsSortDirection;
  limit?: number;
  offset?: number;
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
  researchViews: number;
  fellowshipViews: number;
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
  offset: number;
}

export interface AnalyticsUserTypeCount {
  userType: string;
  count: number;
}

export interface AnalyticsUserEvent {
  id: string;
  eventType: AnalyticsEventType;
  userType: string;
  fellowshipId?: string;
  fellowshipTitle?: string;
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
  fellowshipViews: number;
  researchSearches: number;
  researchProfileOpens: number;
  researchSaves: number;
  researchComparisons: number;
  researchPlanUpdates: number;
  sourceInspections: number;
  qualifiedActions: number;
  officialRouteAttempts: number;
  applicationOpens: number;
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

export interface ActionNeededAnalytics {
  highSearchLowResults: HighSearchLowResultsAction[];
}

const USER_ANALYTICS_SORTS = new Set<AnalyticsUserSort>([
  'lastActive',
  'totalEvents',
  'logins',
  'searches',
  'researchViews',
]);

const CANONICAL_ACADEMIC_USER_TYPE = 'professor';
const LEGACY_ACADEMIC_USER_TYPES = [CANONICAL_ACADEMIC_USER_TYPE, 'faculty'];

const appUserAccountMatch = (): PipelineStage.Match['$match'] => ({
  archived: { $ne: true },
  lastLoginAt: { $exists: true, $ne: null },
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
  researchViews: AnalyticsEventType.RESEARCH_VIEW,
  fellowshipViews: AnalyticsEventType.FELLOWSHIP_VIEW,
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

const toAnalyticsObjectIds = (ids: string[]): Types.ObjectId[] =>
  ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

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

const MAX_USER_ANALYTICS_OFFSET = 100_000;

const clampOffset = (value: unknown): number => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Invalid offset');
  }

  return Math.min(Math.floor(parsed), MAX_USER_ANALYTICS_OFFSET);
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

/**
 * Joins at most one foreign document, and never joins on an absent key.
 *
 * Two guards, both load bearing. A `localField` join coerces an absent key to
 * null and matches every foreign document whose key is also null, so the join
 * requires the foreign key to be present and correctly typed - null can then
 * never find a partner. Taking `$first` rather than `$unwind` keeps a duplicate
 * on the foreign side from multiplying the row. Keying off `localField` rather
 * than a correlated `$expr` keeps the join index-eligible.
 */
const singleMatchLookupStages = (input: {
  from: string;
  localField: string;
  foreignField: string;
  foreignFieldType: 'string' | 'objectId';
  project: Record<string, 1>;
  as: string;
}): PipelineStage.FacetPipelineStage[] => {
  const matchesField = `${input.as}LookupMatches`;

  return [
    {
      $lookup: {
        from: input.from,
        localField: input.localField,
        foreignField: input.foreignField,
        as: matchesField,
        pipeline: [
          { $match: { [input.foreignField]: { $type: input.foreignFieldType } } },
          { $project: input.project },
        ],
      },
    },
    { $addFields: { [input.as]: { $first: `$${matchesField}` } } },
    { $project: { [matchesField]: 0 } },
  ];
};

const accountByNetidLookupStages = (netidField: string): PipelineStage.FacetPipelineStage[] =>
  singleMatchLookupStages({
    from: 'accounts',
    localField: netidField,
    foreignField: 'netid',
    foreignFieldType: 'string',
    project: { email: 1, createdAt: 1, lastLoginAt: 1 },
    as: 'account',
  });

/**
 * Joins the researcher profile for an account, if any.
 *
 * Analytics rows routinely have no account, and an unguarded
 * `localField: 'account._id'` join then matches every accountless researcher
 * shell, multiplying each row thousands of times and inflating every
 * downstream count.
 */
const researcherByAccountLookupStages = (
  accountIdField: string,
): PipelineStage.FacetPipelineStage[] =>
  singleMatchLookupStages({
    from: 'researchers',
    localField: accountIdField,
    foreignField: 'accountId',
    foreignFieldType: 'objectId',
    project: { displayName: 1 },
    as: 'researcher',
  });

const userSummaryPipeline = (netid?: string, query: AnalyticsUsersQuery = {}): PipelineStage[] => {
  const activeSince = parseActiveSince(query.activeSince);
  const limit = clampLimit(query.limit, 50, 200);
  const offset = clampOffset(query.offset);
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
    ...accountByNetidLookupStages('_id'),
    ...researcherByAccountLookupStages('account._id'),
    {
      $addFields: {
        netid: '$_id',
        userType: '$analyticsUserType',
        displayName: '$researcher.displayName',
        email: '$account.email',
        firstSeen: { $ifNull: ['$account.createdAt', '$firstEventAt'] },
        lastActive: { $ifNull: ['$account.lastLoginAt', '$lastEventAt'] },
        lastLogin: '$account.lastLoginAt',
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
      { displayName: searchRegex },
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
        displayName: 1,
        email: 1,
        totalEvents: 1,
        logins: 1,
        searches: 1,
        researchViews: 1,
        fellowshipViews: 1,
        profileUpdates: 1,
        firstSeen: 1,
        lastEventAt: 1,
        lastActive: 1,
        lastLogin: 1,
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
        users: offset > 0 ? [{ $skip: offset }, { $limit: limit }] : [{ $limit: limit }],
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
  const offset = clampOffset(query.offset);
  const [result] = await AnalyticsEvent.aggregate(
    userSummaryPipeline(undefined, { ...query, limit, offset }),
  );

  return {
    users: result?.users ?? [],
    total: result?.total ?? 0,
    limit,
    offset,
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

  const publicEvents = events.map(publicAnalyticsUserEvent);
  const fellowshipIds = Array.from(
    new Set(
      publicEvents.map((event) => event.fellowshipId).filter((id): id is string => Boolean(id)),
    ),
  );
  const drilldownFellowships = fellowshipIds.length
    ? await Fellowship.find({ _id: { $in: toAnalyticsObjectIds(fellowshipIds) } })
        .select('title')
        .lean()
    : [];
  const fellowshipTitleById = new Map(
    (drilldownFellowships as Array<{ _id: unknown; title?: string }>).map(
      (fellowship) => [String(fellowship._id), fellowship.title] as const,
    ),
  );
  const enrichedEvents = publicEvents.map((event) => {
    const fellowshipTitle = event.fellowshipId
      ? fellowshipTitleById.get(event.fellowshipId)
      : undefined;
    return {
      ...event,
      ...(fellowshipTitle ? { fellowshipTitle } : {}),
    };
  });

  return {
    user,
    events: enrichedEvents,
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
  } catch (error) {
    console.error('Error logging analytics event:', sanitizeLogValue(error));
  }
};

const SEARCH_ATTRIBUTION_WINDOW_MINUTES = 30;

const SEARCH_ATTRIBUTION_EVENT_TYPES = [
  AnalyticsEventType.SEARCH,
  AnalyticsEventType.FELLOWSHIP_VIEW,
  AnalyticsEventType.RESEARCH_VIEW,
  AnalyticsEventType.PATHWAY_SAVE,
];

const ANALYTICS_CACHE_TTL_MS = 30 * 1000;

interface RangeCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const rangeCacheKey = (range: AnalyticsDateRange): string => {
  const bucket = (value?: Date): string =>
    value instanceof Date && !Number.isNaN(value.getTime())
      ? String(Math.floor(value.getTime() / ANALYTICS_CACHE_TTL_MS))
      : 'none';
  return `${bucket(range.start)}:${bucket(range.end)}`;
};

const createRangeTtlCache = <T>() => {
  const store = new Map<string, RangeCacheEntry<T>>();

  const load = async (range: AnalyticsDateRange, compute: () => Promise<T>): Promise<T> => {
    const key = rangeCacheKey(range);
    const now = Date.now();
    const cached = store.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await compute();
    store.set(key, { value, expiresAt: now + ANALYTICS_CACHE_TTL_MS });

    for (const [existingKey, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(existingKey);
      }
    }

    return value;
  };

  const clear = (): void => {
    store.clear();
  };

  return { load, clear };
};

const computeSearchQualityAnalytics = async (
  range: AnalyticsDateRange = {},
): Promise<SearchQualityAnalytics> => {
  const [result] = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: { $in: SEARCH_ATTRIBUTION_EVENT_TYPES },
        ...buildRangeTimestampMatch(range),
      },
    },
    {
      $setWindowFields: {
        partitionBy: '$netid',
        sortBy: { timestamp: 1 },
        output: {
          forwardEvents: {
            $push: { eventType: '$eventType', timestamp: '$timestamp' },
            window: { range: [0, SEARCH_ATTRIBUTION_WINDOW_MINUTES], unit: 'minute' },
          },
        },
      },
    },
    {
      $match: {
        eventType: AnalyticsEventType.SEARCH,
      },
    },
    {
      $addFields: {
        normalizedQuery: { $trim: { input: { $ifNull: ['$searchQuery', ''] } } },
        searchEntityType: { $ifNull: ['$metadata.entityType', 'unknown'] },
        resultCount: {
          $convert: {
            input: '$metadata.resultCount',
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
        attributionEvents: {
          $filter: {
            input: '$forwardEvents',
            as: 'event',
            cond: {
              $and: [
                { $gt: ['$$event.timestamp', '$timestamp'] },
                {
                  $lte: [
                    '$$event.timestamp',
                    {
                      $dateAdd: {
                        startDate: '$timestamp',
                        unit: 'minute',
                        amount: SEARCH_ATTRIBUTION_WINDOW_MINUTES,
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
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
    ...accountByNetidLookupStages('_id.netid'),
    ...researcherByAccountLookupStages('account._id'),
    {
      $project: {
        _id: 0,
        query: '$_id.query',
        netid: '$_id.netid',
        userType: '$userType',
        displayName: '$researcher.displayName',
        email: '$account.email',
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
            displayName: '$displayName',
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
  const [facet] = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: {
          $in: [
            AnalyticsEventType.LOGIN,
            AnalyticsEventType.SEARCH,
            AnalyticsEventType.FELLOWSHIP_VIEW,
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
      $facet: {
        uniqueActorsByEventType: [
          { $group: { _id: { eventType: '$eventType', netid: '$netid' } } },
          { $group: { _id: '$_id.eventType', count: { $sum: 1 } } },
          { $project: { _id: 0, eventType: '$_id', count: 1 } },
        ],
        qualifiedActorsByCategory: [
          { $match: { eventType: AnalyticsEventType.RESEARCH_QUALIFIED_ACTION } },
          { $group: { _id: { actionCategory: '$metadata.actionCategory', netid: '$netid' } } },
          {
            $group: {
              _id: '$_id.actionCategory',
              uniqueNetids: { $addToSet: '$_id.netid' },
            },
          },
          { $project: { _id: 0, actionCategory: '$_id', uniqueNetids: 1 } },
        ],
      },
    },
  ]);

  const uniqueActorsByEventType = (facet?.uniqueActorsByEventType ?? []) as Array<{
    eventType: AnalyticsEventType;
    count: number;
  }>;
  const qualifiedActorsByCategory = (facet?.qualifiedActorsByCategory ?? []) as Array<{
    actionCategory?: string;
    uniqueNetids: string[];
  }>;

  const counts = uniqueActorsByEventType.reduce(
    (result: Partial<Record<AnalyticsEventType, number>>, row) => {
      result[row.eventType] = row.count;
      return result;
    },
    {},
  );
  const countQualifiedCategories = (categories: string[]) =>
    new Set(
      qualifiedActorsByCategory
        .filter((row) => categories.includes(row.actionCategory || ''))
        .flatMap((row) => row.uniqueNetids),
    ).size;
  const qualifiedActions = countQualifiedCategories([
    'open_position',
    'official_application',
    'reviewed_route',
    'qualified_participation',
  ]);

  return {
    logins: counts[AnalyticsEventType.LOGIN] ?? 0,
    searches: counts[AnalyticsEventType.SEARCH] ?? 0,
    fellowshipViews: counts[AnalyticsEventType.FELLOWSHIP_VIEW] ?? 0,
    researchSearches: counts[AnalyticsEventType.RESEARCH_SEARCH] ?? 0,
    researchProfileOpens: counts[AnalyticsEventType.RESEARCH_PROFILE_OPEN] ?? 0,
    researchSaves: counts[AnalyticsEventType.RESEARCH_SAVE] ?? 0,
    researchComparisons: counts[AnalyticsEventType.RESEARCH_COMPARE] ?? 0,
    researchPlanUpdates: counts[AnalyticsEventType.RESEARCH_PLAN_UPDATE] ?? 0,
    sourceInspections: counts[AnalyticsEventType.RESEARCH_SOURCE_REVIEW] ?? 0,
    qualifiedActions,
    officialRouteAttempts: countQualifiedCategories([
      'open_position',
      'official_application',
      'reviewed_route',
    ]),
    applicationOpens: countQualifiedCategories(['open_position', 'official_application']),
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

  return {
    highSearchLowResults,
  };
};

const computeAnalytics = async (range: AnalyticsDateRange = {}) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const rangeTimestampMatch = buildRangeTimestampMatch(range);

  const visitorStats = await AnalyticsEvent.aggregate([
    {
      $match: {
        eventType: { $in: [AnalyticsEventType.LOGIN, AnalyticsEventType.VISITOR] },
        ...rangeTimestampMatch,
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
              _id: '$netid',
              userType: { $first: '$userType' },
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
              _id: '$netid',
              userType: { $first: '$userType' },
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
              _id: '$netid',
              userType: { $first: '$userType' },
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
    { $match: { ...rangeTimestampMatch } },
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
        userActivityStats: [
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
            $group: {
              _id: { netid: '$netid', userType: '$userType' },
              eventCount: { $sum: 1 },
            },
          },
          { $sort: { eventCount: -1 } },
          { $limit: 10 },
          ...accountByNetidLookupStages('_id.netid'),
          ...researcherByAccountLookupStages('account._id'),
          {
            $project: {
              _id: 0,
              userId: '$_id.netid',
              userType: '$_id.userType',
              eventCount: 1,
              displayName: '$researcher.displayName',
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
        ...rangeTimestampMatch,
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

  const userStats = await Account.aggregate([
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
              confirmed: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
            },
          },
        ],
        byType: [{ $match: { _id: { $exists: false } } }],
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
        newUsersTodayByType: [{ $match: { _id: { $exists: false } } }],
      },
    },
  ]);

  // Scraped-data coverage. The product's primary value is the materialized
  // ResearchEntity corpus, not the legacy posted-opportunity (listing) supply,
  // so the dashboard leads with how complete and fresh that corpus is.
  // "Active" means not archived (archived: { $ne: true }) — the canonical
  // active filter for research entities.
  const activeResearchEntityMatch = { $match: { archived: { $ne: true } } };
  const researchEntityStats = await ResearchEntity.aggregate([
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $ne: ['$archived', true] }, 1, 0] } },
            },
          },
        ],
        byType: [
          activeResearchEntityMatch,
          { $group: { _id: '$entityType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $project: { _id: 0, entityType: '$_id', count: 1 } },
        ],
        byVisibilityTier: [
          activeResearchEntityMatch,
          { $group: { _id: '$studentVisibilityTier', count: { $sum: 1 } } },
          { $project: { _id: 0, tier: '$_id', count: 1 } },
        ],
        freshness: [
          activeResearchEntityMatch,
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
          activeResearchEntityMatch,
          {
            $group: {
              _id: null,
              withRecentGrants: {
                $sum: { $cond: [{ $gt: ['$recentGrantCount', 0] }, 1, 0] },
              },
            },
          },
        ],
      },
    },
  ]);

  const visitors = visitorStats[0];
  const engagement = engagementStats[0];
  const users = userStats[0];
  const research = researchStats[0];
  const researchEntities = researchEntityStats[0];
  const researchEntityOverview = researchEntities.overview[0] || { total: 0, active: 0 };
  const activeResearchEntityCount = researchEntityOverview.active || 0;
  const totalResearchEntityCount = researchEntityOverview.total || 0;

  const topEntitiesRaw = (research.topEntities || []) as Array<{
    entityType: string;
    entityId: string;
    views: number;
    uniqueViewers: number;
  }>;
  const topEntityIdsFor = (entityType: string): string[] =>
    topEntitiesRaw
      .filter((entity) => entity.entityType === entityType)
      .map((entity) => entity.entityId);
  const [topResearchEntityDocs, topFellowshipDocs, topProfileDocs] = await Promise.all([
    topEntityIdsFor('research_entity').length
      ? ResearchEntity.find({
          _id: { $in: toAnalyticsObjectIds(topEntityIdsFor('research_entity')) },
        })
          .select('name displayName slug')
          .lean()
      : Promise.resolve([]),
    topEntityIdsFor('fellowship').length
      ? Fellowship.find({ _id: { $in: toAnalyticsObjectIds(topEntityIdsFor('fellowship')) } })
          .select('title')
          .lean()
      : Promise.resolve([]),
    topEntityIdsFor('profile').length
      ? (async () => {
          const accounts = await Account.find({ netid: { $in: topEntityIdsFor('profile') } })
            .select('netid _id')
            .lean();
          const netidByAccountId = new Map(
            accounts.map((account: any) => [String(account._id), account.netid] as const),
          );
          const researchers = await Researcher.find({
            accountId: { $in: accounts.map((account: any) => account._id) },
          })
            .select('accountId displayName')
            .lean();
          return researchers
            .map((researcher: any) => ({
              netid: netidByAccountId.get(String(researcher.accountId)),
              fname: researcher.displayName,
              lname: '',
            }))
            .filter((row) => Boolean(row.netid));
        })()
      : Promise.resolve([]),
  ]);
  const researchEntityById = new Map(
    (
      topResearchEntityDocs as Array<{
        _id: unknown;
        name?: string;
        displayName?: string;
        slug?: string;
      }>
    ).map((doc) => [String(doc._id), doc] as const),
  );
  const fellowshipTitleById = new Map(
    (topFellowshipDocs as Array<{ _id: unknown; title?: string }>).map(
      (doc) => [String(doc._id), doc.title] as const,
    ),
  );
  const profileByNetid = new Map(
    (topProfileDocs as Array<{ netid: string; fname?: string; lname?: string }>).map(
      (doc) => [doc.netid, doc] as const,
    ),
  );
  const enrichedTopEntities = topEntitiesRaw.map((entity) => {
    let name: string | undefined;
    let href: string | undefined;
    switch (entity.entityType) {
      case 'research_entity': {
        const doc = researchEntityById.get(entity.entityId);
        name = doc?.displayName || doc?.name;
        if (doc?.slug) href = `/research/${doc.slug}`;
        break;
      }
      case 'fellowship': {
        name = fellowshipTitleById.get(entity.entityId);
        break;
      }
      case 'profile': {
        const doc = profileByNetid.get(entity.entityId);
        name = [doc?.fname, doc?.lname].filter(Boolean).join(' ') || undefined;
        href = `/profile/${entity.entityId}`;
        break;
      }
    }
    return {
      ...entity,
      ...(name ? { name } : {}),
      ...(href ? { href } : {}),
    };
  });

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
      userActivity: engagement.userActivityStats[0] || { activeUsers: 0, avgEventsPerUser: 0 },
      mostActiveUsers: engagement.mostActiveUsers || [],
    },
    research: {
      byEventType: research.byEventType || [],
      byEntityType: research.byEntityType || [],
      byUserType: combineAnalyticsUserTypeCounts(research.byUserType || []),
      topEntities: enrichedTopEntities,
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
        total: totalResearchEntityCount,
      },
      byType: researchEntities.byType || [],
      byVisibilityTier: researchEntities.byVisibilityTier || [],
      freshness: researchEntities.freshness[0] || {
        observedLast7Days: 0,
        observedLast30Days: 0,
        neverObserved: 0,
        staleOver90Days: 0,
      },
      scholarly: researchEntities.scholarly[0] || {
        withRecentGrants: 0,
      },
    },
    timestamp: now.toISOString(),
  };
};

type AnalyticsResult = Awaited<ReturnType<typeof computeAnalytics>>;

const analyticsCache = createRangeTtlCache<AnalyticsResult>();
const searchQualityCache = createRangeTtlCache<SearchQualityAnalytics>();

export const getSearchQualityAnalytics = (
  range: AnalyticsDateRange = {},
): Promise<SearchQualityAnalytics> =>
  searchQualityCache.load(range, () => computeSearchQualityAnalytics(range));

export const getAnalytics = (range: AnalyticsDateRange = {}): Promise<AnalyticsResult> =>
  analyticsCache.load(range, () => computeAnalytics(range));

export const invalidateAnalyticsCaches = (): void => {
  analyticsCache.clear();
  searchQualityCache.clear();
};
