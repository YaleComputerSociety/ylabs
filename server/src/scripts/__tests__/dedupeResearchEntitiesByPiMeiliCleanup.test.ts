import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteFromIndexMock = vi.fn(async (_entityType: string, _id: string) => {});

vi.mock('../../services/meiliSyncService', () => ({
  deleteFromIndex: (entityType: string, id: string) => deleteFromIndexMock(entityType, id),
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
});
