import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import { ResearchEntity } from '../../models/index';
import { logEvent } from '../analyticsService';
import { emitResearchEvent, existingResearchEntityIds } from '../researchAnalytics';

let memoryServer: MongoMemoryServer | undefined;

const user = { netId: 'teststud1', userType: 'undergraduate' };
const knownObjectId = new mongoose.Types.ObjectId();

describe('result page views over a real store', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('research_results_view_test'));
  });

  beforeEach(async () => {
    await AnalyticsEvent.collection.deleteMany({});
    await ResearchEntity.collection.deleteMany({});
    await ResearchEntity.collection.insertMany([
      { slug: 'fixture-lab-a' },
      { slug: 'fixture-lab-b' },
      { _id: knownObjectId, slug: 'fixture-lab-c' },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('keeps the known entities of a page in display order, by slug or ObjectId', async () => {
    await expect(
      existingResearchEntityIds([
        'fixture-lab-b',
        'fixture-lab-gone',
        String(knownObjectId),
        'fixture-lab-a',
        'fixture-lab-b',
        42,
      ]),
    ).resolves.toEqual(['fixture-lab-b', String(knownObjectId), 'fixture-lab-a']);
  });

  it('stores a 24-card page as one row', async () => {
    const entityIds = Array.from({ length: 24 }, (_, index) => `fixture-lab-${index}`);

    await emitResearchEvent({
      eventType: AnalyticsEventType.RESEARCH_RESULTS_VIEW,
      entityType: 'research_entity',
      entityId: undefined,
      entityIds,
      payload: { surface: 'browse', pageBucket: '1' },
      dedupeKey: 'browse:fixture:1:1',
      user,
    });
    await emitResearchEvent({
      eventType: AnalyticsEventType.RESEARCH_RESULTS_VIEW,
      entityType: 'research_entity',
      entityId: undefined,
      entityIds,
      payload: { surface: 'browse', pageBucket: '1' },
      dedupeKey: 'browse:fixture:1:1',
      user,
    });

    const rows = await AnalyticsEvent.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'research_results_view',
      entityType: 'research_entity',
      entityIds,
      metadata: { surface: 'browse', pageBucket: '1' },
    });
  });

  it('does not add an empty entityIds array to other events', async () => {
    await logEvent({ eventType: AnalyticsEventType.LOGIN, netid: 'teststud1' });

    const [row] = await AnalyticsEvent.collection.find({}).toArray();
    expect(row).not.toHaveProperty('entityIds');
  });
});
