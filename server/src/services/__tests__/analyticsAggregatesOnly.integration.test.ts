import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import {
  MIN_DISTINCT_SEARCHERS_TO_SHOW_QUERY,
  getActionNeededAnalytics,
  getAnalytics,
  getSearchQualityAnalytics,
  getSearchQueryAnalytics,
  getUserAnalytics,
  getUserAnalyticsDrilldown,
  invalidateAnalyticsCaches,
} from '../analyticsService';

let memoryServer: MongoMemoryServer | undefined;

const base = new Date(Date.now() - 2 * 60 * 60 * 1000);
const minutesAfterBase = (minutes: number) => new Date(base.getTime() + minutes * 60 * 1000);

const students = ['synth01', 'synth02', 'synth03', 'synth04'];
const accountIds = students.map(() => new mongoose.Types.ObjectId());
const emailFor = (netid: string) => `${netid}@synthetic.example`;

const search = (netid: string, offset: number, searchQuery: string, resultCount: number) => ({
  netid,
  userType: 'undergraduate',
  eventType: AnalyticsEventType.SEARCH,
  timestamp: minutesAfterBase(offset),
  searchQuery,
  metadata: {
    entityType: 'research_entity',
    resultCount,
    filters: { departments: ['Synthetic Department'] },
  },
});

const profileOpen = (netid: string, offset: number) => ({
  netid,
  userType: 'undergraduate',
  eventType: AnalyticsEventType.RESEARCH_PROFILE_OPEN,
  timestamp: minutesAfterBase(offset),
});

const searchFamilyEventTypes: string[] = [
  AnalyticsEventType.SEARCH,
  AnalyticsEventType.RESEARCH_SEARCH,
  AnalyticsEventType.RESEARCH_FILTER_CHANGE,
];

const sharedQuery = 'shared synthetic topic';
const pairQuery = 'pair synthetic topic';
const soloQuery = 'solo synthetic topic';

const identifyingStrings = () => [
  ...students,
  ...students.map(emailFor),
  ...accountIds.map(String),
  'Synthetic Display Name',
];

const identifyingKeys = ['netid', 'email', 'userId', 'searchers', 'displayName', 'accountId'];

const keysIn = (value: unknown, keys = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((item) => keysIn(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      keysIn(nested, keys);
    }
  }
  return keys;
};

const expectNoStudentIdentity = (payload: unknown) => {
  const serialized = JSON.stringify(payload);
  for (const identifier of identifyingStrings()) {
    expect(serialized).not.toContain(identifier);
  }
  const keys = keysIn(JSON.parse(serialized));
  for (const key of identifyingKeys) {
    expect(keys.has(key)).toBe(false);
  }
};

const searchQueryPayloads = async () => {
  const analytics = await getAnalytics();
  return {
    topSearchQueries: analytics.engagement.topSearchQueries,
    searchQuality: await getSearchQualityAnalytics(),
    searchQueries: await getSearchQueryAnalytics(),
    actions: await getActionNeededAnalytics(),
  };
};

