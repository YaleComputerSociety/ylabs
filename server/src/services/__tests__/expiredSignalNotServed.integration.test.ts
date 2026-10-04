import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail } from '../researchGroupService';

/**
 * A signal past its `expiresAt` is not served, so a posted opening stops reading as
 * open once its deadline passes rather than when its source is next re-materialized
 * (#4628). A signal with no expiry keeps serving.
 */
const SLUG = 'fixture-expired-posted-opening';
const DEPARTMENT = 'Fixture Department of Synthetic Studies';
const SITE = 'https://example.edu/labs/fixture/';
const DAY_MS = 24 * 60 * 60 * 1000;

const postedOpening = (
  entityId: mongoose.Types.ObjectId,
  label: string,
  expiresAt: Date | undefined,
) => ({
  _id: new mongoose.Types.ObjectId(),
  researchEntityId: entityId,
  type: 'POSTED_OPENING',
  archived: false,
  confidence: 'HIGH',
  observedAt: new Date(Date.now() - DAY_MS),
  derivationKey: `signal:POSTED_OPENING:${SITE}${label}`,
  source: { url: `${SITE}${label}`, excerpt: `Fixture posting ${label}. Apply by the deadline.` },
  ...(expiresAt ? { expiresAt } : {}),
});

const seedEntity = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Example Fixture Lab',
    kind: 'lab',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: 'Studies capillary barrier failure in critically ill newborns.',
    fullDescription:
      'The lab investigates capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.',
    websiteUrl: SITE,
    sourceUrls: [SITE],
    departments: [DEPARTMENT],
  });
  return entityId;
};

const servedExcerpts = async () => {
  const detail = await getResearchGroupDetail(SLUG);
  return (detail?.accessSignals ?? []).map((signal: any) => String(signal.excerpt));
};

describe('a signal past its expiry is not served (#4628)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'signals', 'org_units']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('withholds a posted opening whose deadline has passed and keeps an open one', async () => {
    const entityId = await seedEntity();
    await mongoose.connection
      .db!.collection('signals')
      .insertMany([
        postedOpening(entityId, 'closed', new Date(Date.now() - DAY_MS)),
        postedOpening(entityId, 'open', new Date(Date.now() + 30 * DAY_MS)),
      ]);

    const excerpts = await servedExcerpts();

    expect(excerpts.some((excerpt) => excerpt.includes('closed'))).toBe(false);
    expect(excerpts.some((excerpt) => excerpt.includes('open'))).toBe(true);
  });

  it('keeps serving a signal that carries no expiry', async () => {
    const entityId = await seedEntity();
    await mongoose.connection
      .db!.collection('signals')
      .insertOne(postedOpening(entityId, 'undated', undefined));

    expect((await servedExcerpts()).some((excerpt) => excerpt.includes('undated'))).toBe(true);
  });

  it('does not let expired rows crowd a live one out of the capped detail read', async () => {
    const entityId = await seedEntity();
    const newerExpired = Array.from({ length: 60 }, (_, index) => ({
      ...postedOpening(entityId, `closed-${index}`, new Date(Date.now() - DAY_MS)),
      observedAt: new Date(Date.now() - DAY_MS + index * 1000),
    }));
    const olderOpen = {
      ...postedOpening(entityId, 'open', new Date(Date.now() + 30 * DAY_MS)),
      observedAt: new Date(Date.now() - 10 * DAY_MS),
    };
    await mongoose.connection.db!.collection('signals').insertMany([...newerExpired, olderOpen]);

    const excerpts = await servedExcerpts();

    expect(excerpts.some((excerpt) => excerpt.includes('closed'))).toBe(false);
    expect(excerpts.some((excerpt) => excerpt.includes('open'))).toBe(true);
  });
});
