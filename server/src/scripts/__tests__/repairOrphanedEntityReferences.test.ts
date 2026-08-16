import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchGroupMember } from '../../models/researchGroupMember';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { parseArgs, runOrphanedEntityReferenceRepair } from '../repairOrphanedEntityReferences';
import {
  assertConnectedDatabaseMatchesEnvironment,
  buildOrphanedEntityReferencePlan,
} from '../repairOrphanedEntityReferencesCore';

describe('repairOrphanedEntityReferences CLI helpers', () => {
  it('defaults to a dry-run and requires a supported environment', () => {
    expect(parseArgs(['--environment=development'])).toEqual({
      environment: 'development',
      apply: false,
      confirm: false,
      limit: 1000,
      output: undefined,
    });
    expect(() => parseArgs([])).toThrow(/--environment is required/);
    expect(() => parseArgs(['--environment=staging'])).toThrow(/--environment is required/);
  });

  it('refuses to apply without the confirmation flag', () => {
    expect(() => parseArgs(['--environment=beta', '--apply'])).toThrow(
      /Refusing to apply without --confirm-orphaned-entity-reference-repair/,
    );
    expect(
      parseArgs(['--environment=beta', '--apply', '--confirm-orphaned-entity-reference-repair']),
    ).toMatchObject({ apply: true, confirm: true });
  });

  it('rejects a value on the confirmation flag and unknown args', () => {
    expect(() =>
      parseArgs(['--environment=beta', '--confirm-orphaned-entity-reference-repair=1']),
    ).toThrow(/does not accept a value/);
    expect(() => parseArgs(['--environment=beta', '--limit=0'])).toThrow(
      /--limit must be a positive integer/,
    );
  });
});

describe('assertConnectedDatabaseMatchesEnvironment', () => {
  it('passes when the connected database matches the environment', () => {
    expect(() =>
      assertConnectedDatabaseMatchesEnvironment({
        environment: 'beta',
        connectedDatabaseName: 'Beta',
        scriptName: 'test',
      }),
    ).not.toThrow();
  });

  it('throws when the connected database does not match', () => {
    expect(() =>
      assertConnectedDatabaseMatchesEnvironment({
        environment: 'production-copy',
        connectedDatabaseName: 'Production',
        scriptName: 'test',
      }),
    ).toThrow(/expected the ProductionCopy database/);
  });
});

describe('buildOrphanedEntityReferencePlan', () => {
  it('counts relationship types and directions and flags truncation', () => {
    const plan = buildOrphanedEntityReferencePlan({
      memberRows: [{ _id: 'm1' }, { _id: 'm2' }],
      relationshipRows: [
        { _id: 'r1', relationshipType: 'MEMBER_RESEARCH_AREA', targetMissing: true },
        { _id: 'r2', relationshipType: 'MEMBER_RESEARCH_AREA', sourceMissing: true },
      ],
      limit: 2,
    });
    expect(plan.memberArchiveIds).toEqual(['m1', 'm2']);
    expect(plan.relationshipDeleteIds).toEqual(['r1', 'r2']);
    expect(plan.relationshipTypeCounts).toEqual({ MEMBER_RESEARCH_AREA: 2 });
    expect(plan.relationshipDirectionCounts).toEqual({ sourceMissing: 1, targetMissing: 1 });
    expect(plan.possibleTruncation).toEqual({ members: true, relationships: true });
  });
});

describe('runOrphanedEntityReferenceRepair with MongoDB', () => {
  let memoryReplSet: MongoMemoryReplSet | undefined;

  beforeAll(async () => {
    let mongoUrl = process.env.REPAIR_ORPHAN_REFS_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('repair_orphan_refs_test');
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

  async function seed(): Promise<{ liveEntityId: mongoose.Types.ObjectId; goneId: mongoose.Types.ObjectId }> {
    const liveEntityId = new mongoose.Types.ObjectId();
    const goneId = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({ _id: liveEntityId, name: 'Live Home', archived: false });

    await ResearchGroupMember.collection.insertMany([
      { _id: new mongoose.Types.ObjectId(), researchEntityId: liveEntityId, isCurrentMember: true, archived: false },
      { _id: new mongoose.Types.ObjectId(), researchEntityId: goneId, isCurrentMember: true, archived: false },
    ]);
    await ResearchEntityRelationship.collection.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        relationshipType: 'MEMBER_RESEARCH_AREA',
        sourceResearchEntityId: liveEntityId,
        targetResearchEntityId: liveEntityId,
        archived: false,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        relationshipType: 'MEMBER_RESEARCH_AREA',
        sourceResearchEntityId: liveEntityId,
        targetResearchEntityId: goneId,
        archived: false,
      },
    ]);
    return { liveEntityId, goneId };
  }

  it('detects only references to missing entities in a dry run and mutates nothing', async () => {
    await seed();
    const dryRun = await runOrphanedEntityReferenceRepair({ apply: false, limit: 1000 });

    expect(dryRun.summary.membersToArchive).toBe(1);
    expect(dryRun.summary.relationshipsToDelete).toBe(1);
    expect(dryRun.summary.relationshipDirectionCounts).toEqual({ sourceMissing: 0, targetMissing: 1 });
    expect(dryRun.applied).toBeNull();

    await expect(ResearchEntityRelationship.collection.countDocuments({})).resolves.toBe(2);
    await expect(
      ResearchGroupMember.collection.countDocuments({ archived: { $ne: true } }),
    ).resolves.toBe(2);
  });

  it('deletes dangling relationships and archives orphan members on apply, leaving live refs intact', async () => {
    const { liveEntityId } = await seed();
    const result = await runOrphanedEntityReferenceRepair({ apply: true, limit: 1000 });

    expect(result.applied).toEqual({ relationshipsDeleted: 1, membersArchived: 1 });

    const remainingRelationships = await ResearchEntityRelationship.collection.find({}).toArray();
    expect(remainingRelationships).toHaveLength(1);
    expect(String(remainingRelationships[0].targetResearchEntityId)).toBe(String(liveEntityId));

    await expect(
      ResearchGroupMember.collection.countDocuments({ archived: true, isCurrentMember: false }),
    ).resolves.toBe(1);
    await expect(
      ResearchGroupMember.collection.countDocuments({ researchEntityId: liveEntityId, archived: { $ne: true } }),
    ).resolves.toBe(1);

    const second = await runOrphanedEntityReferenceRepair({ apply: false, limit: 1000 });
    expect(second.summary.membersToArchive).toBe(0);
    expect(second.summary.relationshipsToDelete).toBe(0);
  });
});