describe('admin search analytics are aggregates only', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('analytics_aggregates_only_test'));
  });

  beforeEach(async () => {
    invalidateAnalyticsCaches();
    const db = mongoose.connection.db!;
    await AnalyticsEvent.collection.deleteMany({});
    await db.collection('accounts').deleteMany({});
    await db.collection('researchers').deleteMany({});
    await db.collection('accounts').insertMany(
      students.map((netid, index) => ({
        _id: accountIds[index],
        netid,
        email: emailFor(netid),
      })),
    );
    await db
      .collection('researchers')
      .insertMany(
        accountIds.map((accountId) => ({ accountId, displayName: 'Synthetic Display Name' })),
      );
    await AnalyticsEvent.collection.insertMany([
      search('synth01', 0, sharedQuery, 0),
      search('synth02', 0, sharedQuery, 0),
      search('synth03', 0, sharedQuery, 6),
      profileOpen('synth03', 1),
      search('synth01', 60, pairQuery, 4),
      profileOpen('synth01', 61),
      search('synth02', 60, pairQuery, 0),
      search('synth04', 0, soloQuery, 0),
      search('synth04', 60, soloQuery, 0),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('never returns an email, netid, user id or name in a search-query payload', async () => {
    const payloads = await searchQueryPayloads();

    expect(payloads.searchQueries.queries.length).toBeGreaterThan(0);
    expectNoStudentIdentity(payloads);
  });

  it('never returns an email from the user table or the per-user drilldown', async () => {
    const users = await getUserAnalytics();
    const drilldown = await getUserAnalyticsDrilldown('synth01');

    expect(users.users.map((user) => user.netid).sort()).toEqual(['synth01', 'synth03']);
    for (const netid of students) {
      expect(JSON.stringify(users)).not.toContain(emailFor(netid));
    }
    expect(JSON.stringify(drilldown)).not.toContain(emailFor('synth01'));
    expect(keysIn(users).has('email')).toBe(false);
    expect(keysIn(drilldown).has('email')).toBe(false);
  });

  it("never lets an admin browse one student's searches", async () => {
    await AnalyticsEvent.collection.insertMany(
      [AnalyticsEventType.RESEARCH_SEARCH, AnalyticsEventType.RESEARCH_FILTER_CHANGE].map(
        (eventType, index) => ({
          ...search('synth01', 120 + index, sharedQuery, 1),
          eventType,
        }),
      ),
    );
    const drilldown = await getUserAnalyticsDrilldown('synth01');
    const serialized = JSON.stringify(drilldown);

    expect(drilldown?.events.length).toBeGreaterThan(0);
    expect(
      drilldown?.events.filter((event) => searchFamilyEventTypes.includes(event.eventType)),
    ).toEqual([]);
    expect(serialized).not.toContain(sharedQuery);
    expect(serialized).not.toContain(pairQuery);
    expect(serialized).not.toContain('Synthetic Department');
    expect(keysIn(drilldown).has('searchQuery')).toBe(false);
    expect(keysIn(drilldown).has('searchDepartments')).toBe(false);
  });

  it("never reports one student's search count or search-driven activity", async () => {
    const users = await getUserAnalytics({ sort: 'totalEvents' });
    const drilldown = await getUserAnalyticsDrilldown('synth01');
    const analytics = await getAnalytics();
    const perStudentPayloads = { users, drilldown, mostActive: analytics.engagement.mostActiveUsers };

    expect(keysIn(perStudentPayloads).has('searches')).toBe(false);
    expect(drilldown?.user.totalEvents).toBe(1);
    expect(new Date(drilldown!.user.lastEventAt!).getTime()).toBe(minutesAfterBase(61).getTime());
    expect(users.users.find((user) => user.netid === 'synth03')?.totalEvents).toBe(1);
    expect(await getUserAnalyticsDrilldown('synth04')).toBeNull();
    expect(
      analytics.engagement.mostActiveUsers.map((user: { userId: string; eventCount: number }) => [
        user.userId,
        user.eventCount,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['synth01', 1],
        ['synth03', 1],
      ]),
    );
    expect(analytics.engagement.mostActiveUsers).toHaveLength(2);
  });

  it('shows a query only once enough distinct students searched it', async () => {
    const payloads = await searchQueryPayloads();
    const serialized = JSON.stringify(payloads);

    expect(MIN_DISTINCT_SEARCHERS_TO_SHOW_QUERY).toBe(3);
    expect(serialized).toContain(sharedQuery);
    expect(serialized).not.toContain(pairQuery);
    expect(serialized).not.toContain(soloQuery);
    expect(payloads.searchQueries.suppressedQueries).toEqual({
      queryGroups: 2,
      searches: 4,
      zeroResultQueryGroups: 2,
      zeroResultSearches: 3,
    });
    expect(payloads.searchQuality.suppressedQueries).toEqual(
      payloads.searchQueries.suppressedQueries,
    );
    expect(payloads.topSearchQueries).toEqual([{ query: sharedQuery, count: 3 }]);
    for (const entry of payloads.topSearchQueries) {
      expect(Object.keys(entry).sort()).toEqual(['count', 'query']);
    }
    expect(payloads.actions.highSearchLowResults.map((row) => row.query)).toEqual([sharedQuery]);
  });

  it('keeps every dashboard aggregate counted over all searches, suppressed or not', async () => {
    const quality = await getSearchQualityAnalytics();
    const { queries } = await getSearchQueryAnalytics();
    const analytics = await getAnalytics();

    expect(quality.totalSearches).toBe(7);
    expect(analytics.engagement.search.totalSearches).toBe(7);
    expect(quality.degradedSearches).toBe(0);
    expect(quality.zeroResultSearches).toBe(5);
    expect(quality.zeroResultRate).toBe(Number((5 / 7).toFixed(4)));
    expect(quality.uniqueSearchers).toBe(4);
    expect(quality.engagedSearches).toBe(2);
    expect(quality.returnedButIgnoredSearches).toBe(0);
    expect(quality.engagementRate).toBe(Number((2 / 7).toFixed(4)));
    expect(quality.avgResultsPerSearch).toBeCloseTo(10 / 7, 10);
    expect(queries).toEqual([
      expect.objectContaining({
        query: sharedQuery,
        totalSearches: 3,
        uniqueSearchers: 3,
        zeroResultSearches: 2,
        avgResultCount: 2,
      }),
    ]);
  });

  it('averages results over every query group, not only the most-searched hundred', async () => {
    await AnalyticsEvent.collection.insertMany(
      Array.from({ length: 101 }, (_, index) =>
        search('synth04', 90, `long tail synthetic topic ${index}`, 50),
      ),
    );

    const quality = await getSearchQualityAnalytics();

    expect(quality.totalSearches).toBe(108);
    expect(quality.avgResultsPerSearch).toBeCloseTo((10 + 101 * 50) / 108, 10);
  });

  it('dates a shown query row to its UTC day, with no time of day', async () => {
    const { queries } = await getSearchQueryAnalytics();
    const lastSharedSearch = minutesAfterBase(0);

    expect(queries).toHaveLength(1);
    const lastSearchedAt = new Date(queries[0].lastSearchedAt!);
    expect(lastSearchedAt.toISOString()).toBe(
      `${lastSharedSearch.toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
  });
});
