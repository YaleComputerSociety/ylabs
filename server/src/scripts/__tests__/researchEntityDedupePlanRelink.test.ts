import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteFromIndexMock = vi.fn(async (_entityType: string, _id: string) => {});

vi.mock('../../services/meiliSyncService', () => ({
  deleteFromIndex: (entityType: string, id: string) => deleteFromIndexMock(entityType, id),
}));

import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';
import { buildOrgNameResearchEntityDedupePlan } from '../researchEntityPiDedupeCore';

const oid = () => new mongoose.Types.ObjectId();

describe('applyResearchEntityDedupeMergeGroup saved-plan relink', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await mongoose.connection
      .db!.collection('research_plans')
      .createIndex({ accountId: 1, 'target.kind': 1, 'target.id': 1 }, { unique: true });
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

describe('applyResearchEntityDedupeMergeGroup field-merge carry', () => {
  let replSet2: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet2 = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet2.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet2.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
  });

  it('writes the carried best website and fullest description onto the canonical entity', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      { _id: canonicalId, slug: 'yse-faculty-example', archived: false, fullDescription: 'thin' },
      { _id: duplicateId, slug: 'nsf-pi-shell', archived: false, fullDescription: 'X'.repeat(400) },
    ]);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
        canonicalWebsiteUrl: 'https://example-lab.research.yale.edu/',
        canonicalFullDescription: 'X'.repeat(400),
      } as any,
      { deleteDuplicates: false, relinkReferences: true },
    );

    const canonical = await db.collection('research_entities').findOne({ _id: canonicalId });
    expect(canonical?.websiteUrl).toBe('https://example-lab.research.yale.edu/');
    expect(canonical?.fullDescription).toBe('X'.repeat(400));
  });

  it('writes carried recentGrants/recentGrantCount/fundingAgencies onto the canonical entity (#819)', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      {
        _id: canonicalId,
        slug: 'yse-faculty-example',
        archived: false,
        recentGrantCount: 0,
        fundingAgencies: [],
      },
      { _id: duplicateId, slug: 'nih-pi-shell', archived: false },
    ]);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: ['https://reporter.nih.gov/project-details/10000001'],
        mergedRecentGrants: [
          {
            id: '10000001',
            agency: 'NIH',
            title: 'Fixture grant',
            startDate: new Date('2023-06-01'),
            url: 'https://reporter.nih.gov/project-details/10000001',
          },
        ],
        mergedRecentGrantCount: 1,
        mergedFundingAgencies: ['NIH'],
      } as any,
      { deleteDuplicates: false, relinkReferences: true },
    );

    const canonical = await db.collection('research_entities').findOne({ _id: canonicalId });
    expect(canonical?.recentGrantCount).toBe(1);
    expect(canonical?.fundingAgencies).toEqual(['NIH']);
    expect(canonical?.recentGrants).toEqual([
      expect.objectContaining({ id: '10000001', agency: 'NIH' }),
    ]);
  });
});

