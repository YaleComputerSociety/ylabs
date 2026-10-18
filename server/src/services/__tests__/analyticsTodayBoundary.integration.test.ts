import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import { parseAnalyticsRange } from '../../utils/analyticsRange';
import { getAnalytics, invalidateAnalyticsCaches } from '../analyticsService';

let memoryServer: MongoMemoryServer | undefined;
const originalTimeZone = process.env.TZ;

const login = (netid: string, timestamp: string) => ({
  netid,
  userType: 'undergraduate',
  eventType: AnalyticsEventType.LOGIN,
  timestamp: new Date(timestamp),
});

describe('the per-card today breakdown over a real store', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('analytics_today_boundary_test'));
    // getAnalytics runs its $lookup aggregates in parallel; a lookup target that does not
    // exist yet can be created mid-aggregate, which the server rejects as a collection that
    // "appeared after a restore". Creating them up front removes that race.
    for (const collection of ['accounts', 'researchers']) {
      await mongoose.connection.db!.createCollection(collection);
    }
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('counts today from the same New Haven midnight the today range starts at', async () => {
    await AnalyticsEvent.collection.insertMany([
      login('stud01', '2026-09-30T03:30:00.000Z'),
      login('stud02', '2026-09-30T05:00:00.000Z'),
    ]);
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-30T14:00:00.000Z') });
    invalidateAnalyticsCaches();

    const todayRange = parseAnalyticsRange('today');
    const { visitors } = await getAnalytics();

    expect(todayRange.start?.toISOString()).toBe('2026-09-30T04:00:00.000Z');
    expect(visitors.loginFrequency.loginsToday).toBe(1);
    expect(visitors.today.total).toBe(1);
  });
});
