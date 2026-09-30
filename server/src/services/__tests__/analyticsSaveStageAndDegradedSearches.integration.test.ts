import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import {
  getFunnelAnalytics,
  getSearchQualityAnalytics,
  getSearchQueryAnalytics,
  invalidateAnalyticsCaches,
} from '../analyticsService';

let memoryServer: MongoMemoryServer | undefined;

const base = new Date('2026-02-01T12:00:00.000Z');
const minutesAfterBase = (minutes: number) => new Date(base.getTime() + minutes * 60 * 1000);

const researchSave = (
  netid: string,
  offset: number,
  operation: 'save' | 'remove',
  entityType: 'research_entity' | 'fellowship',
) => ({
  netid,
  userType: 'undergraduate',
  eventType: AnalyticsEventType.RESEARCH_SAVE,
  entityType,
  entityId: `${entityType}-fixture`,
  timestamp: minutesAfterBase(offset),
  metadata: { operation, surface: 'profile' },
});

const search = (
  netid: string,
  offset: number,
  searchQuery: string,
  metadata: { resultCount: number; degraded?: boolean },
) => ({
  netid,
  userType: 'undergraduate',
  eventType: AnalyticsEventType.SEARCH,
  timestamp: minutesAfterBase(offset),
  searchQuery,
  metadata: { entityType: 'research_entity', filters: {}, page: 1, ...metadata },
});

const profileOpen = (netid: string, offset: number) => ({
  netid,
  userType: 'undergraduate',
  eventType: AnalyticsEventType.RESEARCH_PROFILE_OPEN,
  timestamp: minutesAfterBase(offset),
});

describe('funnel save stage and degraded searches over a real store', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('analytics_save_stage_degraded_test'));
  });

  beforeEach(async () => {
    invalidateAnalyticsCaches();
    await AnalyticsEvent.collection.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('counts only students who saved research in the save stage', async () => {
    await AnalyticsEvent.collection.insertMany([
      researchSave('stud01', 0, 'save', 'research_entity'),
      researchSave('stud02', 0, 'remove', 'research_entity'),
      researchSave('stud03', 0, 'remove', 'fellowship'),
      researchSave('stud04', 0, 'save', 'fellowship'),
    ]);

    const funnel = await getFunnelAnalytics();

    expect(funnel.researchSaves).toBe(1);
  });

  it('does not count a search followed only by a removal as engaged', async () => {
    await AnalyticsEvent.collection.insertMany([
      search('stud01', 0, 'marine ecology', { resultCount: 4 }),
      researchSave('stud01', 1, 'remove', 'research_entity'),
      search('stud02', 0, 'marine ecology', { resultCount: 4 }),
      researchSave('stud02', 1, 'save', 'research_entity'),
    ]);

    const quality = await getSearchQualityAnalytics();

    expect(quality.engagedSearches).toBe(1);
    expect(quality.returnedButIgnoredSearches).toBe(1);
    expect(quality.engagementRate).toBe(0.5);
  });

  it('leaves engagement and result averages unchanged when degraded searches are added', async () => {
    const healthy = [
      search('stud01', 0, 'marine ecology', { resultCount: 6 }),
      profileOpen('stud01', 1),
      search('stud02', 0, 'marine ecology', { resultCount: 2 }),
    ];
    await AnalyticsEvent.collection.insertMany(healthy);
    const before = await getSearchQualityAnalytics();
    const beforeQueries = await getSearchQueryAnalytics();

    invalidateAnalyticsCaches();
    await AnalyticsEvent.collection.insertMany([
      search('stud03', 0, 'marine ecology', { resultCount: 1, degraded: true }),
      search('stud04', 0, 'marine ecology', { resultCount: 0, degraded: true }),
      profileOpen('stud04', 1),
      search('stud05', 0, 'marine ecology', { resultCount: 1, degraded: true }),
      search('stud06', 0, 'marine ecology', { resultCount: 1, degraded: true }),
    ]);
    const after = await getSearchQualityAnalytics();
    const afterQueries = await getSearchQueryAnalytics();

    expect(after.totalSearches).toBe(6);
    expect(after.degradedSearches).toBe(4);
    expect(after.engagedSearches).toBe(before.engagedSearches);
    expect(after.returnedButIgnoredSearches).toBe(before.returnedButIgnoredSearches);
    expect(after.engagementRate).toBe(before.engagementRate);
    expect(after.engagementRate).toBe(0.5);
    const averageFor = (rows: Array<{ query: string; avgResultCount: number }>) =>
      rows.find((row) => row.query === 'marine ecology')?.avgResultCount;
    expect(averageFor(after.byQueryAndEntityType)).toBe(averageFor(before.byQueryAndEntityType));
    expect(averageFor(after.byQueryAndEntityType)).toBe(4);
    expect(averageFor(afterQueries.queries)).toBe(averageFor(beforeQueries.queries));
    expect(averageFor(afterQueries.queries)).toBe(4);
  });

  it('keeps the fallback result counts out of a zero-result query average', async () => {
    await AnalyticsEvent.collection.insertMany([
      search('stud01', 0, 'rare topic', { resultCount: 0 }),
      search('stud02', 0, 'rare topic', { resultCount: 0 }),
      search('stud03', 0, 'rare topic', { resultCount: 9, degraded: true }),
    ]);

    const quality = await getSearchQualityAnalytics();

    expect(quality.topZeroResultQueries).toEqual([
      expect.objectContaining({ query: 'rare topic', avgResultCount: 0 }),
    ]);
  });
});
