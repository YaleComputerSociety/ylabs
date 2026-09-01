import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntities: vi.fn().mockResolvedValue(undefined) };
});

import { syncEntities } from '../../services/meiliSyncService';
import { runResearchEntityKindResync } from '../resyncResearchEntityKind';

const insertEntity = async (params: {
  slug: string;
  entityType: string;
  kind: string;
}): Promise<mongoose.Types.ObjectId> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const _id = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id,
    slug: params.slug,
    name: params.slug,
    entityType: params.entityType,
    kind: params.kind,
    status: 'ACTIVE',
    archived: false,
  });
  return _id;
};

const storedKinds = async (): Promise<Record<string, string>> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const docs = await db.collection('research_entities').find({}).toArray();
  return Object.fromEntries(docs.map((doc) => [String(doc.slug), String(doc.kind)]));
};

describe('runResearchEntityKindResync (#2144)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteMany({});
    vi.mocked(syncEntities).mockClear();
  });

  const seedConsistentRowsThenDrift = async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertEntity({ slug: `consistent-lab-${i}`, entityType: 'LAB', kind: 'lab' });
    }
    await insertEntity({ slug: 'drifted-core', entityType: 'CORE_FACILITY', kind: 'lab' });
    await insertEntity({ slug: 'drifted-center', entityType: 'CENTER', kind: 'lab' });
  };

  it('plans drifted rows that sort after a limit worth of consistent rows', async () => {
    await seedConsistentRowsThenDrift();

    const result = await runResearchEntityKindResync({ dryRun: true, limit: 2 });

    expect(result.planned).toBe(2);
    expect(result.samples.map((row) => row.slug).sort()).toEqual([
      'drifted-center',
      'drifted-core',
    ]);
    expect(await storedKinds()).toMatchObject({ 'drifted-core': 'lab' });
  });

  it('advances the backfill across successive limited apply runs', async () => {
    await seedConsistentRowsThenDrift();

    const first = await runResearchEntityKindResync({ dryRun: false, limit: 1 });
    expect(first.updated).toBe(1);

    const second = await runResearchEntityKindResync({ dryRun: false, limit: 1 });
    expect(second.updated).toBe(1);

    const third = await runResearchEntityKindResync({ dryRun: false, limit: 1 });
    expect(third.planned).toBe(0);
    expect(third.updated).toBe(0);

    expect(await storedKinds()).toMatchObject({
      'drifted-core': 'core_facility',
      'drifted-center': 'center',
      'consistent-lab-0': 'lab',
    });
  });

  it('leaves rows whose entity type is unknown untouched', async () => {
    await insertEntity({ slug: 'unknown-type', entityType: 'NOT_A_TYPE', kind: 'lab' });

    const result = await runResearchEntityKindResync({ dryRun: false, limit: 10 });

    expect(result.planned).toBe(0);
    expect(await storedKinds()).toEqual({ 'unknown-type': 'lab' });
  });
});
