import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteFromIndexMock = vi.fn(async (_entityType: string, _id: string) => {});
const syncEntitiesMock = vi.fn(async (_entityType: string, _docs: unknown[]) => {});

vi.mock('../../services/meiliSyncService', () => ({
  deleteFromIndex: (entityType: string, id: string) => deleteFromIndexMock(entityType, id),
  syncEntities: (entityType: string, docs: unknown[]) => syncEntitiesMock(entityType, docs),
  syncEntity: vi.fn(async () => {}),
}));

import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

describe('applyResearchEntityDedupeMergeGroup Meili ghost-doc cleanup', () => {
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
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
  });

  afterEach(() => {
    deleteFromIndexMock.mockClear();
    syncEntitiesMock.mockClear();
  });

  it('deletes the archived duplicate from the Meili index', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      { _id: canonicalId, slug: 'named-lab', archived: false },
      { _id: duplicateId, slug: 'nsf-pi-shell', archived: false },
    ]);

    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      } as any,
      { deleteDuplicates: false, relinkReferences: false },
    );

    const duplicate = await db.collection('research_entities').findOne({ _id: duplicateId });
    expect(duplicate?.archived).toBe(true);
    expect(deleteFromIndexMock).toHaveBeenCalledWith('researchEntity', duplicateId.toHexString());
    expect(result.removedFromSearchIndex).toBe(1);
  });

  it('deletes the hard-deleted duplicate from the Meili index', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      { _id: canonicalId, slug: 'named-lab', archived: false },
      { _id: duplicateId, slug: 'nsf-pi-shell', archived: false },
    ]);

    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      } as any,
      { deleteDuplicates: true, relinkReferences: false },
    );

    const duplicate = await db.collection('research_entities').findOne({ _id: duplicateId });
    expect(duplicate).toBeNull();
    expect(deleteFromIndexMock).toHaveBeenCalledWith('researchEntity', duplicateId.toHexString());
    expect(result.removedFromSearchIndex).toBe(1);
  });

  it('re-syncs an already-servable survivor whose tier never moves (#2239)', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      {
        _id: canonicalId,
        slug: 'named-lab',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
      { _id: duplicateId, slug: 'nsf-pi-shell', archived: false },
    ]);

    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      } as any,
      { deleteDuplicates: false, relinkReferences: false },
    );

    expect(result.survivorVisibility.regated).toBe(false);
    expect(result.survivorIndexResynced).toBe(true);
    expect(syncEntitiesMock).toHaveBeenCalledTimes(1);
    const [entityType, docs] = syncEntitiesMock.mock.calls[0];
    expect(entityType).toBe('researchEntity');
    expect((docs as Array<{ _id: mongoose.Types.ObjectId }>)[0]._id.toHexString()).toBe(
      canonicalId.toHexString(),
    );
  });

  it('does not re-sync an archived survivor', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      { _id: canonicalId, slug: 'named-lab', archived: true },
      { _id: duplicateId, slug: 'nsf-pi-shell', archived: false },
    ]);

    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      } as any,
      { deleteDuplicates: false, relinkReferences: false },
    );

    expect(result.survivorIndexResynced).toBe(false);
    expect(syncEntitiesMock).not.toHaveBeenCalled();
  });
});
