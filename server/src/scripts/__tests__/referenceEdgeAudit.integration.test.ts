import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { auditReferenceEdge, type ReferenceEdge } from '../referenceEdgeAudit';

const evidenceEdge: ReferenceEdge = {
  name: 'signals.source.evidenceIds',
  collectionName: 'signals',
  localField: 'source.evidenceIds',
  targetCollectionName: 'observations',
  required: false,
};

const scalarEdge: ReferenceEdge = {
  name: 'signals.researchEntityId',
  collectionName: 'signals',
  localField: 'researchEntityId',
  targetCollectionName: 'research_entities',
  required: true,
};

const memberEdge: ReferenceEdge = {
  name: 'research_entity_members.userId',
  collectionName: 'research_entity_members',
  localField: 'userId',
  targetCollectionName: 'users',
  required: false,
  ownerFilter: { archived: { $ne: true } },
};

describe('auditReferenceEdge (integration)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['signals', 'observations', 'research_entity_members', 'users']) {
      await db.collection(name).deleteMany({});
    }
  });

  const db = () => {
    const handle = mongoose.connection.db;
    if (!handle) throw new Error('no db');
    return handle;
  };

  it('counts a dangling evidence id and never counts an absent reference', async () => {
    const liveObservation = new mongoose.Types.ObjectId();
    const missingObservation = new mongoose.Types.ObjectId();
    await db().collection('observations').insertOne({ _id: liveObservation });
    await db()
      .collection('signals')
      .insertMany([
        { note: 'no evidence array at all', source: {} },
        { note: 'schema default empty array', source: { evidenceIds: [] } },
        { note: 'resolves', source: { evidenceIds: [liveObservation] } },
        {
          note: 'one resolves one dangles',
          source: { evidenceIds: [liveObservation, missingObservation] },
        },
      ]);

    const audit = await auditReferenceEdge(db(), evidenceEdge, { includeSamples: true });

    expect(audit.orphanedPresentRefs).toBe(1);
    expect(audit.missingRequired).toBe(0);
    expect(audit.samples).toEqual([
      expect.objectContaining({
        collection: 'signals',
        field: 'source.evidenceIds',
        failureType: 'orphaned_present_ref',
        value: missingObservation.toString(),
      }),
    ]);
  });

  it('reports zero orphans when every signal carries the schema-default empty array', async () => {
    await db()
      .collection('signals')
      .insertMany([{ source: { evidenceIds: [] } }, { source: { evidenceIds: [] } }]);

    const audit = await auditReferenceEdge(db(), evidenceEdge);

    expect(audit.orphanedPresentRefs).toBe(0);
  });

  it('still counts a dangling scalar reference and a missing required one', async () => {
    const liveEntity = new mongoose.Types.ObjectId();
    const missingEntity = new mongoose.Types.ObjectId();
    await db().collection('research_entities').insertOne({ _id: liveEntity });
    await db()
      .collection('signals')
      .insertMany([
        { researchEntityId: liveEntity },
        { researchEntityId: missingEntity },
        { researchEntityId: null },
        {},
      ]);

    const audit = await auditReferenceEdge(db(), scalarEdge);

    expect(audit.orphanedPresentRefs).toBe(1);
    expect(audit.missingRequired).toBe(2);
  });

  it('honours an owner filter so archived rows do not contribute orphans', async () => {
    const missingUser = new mongoose.Types.ObjectId();
    await db()
      .collection('research_entity_members')
      .insertMany([
        { userId: missingUser, archived: true },
        { userId: missingUser, archived: false },
      ]);

    const audit = await auditReferenceEdge(db(), memberEdge);

    expect(audit.orphanedPresentRefs).toBe(1);
  });
});
