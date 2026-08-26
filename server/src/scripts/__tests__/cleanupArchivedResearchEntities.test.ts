import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ResearchEntity } from '../../models/researchEntity';
import {
  assertCleanupArchivedResearchEntitiesApplyAllowed,
  cleanupArchivedResearchEntities,
  parseCleanupArchivedResearchEntitiesArgs,
} from '../cleanupArchivedResearchEntities';

describe('cleanupArchivedResearchEntities CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseCleanupArchivedResearchEntitiesArgs([])).toEqual({
      apply: false,
      confirmArchivedEntityCleanup: false,
      limit: 100,
      limitProvided: false,
      maxApply: 25,
      mergeResidueOnly: false,
    });
    expect(
      parseCleanupArchivedResearchEntitiesArgs([
        '--apply',
        '--confirm-archived-entity-cleanup',
        '--limit=200',
        '--max-apply=200',
        '--merge-residue-only',
      ]),
    ).toEqual({
      apply: true,
      confirmArchivedEntityCleanup: true,
      limit: 200,
      limitProvided: true,
      maxApply: 200,
      mergeResidueOnly: true,
    });
  });

  it('rejects malformed cleanup CLI arguments', () => {
    expect(() => parseCleanupArchivedResearchEntitiesArgs(['prod'])).toThrow(
      /Unknown research-entity:cleanup-archived argument: prod/,
    );
    expect(() => parseCleanupArchivedResearchEntitiesArgs(['--limit'])).toThrow(
      /--limit requires a number/,
    );
    expect(() =>
      parseCleanupArchivedResearchEntitiesArgs(['--confirm-archived-entity-cleanup=1']),
    ).toThrow(/does not accept a value/);
    expect(() =>
      parseCleanupArchivedResearchEntitiesArgs(['--merge-residue-only=1']),
    ).toThrow(/does not accept a value/);
  });

  it('requires --limit and confirmation when applying, and enforces --max-apply', () => {
    expect(() =>
      assertCleanupArchivedResearchEntitiesApplyAllowed({
        apply: true,
        confirmArchivedEntityCleanup: true,
        limitProvided: false,
        maxApply: 25,
        plannedDeletes: 0,
      }),
    ).toThrow(/--limit is required/);
    expect(() =>
      assertCleanupArchivedResearchEntitiesApplyAllowed({
        apply: true,
        confirmArchivedEntityCleanup: false,
        limitProvided: true,
        maxApply: 25,
        plannedDeletes: 0,
      }),
    ).toThrow(/--confirm-archived-entity-cleanup is required/);
    expect(() =>
      assertCleanupArchivedResearchEntitiesApplyAllowed({
        apply: true,
        confirmArchivedEntityCleanup: true,
        limitProvided: true,
        maxApply: 1,
        plannedDeletes: 5,
      }),
    ).toThrow(/above --max-apply/);
    expect(() =>
      assertCleanupArchivedResearchEntitiesApplyAllowed({
        apply: false,
        maxApply: 1,
        plannedDeletes: 999,
      }),
    ).not.toThrow();
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

function fakeSearchIndex(deleted: string[][]) {
  return (async () => ({
    deleteDocuments: async (ids: string[]) => {
      deleted.push(ids);
      return { taskUid: 1 };
    },
  })) as any;
}

describe('cleanupArchivedResearchEntities with MongoDB', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.CLEANUP_ARCHIVED_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('cleanup_archived_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  async function insertArchivedEntity(name: string): Promise<mongoose.Types.ObjectId> {
    const id = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({
      _id: id,
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      archived: true,
    });
    return id;
  }

  it('blocks archived entities that still have a live dependent reference', async () => {
    const blockedId = await insertArchivedEntity('Blocked Home');
    await mongoose.connection.db!.collection('signals').insertOne({
      researchEntityId: blockedId,
      archived: false,
    });

    const dryRun = await cleanupArchivedResearchEntities({ apply: false, limit: 100 });
    expect(dryRun.plan.eligible).toEqual([]);
    expect(dryRun.plan.blockedCount).toBe(1);
    expect(dryRun.plan.blocked[0]).toMatchObject({
      id: String(blockedId),
      references: [{ collection: 'signals', field: 'researchEntityId', count: 1 }],
    });

    await expect(ResearchEntity.countDocuments({ _id: blockedId })).resolves.toBe(1);
  });

  it('blocks archived entities referenced by a string-typed researchEntityId', async () => {
    const blockedId = await insertArchivedEntity('String Referenced Home');
    await mongoose.connection.db!.collection('signals').insertOne({
      researchEntityId: String(blockedId),
      archived: false,
    });

    const dryRun = await cleanupArchivedResearchEntities({ apply: false, limit: 100 });
    expect(dryRun.plan.eligible).toEqual([]);
    expect(dryRun.plan.blockedCount).toBe(1);
    expect(dryRun.plan.blocked[0]).toMatchObject({
      id: String(blockedId),
      references: [{ collection: 'signals', field: 'researchEntityId', count: 1 }],
    });

    await expect(ResearchEntity.countDocuments({ _id: blockedId })).resolves.toBe(1);
  });

  it('performs no writes in dry-run mode', async () => {
    const eligibleId = await insertArchivedEntity('Eligible Home');
    await mongoose.connection.db!.collection('signals').insertOne({
      researchEntityId: eligibleId,
      archived: true,
    });

    const deleted: string[][] = [];
    const dryRun = await cleanupArchivedResearchEntities({
      apply: false,
      limit: 100,
      getIndex: fakeSearchIndex(deleted),
    });

    expect(dryRun.plan.eligible).toEqual([String(eligibleId)]);
    expect(dryRun.deletedResearchEntities).toBe(0);
    expect(deleted).toEqual([]);
    await expect(ResearchEntity.countDocuments({ _id: eligibleId })).resolves.toBe(1);
    await expect(mongoose.connection.db!.collection('signals').countDocuments({})).resolves.toBe(1);
  });

  it('applies deletions only to eligible archived entities and their dependents', async () => {
    const eligibleId = await insertArchivedEntity('Eligible Home');
    const blockedId = await insertArchivedEntity('Blocked Home');
    await mongoose.connection.db!.collection('signals').insertMany([
      { researchEntityId: eligibleId, archived: true },
      { researchEntityId: blockedId, archived: false },
    ]);

    const deleted: string[][] = [];
    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      getIndex: fakeSearchIndex(deleted),
    });

    expect(applied.mode).toBe('apply');
    expect(applied.deletedResearchEntities).toBe(1);
    expect(applied.deletedDependents).toMatchObject({ signals: 1 });
    expect(deleted).toEqual([[String(eligibleId)]]);

    await expect(ResearchEntity.countDocuments({ _id: eligibleId })).resolves.toBe(0);
    await expect(ResearchEntity.countDocuments({ _id: blockedId })).resolves.toBe(1);
    await expect(mongoose.connection.db!.collection('signals').countDocuments({})).resolves.toBe(1);
  });

  it('scopes to merge residue when mergeResidueOnly is set', async () => {
    const canonicalId = new mongoose.Types.ObjectId();
    const suppressionId = await insertArchivedEntity('Suppression Hold');
    const mergeResidueId = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({
      _id: mergeResidueId,
      name: 'Merge Residue Home',
      slug: 'merge-residue-home',
      archived: true,
      canonicalGroupId: canonicalId,
    });

    const scoped = await cleanupArchivedResearchEntities({
      apply: false,
      limit: 100,
      mergeResidueOnly: true,
    });
    expect(scoped.plan.scanned).toBe(1);
    expect(scoped.plan.eligible).toEqual([String(mergeResidueId)]);

    const unscoped = await cleanupArchivedResearchEntities({ apply: false, limit: 100 });
    expect(unscoped.plan.scanned).toBe(2);
    expect(new Set(unscoped.plan.eligible)).toEqual(
      new Set([String(mergeResidueId), String(suppressionId)]),
    );
  });
});
