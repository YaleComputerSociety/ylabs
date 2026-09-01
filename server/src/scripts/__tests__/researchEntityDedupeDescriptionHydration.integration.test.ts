import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

// Shapes of the #2208 case: the survivor holds a thin paragraph that merely
// restates its own card line, while the archived twin holds the richer
// source-backed prose that #2176 extracted.
const THIN_FULL =
  'The Horsley Lab studies cellular and molecular mechanisms controlling tissue biology, focusing on development, homeostasis, regeneration, and disease using multiple epithelial tissues.';
const RICH_FULL =
  'We are studying the dynamic interactions between non-epithelial cells in tissues that interface with the environment. Using multi pronged approaches including mouse genetics, cell culture models, genomics and microscopy, we tackle complex biological processes focusing on the contribution of cell-intrinsic and cell-extrinsic factors that contribute to regenerative processes. By leveraging the abundant clinical resources of the Yale medical center we aim to translate our findings toward improving human health outcomes in skin and other regenerative tissues.';
const SHARED_SHORT =
  'Studies cellular and molecular mechanisms controlling tissue biology and regeneration.';
const SHARED_URL = 'https://medicine.yale.edu/lab/horsley/';

type PersistedEntity = { archived?: boolean; fullDescription?: string; shortDescription?: string };

const entityDoc = (
  id: mongoose.Types.ObjectId,
  slug: string,
  fullDescription: string,
): Record<string, unknown> => ({
  _id: id,
  slug,
  name: 'Horsley Lab',
  kind: 'lab',
  entityType: 'LAB',
  archived: false,
  studentVisibilityTier: 'student_ready',
  fullDescription,
  shortDescription: SHARED_SHORT,
  sourceUrls: [SHARED_URL],
});

describe('dedupe merge description hydration (#2208)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => vi.clearAllMocks());

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'research_entity_redirects', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('carries the archived twin richer full description without neverDemote', async () => {
    const survivorId = new mongoose.Types.ObjectId();
    const twinId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db
      .collection('research_entities')
      .insertMany([
        entityDoc(survivorId, 'ysm-faculty-valerie-horsley', THIN_FULL),
        entityDoc(twinId, 'dept-mcdb-valerie-horsley', RICH_FULL),
      ]);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: survivorId.toHexString(),
        duplicateEntityIds: [twinId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [SHARED_URL],
      },
      // Deliberately NOT neverDemote: this is the default lane, which is where
      // the richer paragraph used to be stranded.
      { deleteDuplicates: false, relinkReferences: true },
    );

    const survivor = await ResearchEntity.findById(survivorId).lean<PersistedEntity>();
    const twin = await ResearchEntity.findById(twinId).lean<PersistedEntity>();
    expect(twin?.archived).toBe(true);
    expect(survivor?.archived).not.toBe(true);
    expect(survivor?.fullDescription).toBe(RICH_FULL);
  });

  it('never promotes a low-trust area or funding shell paragraph onto the survivor', async () => {
    const survivorId = new mongoose.Types.ObjectId();
    const fundingShellId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    // The shell paragraph is LONGER, so length alone would promote it.
    await db
      .collection('research_entities')
      .insertMany([
        entityDoc(survivorId, 'ysm-faculty-valerie-horsley', THIN_FULL),
        entityDoc(fundingShellId, 'nih-pi-valerie-horsley', RICH_FULL),
      ]);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: survivorId.toHexString(),
        duplicateEntityIds: [fundingShellId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [SHARED_URL],
      },
      { deleteDuplicates: false, relinkReferences: true },
    );

    const survivor = await ResearchEntity.findById(survivorId).lean<PersistedEntity>();
    expect(survivor?.fullDescription).toBe(THIN_FULL);
  });
});
