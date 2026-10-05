import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';
import { logEvent } from '../services/analyticsService';
import { visitorDedupeKey } from '../passport';

let memoryServer: MongoMemoryServer | undefined;

const logVisit = (netid: string, visitedAt: Date) =>
  logEvent({
    eventType: AnalyticsEventType.VISITOR,
    netid,
    userType: 'undergraduate',
    dedupeKey: visitorDedupeKey(visitedAt),
    metadata: { timestamp: visitedAt, loginMethod: 'cookie' },
  });

describe('visitor rows over a real store', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('visitor_row_once_per_day_test'));
    await AnalyticsEvent.syncIndexes();
  });

  beforeEach(async () => {
    await AnalyticsEvent.collection.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('keeps one row when a session opens with a burst of parallel requests', async () => {
    const visitedAt = new Date('2026-09-27T14:00:00.000Z');

    await Promise.all(Array.from({ length: 6 }, () => logVisit('stud01', visitedAt)));

    await expect(
      AnalyticsEvent.countDocuments({ eventType: AnalyticsEventType.VISITOR }),
    ).resolves.toBe(1);
  });

  it('records a later day and a different student separately', async () => {
    await logVisit('stud01', new Date('2026-09-27T23:59:00.000Z'));
    await logVisit('stud01', new Date('2026-09-28T00:01:00.000Z'));
    await logVisit('stud02', new Date('2026-09-27T12:00:00.000Z'));

    await expect(
      AnalyticsEvent.countDocuments({ eventType: AnalyticsEventType.VISITOR }),
    ).resolves.toBe(3);
  });
});
