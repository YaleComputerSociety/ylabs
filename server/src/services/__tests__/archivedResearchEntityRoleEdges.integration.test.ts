import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { runPostMaterializationIntegrityGate } from '../../scrapers/integrityGate';
import {
  archiveResearchEntities,
  planRoleEdgeSettlements,
  settleRoleEdgesOfArchivedResearchEntities,
} from '../archivedResearchEntityRoleEdges';

describe('archiving a research entity settles its live role edges (#4752)', () => {
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
    for (const name of ['research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const entity = async (slug: string, overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({ slug, name: `Synthetic ${slug}`, archived: false, ...overrides });

  const edge = async (
    personId: mongoose.Types.ObjectId,
    targetId: unknown,
    role: string,
    overrides: Record<string, unknown> = {},
  ) =>
    RoleAssignment.create({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: targetId },
      role,
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
      ...overrides,
    });

  const stored = async (id: unknown) =>
    RoleAssignment.findById(id).lean<{
      target: { id: mongoose.Types.ObjectId };
      state: string;
      archived: boolean;
      endedAt?: Date;
      reviewStatus?: string;
    }>();

  const gateCounts = async () =>
    (await runPostMaterializationIntegrityGate({ includeSamples: false })).counts;

  it('moves an edge to the survivor, or archives it as redundant when the survivor holds it', async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('dept-synthetic-shell');
    const lead = new mongoose.Types.ObjectId();
    const student = new mongoose.Types.ObjectId();
    const survivorLead = await edge(lead, survivor._id, 'PI');
    const shellLead = await edge(lead, shell._id, 'PI', {
      rosterProvenance: { sourceName: 'synthetic-roster', membershipKey: 'synthetic-key' },
    });
    const shellStudent = await edge(student, shell._id, 'GRADUATE_STUDENT');
    const now = new Date('2026-10-04T12:00:00Z');

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      set: { canonicalGroupId: survivor._id },
      survivorId: survivor._id,
      now,
    });

    expect(result).toEqual({
      archived: 1,
      roleEdges: { repointed: 1, archivedRedundant: 1, ended: 0, refusedSurvivorNotLive: 0 },
    });
    const redundant = await stored(shellLead._id);
    expect(redundant).toMatchObject({ state: 'HISTORICAL', archived: true });
    expect(String(redundant?.target.id)).toBe(String(shell._id));
    expect(redundant?.endedAt?.toISOString()).toBe(now.toISOString());
    const moved = await stored(shellStudent._id);
    expect(String(moved?.target.id)).toBe(String(survivor._id));
    expect(moved).toMatchObject({ state: 'CURRENT', archived: false });
    expect(await stored(survivorLead._id)).toMatchObject({ state: 'CURRENT', archived: false });
    const archivedShell = await ResearchEntity.findById(shell._id).lean<{ archivedAt?: Date }>();
    expect(archivedShell?.archivedAt?.toISOString()).toBe(now.toISOString());

    const counts = await gateCounts();
    expect(counts.currentMembersOnArchivedEntities).toBe(0);
    expect(counts.duplicateCurrentMembers).toBe(0);
  });

  it('never hands the survivor the same person and role from two archived rows', async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const first = await entity('dept-synthetic-first');
    const second = await entity('dept-synthetic-second');
    const lead = new mongoose.Types.ObjectId();
    const firstLead = await edge(lead, first._id, 'PI');
    const secondLead = await edge(lead, second._id, 'PI');

    const result = await archiveResearchEntities({
      ids: [first._id, second._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.roleEdges).toMatchObject({ repointed: 1, archivedRedundant: 1 });
    expect(String((await stored(firstLead._id))?.target.id)).toBe(String(survivor._id));
    expect(await stored(secondLead._id)).toMatchObject({ state: 'HISTORICAL', archived: true });
    expect((await gateCounts()).duplicateCurrentMembers).toBe(0);
  });

  it('does not count a past appointment on the survivor as holding the role', async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('dept-synthetic-shell');
    const lead = new mongoose.Types.ObjectId();
    await edge(lead, survivor._id, 'PI', {
      state: 'HISTORICAL',
      endedAt: new Date('2025-01-01T00:00:00Z'),
    });
    const shellLead = await edge(lead, shell._id, 'PI');

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.roleEdges.repointed).toBe(1);
    const moved = await stored(shellLead._id);
    expect(String(moved?.target.id)).toBe(String(survivor._id));
    expect(moved?.state).toBe('CURRENT');
  });

  it('archives the edge as redundant when the survivor holds the claim as disputed', async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('dept-synthetic-shell');
    const lead = new mongoose.Types.ObjectId();
    await edge(lead, survivor._id, 'PI', { archived: true, reviewStatus: 'DISPUTED' });
    const shellLead = await edge(lead, shell._id, 'PI');

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.roleEdges).toMatchObject({ repointed: 0, archivedRedundant: 1 });
    const kept = await stored(shellLead._id);
    expect(String(kept?.target.id)).toBe(String(shell._id));
    expect(kept).toMatchObject({ state: 'HISTORICAL', archived: true });
    expect(
      await RoleAssignment.countDocuments({
        'target.id': survivor._id,
        personId: lead,
        archived: { $ne: true },
      }),
    ).toBe(0);
  });

  it('ends every live edge of a row retired with no survivor and leaves past edges alone', async () => {
    const retired = await entity('synthetic-retired-row');
    const lead = new mongoose.Types.ObjectId();
    const staff = new mongoose.Types.ObjectId();
    const leadEdge = await edge(lead, retired._id, 'PI', { state: 'UNKNOWN' });
    const staffEdge = await edge(staff, retired._id, 'STAFF', { reviewStatus: 'APPROVED' });
    const pastEnd = new Date('2025-01-01T00:00:00Z');
    const pastEdge = await edge(new mongoose.Types.ObjectId(), retired._id, 'POSTDOC', {
      state: 'HISTORICAL',
      endedAt: pastEnd,
    });
    const now = new Date('2026-10-04T12:00:00Z');

    const result = await archiveResearchEntities({
      ids: [retired._id],
      archivedReason: 'synthetic:retire',
      now,
    });

    expect(result.roleEdges).toEqual({
      repointed: 0,
      archivedRedundant: 0,
      ended: 2,
      refusedSurvivorNotLive: 0,
    });
    for (const id of [leadEdge._id, staffEdge._id]) {
      const ended = await stored(id);
      expect(ended).toMatchObject({ state: 'HISTORICAL', archived: false });
      expect(ended?.endedAt?.toISOString()).toBe(now.toISOString());
      expect(String(ended?.target.id)).toBe(String(retired._id));
    }
    expect((await stored(staffEdge._id))?.reviewStatus).toBe('APPROVED');
    expect((await stored(pastEdge._id))?.endedAt?.toISOString()).toBe(pastEnd.toISOString());
    expect((await gateCounts()).currentMembersOnArchivedEntities).toBe(0);
  });

  it('refuses a survivor that is not live and leaves the edges for the gate to count', async () => {
    const survivor = await entity('synthetic-archived-survivor', {
      archived: true,
      archivedReason: 'synthetic:earlier',
    });
    const shell = await entity('dept-synthetic-shell');
    const shellLead = await edge(new mongoose.Types.ObjectId(), shell._id, 'PI');

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.roleEdges).toMatchObject({ refusedSurvivorNotLive: 1, repointed: 0 });
    expect(await stored(shellLead._id)).toMatchObject({ state: 'CURRENT', archived: false });
    expect((await gateCounts()).currentMembersOnArchivedEntities).toBe(1);
  });

  it('touches no edge of a row that is still live', async () => {
    const live = await entity('synthetic-live-row');
    const leadEdge = await edge(new mongoose.Types.ObjectId(), live._id, 'PI');

    const outcome = await settleRoleEdgesOfArchivedResearchEntities({
      archivedEntityIds: [live._id],
    });

    expect(outcome).toMatchObject({ repointed: 0, archivedRedundant: 0, ended: 0 });
    expect(await stored(leadEdge._id)).toMatchObject({ state: 'CURRENT', archived: false });
  });
});

describe('planRoleEdgeSettlements', () => {
  it('plans in input order with the dedupe-merge outcomes', () => {
    const plan = planRoleEdgeSettlements({
      edges: [
        { id: 'e1', archivedEntityId: 'shell', personId: 'p1', role: 'PI' },
        { id: 'e2', archivedEntityId: 'shell', personId: 'p2', role: 'PI' },
        { id: 'e3', archivedEntityId: 'retired', personId: 'p3', role: 'PI' },
      ],
      survivorIdFor: (id) => (id === 'shell' ? 'survivor' : undefined),
      survivorHoldingEdges: [{ id: 's1', survivorId: 'survivor', personId: 'p1', role: 'PI' }],
    });

    expect(plan).toEqual([
      {
        action: 'archive-redundant',
        edgeId: 'e1',
        archivedEntityId: 'shell',
        survivorId: 'survivor',
        survivorEdgeId: 's1',
      },
      { action: 'repoint', edgeId: 'e2', archivedEntityId: 'shell', survivorId: 'survivor' },
      { action: 'end', edgeId: 'e3', archivedEntityId: 'retired' },
    ]);
  });
});
