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

describe('merge lead-edge conflict is judged on the survivor’s live edges (#3909)', () => {
  let replSet: MongoMemoryReplSet;
  const personId = new mongoose.Types.ObjectId();
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
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: 'Jane Roe',
      archived: false,
    });
    await db.collection('research_entities').insertMany([
      {
        _id: survivorId,
        slug: 'faculty-research-area-jane-roe',
        name: 'Jane Roe Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
      },
      {
        _id: loserId,
        slug: 'nih-pi-jane-roe',
        name: 'Jane Roe Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
      },
    ]);
  });

  const seedEdges = async (survivorEdge: Record<string, unknown>) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('role_assignments').insertMany([
      {
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: survivorId },
        role: 'PI',
        ...survivorEdge,
      },
      {
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: loserId },
        role: 'PI',
        state: 'CURRENT',
        archived: false,
      },
    ]);
  };

  const merge = () =>
    applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: survivorId.toHexString(),
        duplicateEntityIds: [loserId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
      { deleteDuplicates: false, relinkReferences: true },
    );

  const liveLeadCount = () =>
    mongoose.connection.db!.collection('role_assignments').countDocuments({
      'target.id': survivorId,
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    });

  it('repoints the loser’s live edge when the survivor’s only matching edge is historical', async () => {
    await seedEdges({ state: 'HISTORICAL', archived: false });
    const result = await merge();
    expect(result.retiredConflictingMembers).toBe(0);
    expect(result.relinkedMembers).toBe(1);
    expect(await liveLeadCount()).toBe(1);
  });

  it('repoints the loser’s live edge when the survivor’s only matching edge is archived', async () => {
    await seedEdges({ state: 'CURRENT', archived: true });
    await merge();
    expect(await liveLeadCount()).toBe(1);
  });

  it('still retires the loser’s edge when the survivor holds a live one for the same role', async () => {
    await seedEdges({ state: 'CURRENT', archived: false });
    const result = await merge();
    expect(result.retiredConflictingMembers).toBe(1);
    expect(await liveLeadCount()).toBe(1);
  });
});
