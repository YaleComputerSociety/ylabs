import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ResearchEntity } from '../../models/researchEntity';
import { resolveResearchEntityCanonicalIdentity } from '../../services/researchEntityCanonicalTombstone';
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
    expect(() => parseCleanupArchivedResearchEntitiesArgs(['--merge-residue-only=1'])).toThrow(
      /does not accept a value/,
    );
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

  async function insertCanonicalEntity(name: string): Promise<mongoose.Types.ObjectId> {
    const id = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({
      _id: id,
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      archived: false,
    });
    return id;
  }

  async function insertMergeResidue(
    name: string,
    canonicalId: mongoose.Types.ObjectId,
  ): Promise<{ id: mongoose.Types.ObjectId; slug: string }> {
    const id = new mongoose.Types.ObjectId();
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    await ResearchEntity.collection.insertOne({
      _id: id,
      name,
      slug,
      archived: true,
      canonicalGroupId: canonicalId,
    });
    return { id, slug };
  }

  async function insertRedirect(
    shell: { id: mongoose.Types.ObjectId; slug: string },
    canonicalId: mongoose.Types.ObjectId,
  ): Promise<void> {
    await mongoose.connection.db!.collection('research_entity_redirects').insertOne({
      mergedEntityId: shell.id,
      mergedSlug: shell.slug,
      canonicalEntityId: canonicalId,
      canonicalGroupId: canonicalId,
      reason: 'eponymous_fra_lab_merge',
      mergedAt: new Date(),
    });
  }

  // Default mode fails closed on a row whose slug has no surviving redirect (#2795), so a fixture
  // that is meant to be deletable has to carry one. Its own coverage is in the core plan tests.
  async function insertDeletableArchivedEntity(
    name: string,
    canonicalId: mongoose.Types.ObjectId,
  ): Promise<mongoose.Types.ObjectId> {
    const id = await insertArchivedEntity(name);
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    await insertRedirect({ id, slug }, canonicalId);
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
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const eligibleId = await insertDeletableArchivedEntity('Eligible Home', canonicalId);
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

    // Nothing is eligible any more (#3027), so this now asserts the weaker but still
    // meaningful dry-run property: no write of any kind, whatever the plan says.
    expect(dryRun.plan.eligible).toEqual([]);
    expect(dryRun.deletedResearchEntities).toBe(0);
    expect(deleted).toEqual([]);
    await expect(ResearchEntity.countDocuments({ _id: eligibleId })).resolves.toBe(1);
    await expect(mongoose.connection.db!.collection('signals').countDocuments({})).resolves.toBe(1);
  });

  // An apply now deletes nothing, because no archived row is deletable (#3027): a row
  // with a tombstone IS the canonical mapping, and a row without one is the only
  // surviving record of its slug. This is the end state of the two fail-closed arms
  // rather than a bug, and #3062 had already measured eligibleCount 0 on Development.
  it('deletes nothing on apply, because no archived row is deletable', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const tombstonedId = await insertDeletableArchivedEntity('Tombstoned Home', canonicalId);
    const untombstonedId = await insertArchivedEntity('Untombstoned Home');
    await mongoose.connection.db!.collection('signals').insertMany([
      { researchEntityId: tombstonedId, archived: true },
      { researchEntityId: untombstonedId, archived: false },
    ]);

    const deleted: string[][] = [];
    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      getIndex: fakeSearchIndex(deleted),
    });

    expect(applied.mode).toBe('apply');
    expect(applied.deletedResearchEntities).toBe(0);
    expect(applied.deletedDependents).toEqual({});
    expect(deleted).toEqual([]);

    await expect(ResearchEntity.countDocuments({ _id: tombstonedId })).resolves.toBe(1);
    await expect(ResearchEntity.countDocuments({ _id: untombstonedId })).resolves.toBe(1);
    await expect(mongoose.connection.db!.collection('signals').countDocuments({})).resolves.toBe(2);
  });

  it('scopes to merge residue when mergeResidueOnly is set', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const suppressionId = await insertDeletableArchivedEntity('Suppression Hold', canonicalId);
    const mergeResidue = await insertMergeResidue('Merge Residue Home', canonicalId);
    await insertRedirect(mergeResidue, canonicalId);

    const scoped = await cleanupArchivedResearchEntities({
      apply: false,
      limit: 100,
      mergeResidueOnly: true,
    });
    expect(scoped.plan.scanned).toBe(1);
    expect(scoped.plan.eligible).toEqual([]);

    const unscoped = await cleanupArchivedResearchEntities({ apply: false, limit: 100 });
    expect(unscoped.plan.scanned).toBe(2);
    expect(unscoped.plan.eligible).toEqual([]);
    expect(unscoped.plan.blocked.map((row) => row.id)).toContain(String(suppressionId));
  });

  it('refuses to delete a row carrying no tombstone, as the sole record of its slug', async () => {
    const unrecordedId = await insertArchivedEntity('Unrecorded Archived Home');

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.eligible).toEqual([]);
    expect(applied.plan.blocked).toEqual([
      {
        id: String(unrecordedId),
        name: 'Unrecorded Archived Home',
        slug: 'unrecorded-archived-home',
        reason: 'sole_surviving_record_of_slug',
        references: [],
      },
    ]);
    expect(applied.deletedResearchEntities).toBe(0);
    await expect(ResearchEntity.countDocuments({ _id: unrecordedId })).resolves.toBe(1);
  });

  it('keeps inert merge residue, because its slug is what blocks a re-mint', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Inert Residue', canonicalId);
    await insertRedirect(residue, canonicalId);

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.eligible).toEqual([]);
    expect(applied.deletedResearchEntities).toBe(0);
    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
  });

  it('refuses to delete an unrecorded merge shell during a full archived sweep', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Unrecorded Residue', canonicalId);

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.eligible).toEqual([]);
    expect(applied.plan.deferredByReason.merged_shell_is_canonical_mapping).toBe(1);
    expect(applied.deletedResearchEntities).toBe(0);
    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
  });

  it('refuses a recorded merge shell during a full archived sweep too', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Recorded Residue', canonicalId);
    await insertRedirect(residue, canonicalId);

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.eligible).toEqual([]);
    expect(applied.plan.deferredByReason.merged_shell_is_canonical_mapping).toBe(1);
    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
  });

  it('keeps the shell slug resolving to the canonical, from the surviving row', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Resolvable Residue', canonicalId);
    await insertRedirect(residue, canonicalId);

    await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });

    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
    const resolved = await resolveResearchEntityCanonicalIdentity({ slug: residue.slug });
    expect(String(resolved?._id)).toBe(String(canonicalId));
  });

  it('refuses merge residue that still carries a live signal reference', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Live-Referenced Residue', canonicalId);
    await insertRedirect(residue, canonicalId);
    await mongoose.connection.db!.collection('signals').insertOne({
      researchEntityId: residue.id,
      archived: false,
    });

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.eligible).toEqual([]);
    expect(applied.plan.blocked[0]).toMatchObject({
      id: String(residue.id),
      reason: 'has_live_references',
      references: [{ collection: 'signals', field: 'researchEntityId', count: 1 }],
    });
    expect(applied.deletedResearchEntities).toBe(0);
    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
  });

  it('refuses merge residue that still carries a live role assignment', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Role-Referenced Residue', canonicalId);
    await insertRedirect(residue, canonicalId);
    await mongoose.connection.db!.collection('role_assignments').insertOne({
      target: { kind: 'RESEARCH_ENTITY', id: residue.id },
      role: 'PI',
      archived: false,
    });

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.eligible).toEqual([]);
    expect(applied.plan.blocked[0]).toMatchObject({
      id: String(residue.id),
      reason: 'has_live_references',
      references: [{ collection: 'role_assignments', field: 'target.id', count: 1 }],
    });
    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
  });

  it('defers merge residue in merge-residue mode regardless of any ledger row', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Redirectless Residue', canonicalId);

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.eligible).toEqual([]);
    expect(applied.plan.deferredByReason).toMatchObject({ merged_shell_is_canonical_mapping: 1 });
    expect(applied.plan.blocked[0]).toMatchObject({
      id: String(residue.id),
      reason: 'merged_shell_is_canonical_mapping',
    });
    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
  });

  it('leaves archived entities without a canonicalGroupId untouched in merge-residue mode', async () => {
    const suppressionId = await insertArchivedEntity('Departed Faculty Hold');

    const applied = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });

    expect(applied.plan.scanned).toBe(0);
    expect(applied.deletedResearchEntities).toBe(0);
    await expect(ResearchEntity.countDocuments({ _id: suppressionId })).resolves.toBe(1);
  });

  it('is idempotent across a second merge-residue apply run', async () => {
    const canonicalId = await insertCanonicalEntity('Canonical Lab');
    const residue = await insertMergeResidue('Twice-Swept Residue', canonicalId);
    await insertRedirect(residue, canonicalId);

    const first = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });
    expect(first.deletedResearchEntities).toBe(0);

    const second = await cleanupArchivedResearchEntities({
      apply: true,
      limit: 100,
      mergeResidueOnly: true,
      getIndex: fakeSearchIndex([]),
    });
    expect(second.plan.scanned).toBe(1);
    expect(second.deletedResearchEntities).toBe(0);
    await expect(ResearchEntity.countDocuments({ _id: residue.id })).resolves.toBe(1);
  });
});