describe('org-name dedupe archives the shell twin and redirects it to the survivor', () => {
  let replSet3: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet3 = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet3.getUri());
    await mongoose.connection
      .db!.collection('research_plans')
      .createIndex({ accountId: 1, 'target.kind': 1, 'target.id': 1 }, { unique: true });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet3.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['research_entities', 'research_plans', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('points the archived shell at the survivor and relinks its saved plan (#584 no-orphans net)', async () => {
    const db = mongoose.connection.db!;
    const survivorId = oid();
    const shellId = oid();
    const accountId = oid();

    await db.collection('research_entities').insertMany([
      {
        _id: survivorId,
        slug: 'center-synthetic-institute',
        name: 'Yale Synthetic Institute',
        entityType: 'INSTITUTE',
        archived: false,
        departments: ['Physics'],
      },
      {
        _id: shellId,
        slug: 'yale-research-center-synthetic-institute',
        name: 'Yale Synthetic Institute',
        entityType: 'INSTITUTE',
        archived: false,
        websiteUrl: 'https://synthinstitute.yale.edu/',
        sourceUrls: ['https://synthinstitute.yale.edu/'],
      },
    ]);
    const planId = oid();
    await db.collection('research_plans').insertOne({
      _id: planId,
      accountId,
      target: { kind: 'RESEARCH_ENTITY', id: shellId },
      archived: false,
    });

    const plan = buildOrgNameResearchEntityDedupePlan([
      {
        id: survivorId.toHexString(),
        slug: 'center-synthetic-institute',
        name: 'Yale Synthetic Institute',
        entityType: 'INSTITUTE',
        departments: ['Physics'],
        memberCount: 15,
        sourceUrls: ['https://synthinstitute.yale.edu/people/members'],
      },
      {
        id: shellId.toHexString(),
        slug: 'yale-research-center-synthetic-institute',
        name: 'Yale Synthetic Institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://synthinstitute.yale.edu/',
        sourceUrls: ['https://synthinstitute.yale.edu/'],
        memberCount: 0,
      },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].canonicalEntityId).toBe(survivorId.toHexString());
    expect(plan[0].duplicateEntityIds).toEqual([shellId.toHexString()]);

    await applyResearchEntityDedupeMergeGroup(plan[0], {
      deleteDuplicates: false,
      relinkReferences: true,
    });

    const shell = await db.collection('research_entities').findOne({ _id: shellId });
    expect(shell?.archived).toBe(true);
    expect(String(shell?.canonicalGroupId)).toBe(survivorId.toHexString());

    const survivor = await db.collection('research_entities').findOne({ _id: survivorId });
    expect(survivor?.archived).not.toBe(true);
    expect(survivor?.websiteUrl).toBe('https://synthinstitute.yale.edu/');

    const relinkedPlan = await db.collection('research_plans').findOne({ _id: planId });
    expect(String(relinkedPlan?.target?.id)).toBe(survivorId.toHexString());
    expect(relinkedPlan?.archived).not.toBe(true);
  });
});

describe('applyResearchEntityDedupeMergeGroup removes merged-loser search documents (#1198)', () => {
  let replSet4: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet4 = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet4.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet4.stop();
  });

  beforeEach(async () => {
    deleteFromIndexMock.mockClear();
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
  });

  it('deletes the archived duplicate from the Meili index in archive mode', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = oid();
    const duplicateId = oid();
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
      { deleteDuplicates: false, relinkReferences: true },
    );

    expect(result.archivedEntities).toBe(1);
    expect(result.searchDocumentsDeleted).toBe(1);
    expect(deleteFromIndexMock).toHaveBeenCalledWith('researchEntity', duplicateId.toHexString());
  });

  it('deletes the hard-deleted duplicate from the Meili index in delete mode', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = oid();
    const duplicateId = oid();
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
      { deleteDuplicates: true, relinkReferences: true },
    );

    expect(result.deletedEntities).toBe(1);
    expect(result.searchDocumentsDeleted).toBe(1);
    expect(deleteFromIndexMock).toHaveBeenCalledWith('researchEntity', duplicateId.toHexString());
    const surviving = await db.collection('research_entities').findOne({ _id: duplicateId });
    expect(surviving).toBeNull();
  });

  it('deletes a duplicate already archived by a prior dedupe pass', async () => {
    const db = mongoose.connection.db!;
    const canonicalId = oid();
    const duplicateId = oid();
    await db.collection('research_entities').insertMany([
      { _id: canonicalId, slug: 'named-lab', archived: false },
      { _id: duplicateId, slug: 'nsf-pi-shell', archived: true },
    ]);

    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: canonicalId.toHexString(),
        duplicateEntityIds: [duplicateId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      } as any,
      { deleteDuplicates: false, relinkReferences: true },
    );

    expect(result.archivedEntities).toBe(0);
    expect(result.searchDocumentsDeleted).toBe(1);
    expect(deleteFromIndexMock).toHaveBeenCalledWith('researchEntity', duplicateId.toHexString());
  });
});
