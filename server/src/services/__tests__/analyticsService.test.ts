import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyticsAggregate: vi.fn(),
  analyticsCreate: vi.fn(),
  analyticsFind: vi.fn(),
  analyticsUpdateOne: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
}));

vi.mock('../../models/analytics', () => ({
  AnalyticsEventType: {
    LOGIN: 'login',
    LOGOUT: 'logout',
    VISITOR: 'visitor',
    LISTING_VIEW: 'listing_view',
    LISTING_FAVORITE: 'listing_favorite',
    LISTING_UNFAVORITE: 'listing_unfavorite',
    FELLOWSHIP_VIEW: 'fellowship_view',
    FELLOWSHIP_FAVORITE: 'fellowship_favorite',
    FELLOWSHIP_UNFAVORITE: 'fellowship_unfavorite',
    SEARCH: 'search',
    OUTREACH_CLICK: 'outreach_click',
    OUTREACH_OUTCOME: 'outreach_outcome',
    LISTING_CREATE: 'listing_create',
    LISTING_UPDATE: 'listing_update',
    LISTING_ARCHIVE: 'listing_archive',
    LISTING_UNARCHIVE: 'listing_unarchive',
    PROFILE_UPDATE: 'profile_update',
    RESEARCH_VIEW: 'research_view',
    PATHWAY_SAVE: 'pathway_save',
    WAYS_IN_CLICK: 'ways_in_click',
    CONTACT_ROUTE_CLICK: 'contact_route_click',
    SOURCE_LINK_CLICK: 'source_link_click',
    RESEARCH_SEARCH: 'research_search',
    RESEARCH_ENTITY_IMPRESSION: 'research_entity_impression',
    RESEARCH_PROFILE_OPEN: 'research_profile_open',
    RESEARCH_SOURCE_REVIEW: 'research_source_review',
    RESEARCH_FILTER_CHANGE: 'research_filter_change',
    RESEARCH_SAVE: 'research_save',
    RESEARCH_COMPARE: 'research_compare',
    RESEARCH_PLAN_UPDATE: 'research_plan_update',
    RESEARCH_QUALIFIED_ACTION: 'research_qualified_action',
  },
  RESEARCH_ENTITY_TYPES: ['profile', 'listing', 'fellowship', 'research_entity'],
  AnalyticsEvent: {
    aggregate: mocks.analyticsAggregate,
    create: mocks.analyticsCreate,
    find: mocks.analyticsFind,
    updateOne: mocks.analyticsUpdateOne,
  },
}));

vi.mock('../../models/index', () => ({
  User: {
    findOne: vi.fn(),
    findOneAndUpdate: mocks.userFindOneAndUpdate,
  },
}));

vi.mock('../../db/connections', () => ({
  getListingModel: vi.fn(),
}));

import {
  combineAnalyticsUserTypeCounts,
  getUserAnalytics,
  getUserAnalyticsDrilldown,
  getSearchQualityAnalytics,
  getFunnelAnalytics,
  logEvent,
  normalizeAnalyticsUserTypeBucket,
  shouldSuppressBetaAnalyticsEvent,
} from '../analyticsService';
import { AnalyticsEventType } from '../../models/analytics';

describe('analytics user type normalization', () => {
  it('combines professor and faculty into the canonical professor bucket', () => {
    expect(normalizeAnalyticsUserTypeBucket('professor')).toBe('professor');
    expect(normalizeAnalyticsUserTypeBucket('faculty')).toBe('professor');
    expect(
      combineAnalyticsUserTypeCounts([
        { userType: 'professor', count: 10755 },
        { userType: 'faculty', count: 6701 },
        { userType: 'undergraduate', count: 1340 },
      ]),
    ).toEqual([
      { userType: 'professor', count: 17456 },
      { userType: 'undergraduate', count: 1340 },
    ]);
  });
});

