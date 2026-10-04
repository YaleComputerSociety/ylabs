import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { runPostMaterializationIntegrityGate } from '../../scrapers/integrityGate';
import {
  applyArchivedEntityArtifactRepairPlan,
  loadArchivedEntityArtifactPlan,
} from '../repairArchivedEntityArtifacts';

describe('research-entity:repair-archived-artifacts settles stranded role edges (#4752)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
  });

  const entity = (slug: string, overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({ slug, name: `Synthetic ${slug}`, archived: false, ...overrides });

  const edge = (personId: mongoose.Types.ObjectId, targetId: unknown, role = 'PI') =>
    RoleAssignment.create({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: targetId },
      role,
      state: 'UNKNOWN',
      confidence: 0.9,
      archived: false,
      reviewStatus: 'UNREVIEWED',
    });

  const seedStrandedEdges = async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const folded = await entity('dept-synthetic-folded', {
      archived: true,
      archivedReason: 'materialize:fold-dept-roster-shell',
      canonicalGroupId: survivor._id,
    });
    const retired = await entity('synthetic-retired-row', {
      archived: true,
      archivedReason: 'research-entity:retire-staff-minted-entities',
    });
    const cycleA = new mongoose.Types.ObjectId();
    const cycleB = await entity('synthetic-cycle-b', {
      archived: true,
      archivedReason: 'synthetic:cycle',
      canonicalGroupId: cycleA,
    });
    await entity('synthetic-cycle-a', {
      _id: cycleA,
      archived: true,
      archivedReason: 'synthetic:cycle',
      canonicalGroupId: cycleB._id,
    });
    const lead = new mongoose.Types.ObjectId();
    const staff = new mongoose.Types.ObjectId();
    await edge(lead, survivor._id);
    return {
      survivor,
      redundant: await edge(lead, folded._id),
      repointed: await edge(staff, folded._id, 'STAFF'),
      ended: await edge(new mongoose.Types.ObjectId(), retired._id),
      deadEnd: await edge(new mongoose.Types.ObjectId(), cycleB._id),
    };
  };

  it('plans every stranded edge with the archive-time helper and applies it', async () => {
    const seeded = await seedStrandedEdges();

    const { plan } = await loadArchivedEntityArtifactPlan(100, {}, ['RoleAssignment']);
    expect(plan.mergeAndArchive.map((item) => item.duplicateId)).toEqual([
      String(seeded.redundant._id),
    ]);
    expect(plan.relink.map((item) => item.id)).toEqual([String(seeded.repointed._id)]);
    expect(plan.archiveWithoutCanonical.map((item) => item.id)).toEqual([String(seeded.ended._id)]);
    expect(plan.skipped.map((item) => [item.id, item.reason])).toEqual([
      [String(seeded.deadEnd._id), 'merge-chain-dead-end'],
    ]);

    const now = new Date('2026-10-04T12:00:00Z');
    const applied = await applyArchivedEntityArtifactRepairPlan(plan, now);
    expect(applied).toMatchObject({
      relinked: 1,
      archivedMergedDuplicates: 1,
      archivedWithoutCanonical: 1,
    });

    const read = (id: unknown) => RoleAssignment.findById(id).lean();
    expect(await read(seeded.redundant._id)).toMatchObject({
      state: 'HISTORICAL',
      archived: true,
      reviewStatus: 'UNREVIEWED',
    });
    expect(String((await read(seeded.repointed._id))?.target.id)).toBe(String(seeded.survivor._id));
    expect(await read(seeded.ended._id)).toMatchObject({
      state: 'HISTORICAL',
      archived: false,
      endedAt: now,
    });

    const summary = await runPostMaterializationIntegrityGate({ includeSamples: false });
    expect(summary.counts.currentMembersOnArchivedEntities).toBe(1);
    expect(summary.counts.duplicateCurrentMembers).toBe(0);

    const rerun = await loadArchivedEntityArtifactPlan(100, {}, ['RoleAssignment']);
    expect(rerun.plan.relink).toEqual([]);
    expect(rerun.plan.mergeAndArchive).toEqual([]);
    expect(rerun.plan.archiveWithoutCanonical).toEqual([]);
  });
});
