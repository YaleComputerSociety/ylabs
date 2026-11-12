import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

describe('a merge keeps every co-director as a lead (#5969)', () => {
  let replSet: MongoMemoryReplSet;
  const directorId = new mongoose.Types.ObjectId();
  const coDirectorId = new mongoose.Types.ObjectId();
  const survivorId = new mongoose.Types.ObjectId();
  const loserId = new mongoose.Types.ObjectId();

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
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('researchers').insertMany([
      { _id: directorId, displayName: 'Ada Alpha', archived: false },
      { _id: coDirectorId, displayName: 'Bram Orlo', archived: false },
    ]);
    await db.collection('research_entities').insertMany([
      {
        _id: survivorId,
        slug: 'synthetic-outcomes-program',
        name: 'Synthetic Outcomes Program',
        entityType: 'LAB',
        archived: false,
      },
      {
        _id: loserId,
        slug: 'ysm-faculty-bram-orlo',
        name: 'Synthetic Outcomes Program',
        entityType: 'LAB',
        archived: false,
      },
    ]);
    const edge = (
      personId: mongoose.Types.ObjectId,
      id: mongoose.Types.ObjectId,
      role: string,
    ) => ({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id },
      role,
      state: 'CURRENT',
      archived: false,
    });
    await db
      .collection('role_assignments')
      .insertMany([
        edge(directorId, survivorId, 'PI'),
        edge(directorId, loserId, 'PI'),
        edge(coDirectorId, loserId, 'CO_DIRECTOR'),
      ]);
  });

  it('repoints the co-director’s edge onto the survivor and retires only the repeated one', async () => {
    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: survivorId.toHexString(),
        duplicateEntityIds: [loserId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
      { deleteDuplicates: false, relinkReferences: true },
    );
    expect(result.retiredConflictingMembers).toBe(1);
    const live = await mongoose.connection
      .db!.collection('role_assignments')
      .find({ 'target.id': survivorId, state: { $ne: 'HISTORICAL' }, archived: { $ne: true } })
      .toArray();
    expect(live.map((edge) => `${String(edge.personId)}:${edge.role}`).sort()).toEqual(
      [`${String(directorId)}:PI`, `${String(coDirectorId)}:CO_DIRECTOR`].sort(),
    );
  });
});