describe('search engagement attribution', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports action-aware success and uses a bounded same-user attribution lookup', async () => {
    mocks.analyticsAggregate.mockResolvedValueOnce([
      {
        overall: [
          {
            totalSearches: 10,
            zeroResultSearches: 2,
            uniqueSearchers: 4,
            engagedSearches: 3,
            returnedButIgnoredSearches: 5,
          },
        ],
        byQueryAndEntityType: [],
      },
    ]);

    await expect(getSearchQualityAnalytics()).resolves.toMatchObject({
      totalSearches: 10,
      engagedSearches: 3,
      returnedButIgnoredSearches: 5,
      engagementRate: 0.3,
      attributionWindowMinutes: 30,
    });

    const pipeline = mocks.analyticsAggregate.mock.calls[0][0];
    const lookup = pipeline.find((stage: any) => stage.$lookup)?.$lookup;
    expect(lookup.from).toBe('analytics_events');
    expect(JSON.stringify(lookup)).toContain('$$searchNetid');
    expect(JSON.stringify(lookup)).toContain('amount":30');
    expect(JSON.stringify(pipeline)).toContain('nextSearchAt');
    expect(JSON.stringify(pipeline)).toContain('$resultCount');
  });
});

describe('claim-specific research funnel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps source inspection, route attempts, application opens, and outcomes separate', async () => {
    mocks.analyticsAggregate.mockResolvedValueOnce([
      { eventType: 'research_source_review', count: 7 },
      {
        eventType: 'research_qualified_action',
        actionCategory: 'official_application',
        count: 3,
        uniqueNetids: ['student-1', 'student-2', 'student-3'],
      },
      {
        eventType: 'research_qualified_action',
        actionCategory: 'reviewed_route',
        count: 2,
        uniqueNetids: ['student-1', 'student-4'],
      },
      { eventType: 'outreach_outcome', count: 1 },
    ]);

    await expect(getFunnelAnalytics()).resolves.toMatchObject({
      sourceInspections: 7,
      qualifiedActions: 4,
      officialRouteAttempts: 4,
      applicationOpens: 3,
      confirmedOutcomes: 1,
    });
  });
});

describe('shouldSuppressBetaAnalyticsEvent', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('suppresses real student analytics in Beta', () => {
    vi.stubEnv('SCRAPER_ENV', 'beta');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'undergraduate' })).toBe(
      true,
    );
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'student' })).toBe(true);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'graduate' })).toBe(true);
  });

  it('keeps Beta admin and fixture analytics available for operator testing', () => {
    vi.stubEnv('SCRAPER_ENV', 'beta');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'qz285', userType: 'admin' })).toBe(false);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'devadmin', userType: 'undergraduate' })).toBe(
      false,
    );
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'test123', userType: 'student' })).toBe(false);
  });

  it('does not suppress production analytics', () => {
    vi.stubEnv('SCRAPER_ENV', 'production');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'undergraduate' })).toBe(
      false,
    );
  });
});

describe('getUserAnalytics', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects oversized search before building the aggregation pipeline', async () => {
    await expect(getUserAnalytics({ search: 'a'.repeat(121) })).rejects.toThrow('Invalid search');

    expect(mocks.analyticsAggregate).not.toHaveBeenCalled();
  });
});

describe('getUserAnalyticsDrilldown', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed netids before building analytics regex filters', async () => {
    await expect(getUserAnalyticsDrilldown('../not-a-netid')).rejects.toThrow('Invalid netid');
    await expect(getUserAnalyticsDrilldown('a'.repeat(121))).rejects.toThrow('Invalid netid');

    expect(mocks.analyticsAggregate).not.toHaveBeenCalled();
    expect(mocks.analyticsFind).not.toHaveBeenCalled();
  });
});

