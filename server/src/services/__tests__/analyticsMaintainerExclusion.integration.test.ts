import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AdminGrant } from '../../models/adminGrant';
import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import {
  getActionNeededAnalytics,
  getAnalytics,
  getFunnelAnalytics,
  getSearchQualityAnalytics,
  getUserAnalytics,
  invalidateAnalyticsCaches,
} from '../analyticsService';

let memoryServer: MongoMemoryServer | undefined;

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
const daysAgo = (days: number) => hoursAgo(days * 24);

const row = (
  netid: string,
  eventType: AnalyticsEventType,
  timestamp: Date,
  extra: Record<string, unknown> = {},
) => ({ netid, userType: 'undergraduate', eventType, timestamp, ...extra });

const zeroResultSearch = (netid: string, query: string, timestamp: Date) =>
  row(netid, AnalyticsEventType.SEARCH, timestamp, {
    searchQuery: query,
    metadata: { entityType: 'research_entity', resultCount: 0 },
  });

describe('usage analytics over a real store', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('analytics_maintainer_exclusion_test'));
  });

  beforeEach(async () => {
    invalidateAnalyticsCaches();
    await AnalyticsEvent.collection.deleteMany({});
    await AdminGrant.collection.deleteMany({});
    await AdminGrant.collection.insertOne({ netid: 'maint01', status: 'revoked' });
    await AnalyticsEvent.collection.insertMany([
      row('stud01', AnalyticsEventType.LOGIN, daysAgo(20)),
      row('stud01', AnalyticsEventType.VISITOR, daysAgo(20)),
      row('stud01', AnalyticsEventType.RESEARCH_PROFILE_OPEN, daysAgo(2)),
      row('stud01', AnalyticsEventType.RESEARCH_PROFILE_OPEN, daysAgo(1)),
      row('stud02', AnalyticsEventType.LOGIN, daysAgo(1), { userType: 'unknown' }),
      row('stud02', AnalyticsEventType.RESEARCH_SEARCH, hoursAgo(2), { userType: 'graduate' }),
      row('maint01', AnalyticsEventType.LOGIN, daysAgo(1)),
      row('maint01', AnalyticsEventType.VISITOR, daysAgo(1)),
      row('maint01', AnalyticsEventType.RESEARCH_SEARCH, daysAgo(1)),
      row('legacy01', AnalyticsEventType.LOGIN, daysAgo(1), { userType: 'admin' }),
      zeroResultSearch('maint01', 'maintainer probe', daysAgo(1)),
      zeroResultSearch('maint01', 'maintainer probe', daysAgo(1)),
      ...Array.from({ length: 101 * 3 }, (_, index) =>
        row('stud02', AnalyticsEventType.SEARCH, daysAgo(3), {
          searchQuery: `popular topic ${index % 101}`,
          metadata: { entityType: 'research_entity', resultCount: 5 },
        }),
      ),
      zeroResultSearch('stud01', 'rare coverage gap', daysAgo(4)),
      zeroResultSearch('stud01', 'rare coverage gap', daysAgo(4)),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('matches grant holders whatever the case of the netid on their rows', async () => {
    await AnalyticsEvent.collection.insertOne(row('MAINT01', AnalyticsEventType.LOGIN, daysAgo(1)));

    const { visitors } = await getAnalytics();

    expect(visitors.loginFrequency.totalLogins).toBe(2);
  });

  it('counts logins from login rows only, leaving out maintainers', async () => {
    const { visitors } = await getAnalytics();

    expect(visitors.loginFrequency.totalLogins).toBe(2);
    expect(visitors.loginFrequency.loginsLast7Days).toBe(1);
  });

  it('counts a visitor from any activity in the window, typed by their latest row', async () => {
    const { visitors } = await getAnalytics();

    expect(visitors.last7Days.total).toBe(2);
    expect(visitors.lifetime.total).toBe(2);
    expect(visitors.last7Days.byType).toEqual([
      { userType: 'graduate', count: 1 },
      { userType: 'undergraduate', count: 1 },
    ]);
  });

  it('leaves grant holders and legacy admin rows out of the funnel and search quality', async () => {
    const funnel = await getFunnelAnalytics();
    const quality = await getSearchQualityAnalytics();

    expect(funnel.logins).toBe(2);
    expect(funnel.researchSearches).toBe(1);
    expect(quality.byQueryAndEntityType.map((query) => query.query)).not.toContain(
      'maintainer probe',
    );
  });

  it('keeps a repeated zero-result query outside the 100 most-searched in action needed', async () => {
    const { highSearchLowResults } = await getActionNeededAnalytics();

    expect(highSearchLowResults.map((query) => query.query)).toEqual(['rare coverage gap']);
  });

  it('counts profile opens per user and takes the later of last login and last event', async () => {
    const { users } = await getUserAnalytics({ search: 'stud01' });

    expect(users).toHaveLength(1);
    expect(users[0].researchViews).toBe(2);
    expect(new Date(users[0].lastActive as unknown as string).getTime()).toBeGreaterThan(
      daysAgo(1.5).getTime(),
    );
  });
});
