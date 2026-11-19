import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditEvent } from '../../models/adminAuditEvent';
import {
  parseRestoreDetachedRoleAssignmentEdgeArgs,
  restoreDetachedRoleAssignmentEdge,
} from '../restoreDetachedRoleAssignmentEdge';
import { unfoldResearcherShell } from '../unfoldResearcherShell';

const ACTOR = 'agent:ylabs-fixture';
const RESTORE_NOTE = 'the shell leads this row in its own right once the fold is reversed';

let server: MongoMemoryServer;
const db = () => mongoose.connection.db!;
const oid = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all(
    ['role_assignments', 'researchers', 'research_entities', 'admin_audit_events'].map((name) =>
      db().collection(name).deleteMany({}),
    ),
  );
});

const seedUnfoldedShell = async ({ unfold = true } = {}) => {
  const shell = oid();
  const survivor = oid();
  const row = oid();
  const foldEdge = oid();
  const otherArchivedEdge = oid();
  await db().collection('research_entities').insertOne({ _id: row, slug: 'fixture-row' });
  await db()
    .collection('researchers')
    .insertMany([
      { _id: survivor, displayName: 'Fixture Survivor', archived: false },
      {
        _id: shell,
        displayName: 'Fixture Shell',
        archived: true,
        dedupedIntoResearcherId: survivor,
        dedupedAt: new Date('2026-10-05T00:00:00Z'),
      },
    ]);
  const edge = (over: Record<string, unknown>) => ({
    target: { kind: 'RESEARCH_ENTITY', id: row },
    role: 'PI',
    state: 'UNKNOWN',
    confidence: 0.7,
    reviewStatus: 'UNREVIEWED',
    ...over,
  });
  await db()
    .collection('role_assignments')
    .insertMany([
      edge({ _id: oid(), personId: survivor, archived: false }),
      edge({ _id: foldEdge, personId: shell, archived: true }),
      edge({
        _id: otherArchivedEdge,
        personId: shell,
        archived: true,
        role: 'CORE_FACULTY',
        reviewNotes: 'retired by a stage (#1)',
      }),
    ]);
  const unfolded = unfold
    ? await unfoldResearcherShell({
        shellId: String(shell),
        expectedSurvivorId: String(survivor),
        note: 'two different people',
        actor: ACTOR,
        apply: true,
      })
    : undefined;
  return {
    shell: String(shell),
    survivor: String(survivor),
    row: String(row),
    foldEdge: String(foldEdge),
    otherArchivedEdge: String(otherArchivedEdge),
    auditId: unfolded?.auditId ?? '',
  };
};

const restoreArgs = (
  seeded: { shell: string; row: string; foldEdge: string; auditId: string },
  over: Record<string, unknown> = {},
) => ({
  edgeId: seeded.foldEdge,
  note: RESTORE_NOTE,
  actor: ACTOR,
  expectedPersonId: seeded.shell,
  expectedTargetId: seeded.row,
  unfoldAuditId: seeded.auditId,
  snapshot: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'restore-fold-edge-')), 'edge.json'),
  apply: true,
  ...over,
});

const storedEdge = async (id: string) =>
  (await db()
    .collection('role_assignments')
    .findOne({ _id: new mongoose.Types.ObjectId(id) })) as any;

const expectStillArchived = async (id: string, regate: ReturnType<typeof vi.fn>) => {
  expect(regate).not.toHaveBeenCalled();
  expect((await storedEdge(id)).archived).toBe(true);
};