describe('logEvent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redacts direct contact details before persisting analytics text and metadata', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: 'student123',
      userType: 'undergraduate',
      searchQuery: 'email ada@example.edu or call 203-555-1212',
      searchDepartments: ['Computer Science', 'hidden@example.edu'],
      metadata: {
        entityType: 'listing',
        note: 'Reach ada@example.edu at 203-555-3434',
        nested: {
          values: ['visible', 'contact hidden@example.edu'],
        },
      },
    });

    expect(mocks.analyticsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        searchQuery: 'email [email redacted] or call [phone redacted]',
        searchDepartments: ['Computer Science', '[email redacted]'],
        metadata: {
          entityType: 'listing',
          note: 'Reach [email redacted] at [phone redacted]',
          nested: {
            values: ['visible', 'contact [email redacted]'],
          },
        },
      }),
    );
    expect(JSON.stringify(mocks.analyticsCreate.mock.calls[0][0])).not.toContain('ada@example.edu');
    expect(JSON.stringify(mocks.analyticsCreate.mock.calls[0][0])).not.toContain(
      'hidden@example.edu',
    );
    expect(JSON.stringify(mocks.analyticsCreate.mock.calls[0][0])).not.toContain('203-555');
  });

  it('bounds analytics text and metadata before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: 'student123',
      userType: 'undergraduate',
      searchQuery: `prefix ${'a'.repeat(800)} hidden@example.edu`,
      searchDepartments: Array.from({ length: 55 }, (_, index) => `Department ${index}`),
      metadata: {
        '$private.key': 'hidden@example.edu',
        constructor: 'prototype payload',
        prototype: 'prototype payload',
        longText: 'x'.repeat(800),
        wideArray: Array.from({ length: 55 }, (_, index) => index),
        notFinite: Number.POSITIVE_INFINITY,
        nested: {
          values: Array.from({ length: 55 }, (_, index) => `value-${index}`),
        },
      },
    });

    const created = mocks.analyticsCreate.mock.calls[0][0];
    expect(created.searchQuery).toHaveLength(512);
    expect(created.searchQuery).not.toContain('hidden@example.edu');
    expect(created.searchDepartments).toHaveLength(50);
    expect(Object.prototype.hasOwnProperty.call(created.metadata, '$private.key')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(created.metadata, '_private_key')).toBe(false);
    expect(JSON.stringify(created.metadata)).not.toContain('hidden@example.edu');
    expect(Object.prototype.hasOwnProperty.call(created.metadata, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(created.metadata, 'prototype')).toBe(false);
    expect(created.metadata.longText).toHaveLength(512);
    expect(created.metadata.wideArray).toHaveLength(50);
    expect(created.metadata).not.toHaveProperty('notFinite');
    expect(created.metadata.nested.values).toHaveLength(50);
    expect(JSON.stringify(created)).not.toContain('hidden@example.edu');
  });

  it('rejects malformed analytics actor netids before persistence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: '../not-a-netid',
      userType: 'undergraduate',
    });

    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed analytics event types before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: 'search.$where' as AnalyticsEventType,
      netid: 'student123',
      userType: 'undergraduate',
      searchQuery: 'machine learning',
    });

    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('sanitizes analytics actor fields before persistence and skips non-user buckets for user updates', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.VISITOR,
      netid: ' anonymous ',
      userType: 'admin<script>',
    });

    expect(mocks.analyticsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        netid: 'anonymous',
        userType: 'unknown',
      }),
    );
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('drops malformed analytics entity ids before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.LISTING_VIEW,
      netid: 'student123',
      userType: 'undergraduate',
      listingId: '../not-an-object-id',
      fellowshipId: '123',
    });

    const created = mocks.analyticsCreate.mock.calls[0][0];
    expect(created).not.toHaveProperty('listingId');
    expect(created).not.toHaveProperty('fellowshipId');
  });

  it('keeps valid analytics entity ObjectIds before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.LISTING_VIEW,
      netid: 'student123',
      userType: 'undergraduate',
      listingId: '507f1f77bcf86cd799439011',
      fellowshipId: '507f1f77bcf86cd799439012',
    });

    expect(mocks.analyticsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: '507f1f77bcf86cd799439011',
        fellowshipId: '507f1f77bcf86cd799439012',
      }),
    );
  });

  it('uses an atomic per-actor upsert for retry-safe journey events', async () => {
    mocks.analyticsUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.RESEARCH_SAVE,
      netid: 'student123',
      userType: 'undergraduate',
      entityType: 'research_entity',
      entityId: '507f1f77bcf86cd799439011',
      metadata: { operation: 'save' },
      dedupeKey: 'save:fixture-1',
    });

    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.analyticsUpdateOne).toHaveBeenCalledWith(
      { netid: 'student123', dedupeKey: 'save:fixture-1' },
      { $setOnInsert: expect.objectContaining({ eventType: 'research_save' }) },
      { upsert: true },
    );
  });
});
