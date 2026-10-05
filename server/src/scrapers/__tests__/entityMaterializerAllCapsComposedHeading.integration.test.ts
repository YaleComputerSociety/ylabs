import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { resetKnownPersonSurnameRosterCache } from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'dept-fixture-robin-q-fixture';

describe('materializeEntity recases a composed heading whose person half is in capitals', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
  });

  it('serves the stored all-caps heading in normal case', async () => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'ROBIN Q. FIXTURE Faculty Research',
      displayName: 'ROBIN Q. FIXTURE Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://www.example.com/robin-fixture/',
      field: 'name',
      value: 'ROBIN Q. FIXTURE',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const entity = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{
      name?: string;
      displayName?: string;
    }>();
    expect(entity?.name).toBe('Robin Q. Fixture Faculty Research');
    expect(entity?.displayName).toBe('Robin Q. Fixture Faculty Research');
  });
});