describe('restore-detached-edge for an edge a reversed fold archived (#6018)', () => {
  it('restores the fold-archived edge tied to the unfold audit and re-gates its row', async () => {
    const seeded = await seedUnfoldedShell();
    const regate = vi.fn().mockResolvedValue(undefined);
    const result = await restoreDetachedRoleAssignmentEdge(restoreArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: null, restored: true, decider: 'stage-or-agent' });
    expect(regate).toHaveBeenCalledWith(seeded.row);
    expect(await storedEdge(seeded.foldEdge)).toMatchObject({
      archived: false,
      reviewStatus: 'UNREVIEWED',
      reviewNotes: RESTORE_NOTE,
      reviewedBy: ACTOR,
    });
  });

  it('still refuses a fold-archived edge without an unfold audit', async () => {
    const seeded = await seedUnfoldedShell();
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(
      restoreArgs(seeded, { unfoldAuditId: undefined }),
      regate,
    );
    expect(result).toMatchObject({ refusal: 'edge-not-archived-as-disputed', restored: false });
    await expectStillArchived(seeded.foldEdge, regate);
  });

  it('refuses an audit id that is not an unfold record', async () => {
    const seeded = await seedUnfoldedShell();
    const unrelated = await AdminAuditEvent.create({
      actorNetid: ACTOR,
      action: 'research_entity.visibility_override',
      targetType: 'researcher',
      targetId: seeded.shell,
      metadata: { foldArchivedEdgeIds: [seeded.foldEdge] },
    });
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(
      restoreArgs(seeded, { unfoldAuditId: String(unrelated._id) }),
      regate,
    );
    expect(result).toMatchObject({ refusal: 'unfold-audit-not-found' });
    await expectStillArchived(seeded.foldEdge, regate);
  });

  it('refuses an unfold audit of a different shell', async () => {
    const seeded = await seedUnfoldedShell();
    const other = await seedUnfoldedShell();
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(
      restoreArgs(seeded, { unfoldAuditId: other.auditId }),
      regate,
    );
    expect(result).toMatchObject({ refusal: 'unfold-audit-names-another-shell' });
    await expectStillArchived(seeded.foldEdge, regate);
  });

  it('refuses an archived edge of the shell that the fold did not archive', async () => {
    const seeded = await seedUnfoldedShell();
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(
      restoreArgs(seeded, { edgeId: seeded.otherArchivedEdge }),
      regate,
    );
    expect(result).toMatchObject({ refusal: 'edge-not-fold-archived-by-that-unfold' });
    await expectStillArchived(seeded.otherArchivedEdge, regate);
  });

  it('refuses once the shell has been folded again', async () => {
    const seeded = await seedUnfoldedShell();
    await db()
      .collection('researchers')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(seeded.shell) },
        {
          $set: {
            archived: true,
            dedupedIntoResearcherId: new mongoose.Types.ObjectId(seeded.survivor),
          },
        },
      );
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(restoreArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: 'unfold-no-longer-stands' });
    await expectStillArchived(seeded.foldEdge, regate);
  });

  it('refuses an older unfold audit when a later unfold of the same shell exists', async () => {
    const seeded = await seedUnfoldedShell();
    await AdminAuditEvent.create({
      actorNetid: ACTOR,
      action: 'researcher.unfold_shell',
      targetType: 'researcher',
      targetId: seeded.shell,
      metadata: { foldArchivedEdgeIds: [] },
      timestamp: new Date(Date.now() + 60_000),
    });
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(restoreArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: 'unfold-no-longer-stands' });
    await expectStillArchived(seeded.foldEdge, regate);
  });

  it('keeps the existing refusals on the fold path: expected person, live twin', async () => {
    const seeded = await seedUnfoldedShell();
    const regate = vi.fn();
    expect(
      await restoreDetachedRoleAssignmentEdge(
        restoreArgs(seeded, { expectedPersonId: seeded.survivor }),
        regate,
      ),
    ).toMatchObject({ refusal: 'person-does-not-match-expected' });
    await db()
      .collection('role_assignments')
      .insertOne({
        _id: oid(),
        personId: new mongoose.Types.ObjectId(seeded.shell),
        target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId(seeded.row) },
        role: 'PI',
        reviewStatus: 'UNREVIEWED',
        archived: false,
      });
    expect(await restoreDetachedRoleAssignmentEdge(restoreArgs(seeded), regate)).toMatchObject({
      refusal: 'live-twin-edge-exists',
    });
    await expectStillArchived(seeded.foldEdge, regate);
  });

  it('parses --unfold-audit as one 24-character id', () => {
    const edge = String(oid());
    const audit = String(oid());
    expect(
      parseRestoreDetachedRoleAssignmentEdgeArgs(
        [`--edge=${edge}`, '--note=x', `--unfold-audit=${audit}`],
        {},
      ).unfoldAuditId,
    ).toBe(audit);
    expect(() =>
      parseRestoreDetachedRoleAssignmentEdgeArgs(
        [`--edge=${edge}`, '--note=x', '--unfold-audit=nope'],
        {},
      ),
    ).toThrow(/--unfold-audit/);
  });
});
