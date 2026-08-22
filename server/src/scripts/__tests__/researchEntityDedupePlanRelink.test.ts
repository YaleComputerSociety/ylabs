import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

const oid = () => new mongoose.Types.ObjectId();

describe('applyResearchEntityDedupeMergeGroup saved-plan relink', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await mongoose.connection.db!.collection('research_plans').createIndex(
      { accountId: 1, 'target.kind': 1, 'target.id': 1 },
      { unique: true },
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['research_entities', 'research_plans', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('moves saved plans to the canonical entity and archives conflicting duplicates', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = oid();
    const duplicateId = oid();
    const accountFollows = oid();
    const accountConflicts = oid();

    await db.collection('research_entities').insertMany([
      { _id: canonicalId, slug: 'named-lab', archived: false },
      { _id: duplicateId, slug: 'nsf-pi-shell', archived: false },
    ]);

    const planFollows = oid();
    const planConflictDuplicate = oid();
    const planConflictCanonical = oid();
    await db.collection('research_plans').insertMany([
      {
        _id: planFollows,
        accountId: accountFollows,
        target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
        archived: false,
      },
      {
        _id: planConflictDuplicate,
        accountId: accountConflicts,
        target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
        archived: false,
      },
      {
        _id: planConflictCanonical,
        accountId: accountConflicts,
        target: { kind: 'RESEARCH_ENTITY', id: canonicalId },
        archived: false,
      },
    ]);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      } as any,
      { deleteDuplicates: false, relinkReferences: true },
    );

    const followed = await db.collection('research_plans').findOne({ _id: planFollows });
    expect(String(followed?.target?.id)).toBe(canonicalId.toHexString());
    expect(followed?.archived).not.toBe(true);

    const survivingCanonical = await db
      .collection('research_plans')
      .findOne({ _id: planConflictCanonical });
    expect(String(survivingCanonical?.target?.id)).toBe(canonicalId.toHexString());
    expect(survivingCanonical?.archived).not.toBe(true);

    const conflictDuplicate = await db
      .collection('research_plans')
      .findOne({ _id: planConflictDuplicate });
    expect(conflictDuplicate?.archived).toBe(true);

    const activePlansForConflictAccount = await db
      .collection('research_plans')
      .countDocuments({ accountId: accountConflicts, archived: { $ne: true } });
    expect(activePlansForConflictAccount).toBe(1);
  });
});
