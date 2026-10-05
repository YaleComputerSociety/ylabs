import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/studentVisibilityGateService', () => ({
  runStudentVisibilityGate: vi.fn(async () => ({ counts: { scanned: 1 } })),
  planStudentVisibilityGate: vi.fn(async () => []),
  applyStudentVisibilityGatePlans: vi.fn(async () => {}),
}));

import { declaredIndexName, mongoOptions } from '../../db/connections';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

const LIVE_RELATIONSHIP_INDEX_NAMES = [
  'sourceResearchEntityId_1_targetResearchEntityId_1_relationshipType_1',
  'sourceResearchEntityId_1_relationshipType_1',
  'targetResearchEntityId_1_relationshipType_1',
  'sourceResearchEntityId_1_archived_1',
  'targetResearchEntityId_1_archived_1',
];

describe('the relationship model declares the unique edge index the dedupe relink depends on (#3933)', () => {
  it('declares every index the environments hold, under the names they hold it', () => {
    const declared = ResearchEntityRelationship.schema
      .indexes()
      .map(([key, options]) =>
        declaredIndexName(key as Record<string, unknown>, options as Record<string, unknown>),
      );
    expect(declared.sort()).toEqual([...LIVE_RELATIONSHIP_INDEX_NAMES].sort());
  });

  it('declares the source, target and type triple as unique', () => {
    const triple = ResearchEntityRelationship.schema
      .indexes()
      .find(
        ([key]) =>
          Object.keys(key).join(',') ===
          'sourceResearchEntityId,targetResearchEntityId,relationshipType',
      );
    expect(triple?.[1]).toMatchObject({ unique: true });
  });
});

describe('a dedupe relink on a database built from the model (#3933)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), mongoOptions);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
      await db.dropCollection(name);
    }
    await db.createCollection('research_entity_relationships');
    await ResearchEntityRelationship.createIndexes();
  });

  it('archives the loser edge that would duplicate the survivor edge instead of keeping both live', async () => {
    const db = mongoose.connection.db!;
    const survivorId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    const centerId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      { _id: survivorId, slug: 'probe-survivor-lab', name: 'Probe Survivor Lab', archived: false },
      {
        _id: duplicateId,
        slug: 'probe-duplicate-lab',
        name: 'Probe Duplicate Lab',
        archived: false,
      },
      { _id: centerId, slug: 'probe-center', name: 'Probe Center', archived: false },
    ]);
    await db.collection('research_entity_relationships').insertMany([
      {
        sourceResearchEntityId: centerId,
        targetResearchEntityId: survivorId,
        relationshipType: 'AFFILIATED_LAB',
        archived: false,
      },
      {
        sourceResearchEntityId: centerId,
        targetResearchEntityId: duplicateId,
        relationshipType: 'AFFILIATED_LAB',
        archived: false,
      },
    ]);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: survivorId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
      { deleteDuplicates: false, relinkReferences: true, redirectReason: 'probe_merge' },
    );

    const edges = await db.collection('research_entity_relationships').find({}).toArray();
    const live = edges.filter((edge) => edge.archived !== true);
    expect(
      live.map((edge) => [
        String(edge.sourceResearchEntityId),
        String(edge.targetResearchEntityId),
      ]),
    ).toEqual([[centerId.toHexString(), survivorId.toHexString()]]);
    expect(edges.filter((edge) => edge.archived === true)).toHaveLength(1);
  });
});
