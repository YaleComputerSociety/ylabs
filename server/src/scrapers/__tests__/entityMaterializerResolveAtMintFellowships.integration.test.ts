import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: meiliMocks.syncEntity, deleteFromIndex: meiliMocks.deleteFromIndex };
});

import { Observation } from '../../models/observation';
import { Fellowship } from '../../models/fellowship';
import { CanonicalAlias } from '../../models/canonicalAlias';
import { materializeEntity } from '../entityMaterializer';

const LISTING_URL = 'https://macmillan.yale.edu/middleeast/grants';
const SOURCE_NAME = 'yale-college-fellowships-office';

const GANZFRIED = {
  sourceKey: 'yale-college-fellowships-office:cmes-ganzfried-family-travel-fellowship',
  title: 'CMES Ganzfried Family Travel Fellowship',
};
const LIBBY_ROUSE = {
  sourceKey: 'yale-college-fellowships-office:cmes-libby-rouse-fund-for-peace-fellowships',
  title: 'CMES Libby Rouse Fund for Peace Fellowships',
};

async function seedFellowship(sourceKey: string, title: string): Promise<void> {
  const sourceId = new mongoose.Types.ObjectId();
  const fields: Array<[string, string]> = [
    ['title', title],
    ['sourceKey', sourceKey],
    ['sourceName', SOURCE_NAME],
    ['sourceUrl', LISTING_URL],
  ];
  for (const [field, value] of fields) {
    await Observation.create({
      entityType: 'fellowship',
      entityKey: sourceKey,
      field,
      value,
      sourceId,
      sourceName: SOURCE_NAME,
      sourceUrl: LISTING_URL,
      confidence: 0.9,
      observedAt: new Date('2026-03-01T00:00:00Z'),
      superseded: false,
    });
  }
}

describe('resolve-at-mint for fellowships (C4_RESOLVE_AT_MINT_ENTITIES)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    delete process.env.C4_RESOLVE_AT_MINT_ENTITIES;
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'fellowships', 'canonical_aliases']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('flag OFF: two distinct fellowships sharing a listing sourceUrl mint two rows (unchanged behavior)', async () => {
    await seedFellowship(GANZFRIED.sourceKey, GANZFRIED.title);
    const first = await materializeEntity('fellowship', { entityKey: GANZFRIED.sourceKey });
    await seedFellowship(LIBBY_ROUSE.sourceKey, LIBBY_ROUSE.title);
    const second = await materializeEntity('fellowship', { entityKey: LIBBY_ROUSE.sourceKey });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(String(second.entityId)).not.toBe(String(first.entityId));
    expect(await Fellowship.countDocuments({})).toBe(2);
    expect(await CanonicalAlias.countDocuments({})).toBe(0);
  });

  it('flag ON: a re-minted fellowship resolves to the canonical via its reserved source-url alias', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedFellowship(GANZFRIED.sourceKey, GANZFRIED.title);
    const first = await materializeEntity('fellowship', { entityKey: GANZFRIED.sourceKey });

    await seedFellowship(LIBBY_ROUSE.sourceKey, LIBBY_ROUSE.title);
    const second = await materializeEntity('fellowship', { entityKey: LIBBY_ROUSE.sourceKey });

    expect(await Fellowship.countDocuments({})).toBe(1);
    expect(second.created).toBe(false);
    expect(String(second.entityId)).toBe(String(first.entityId));

    const urlAlias = await CanonicalAlias.findOne({
      type: 'fellowship',
      aliasNs: 'source-url',
      aliasValue: LISTING_URL,
    }).lean();
    expect(urlAlias).not.toBeNull();
    expect((urlAlias as unknown as { reason?: string }).reason).toBe('resolve_at_mint');
    expect(String((urlAlias as unknown as { canonicalId: unknown }).canonicalId)).toBe(
      String(first.entityId),
    );
  });
});
