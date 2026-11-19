import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleAssignment } from '../../models/roleAssignment';
import { detachRoleAssignmentEdge } from '../detachRoleAssignmentEdge';
import {
  parseRestoreDetachedRoleAssignmentEdgeArgs,
  restoreDetachedRoleAssignmentEdge,
} from '../restoreDetachedRoleAssignmentEdge';
import { classifyDetachmentDecider } from '../restoreDetachedRoleAssignmentEdgeCore';

const STAGE_NOTE =
  'Detached as a same-surname lead on an entity whose own identity names a different person (#2768).';
const RESTORE_NOTE = 'the stage predicate misfired on a name-variant merge';
const AGENT_ACTOR = 'ylabs-fixture-session';
const SYNTHETIC_OWNER_NETID = 'zz9993';
const NON_NETID_OWNER_LABEL = 'ylabs-review-session-2026';

let server: MongoMemoryServer;
const db = () => mongoose.connection.db!;

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
    ['role_assignments', 'researchers', 'research_entities'].map((name) =>
      db().collection(name).deleteMany({}),
    ),
  );
});

const seedDetachedEdge = async (
  over: Record<string, unknown> = {},
  { personArchived = false, seedPerson = true, seedRow = true } = {},
) => {
  const row = new mongoose.Types.ObjectId();
  const person = new mongoose.Types.ObjectId();
  const _id = new mongoose.Types.ObjectId();
  if (seedPerson) {
    await db()
      .collection('researchers')
      .insertOne({ _id: person, displayName: 'Fixture Person', archived: personArchived });
  }
  if (seedRow) {
    await db().collection('research_entities').insertOne({ _id: row, slug: 'fixture-row' });
  }
  await db()
    .collection('role_assignments')
    .insertOne({
      _id,
      personId: person,
      target: { kind: 'RESEARCH_ENTITY', id: row },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      reviewStatus: 'DISPUTED',
      reviewNotes: STAGE_NOTE,
      archived: true,
      ...over,
    });
  return { edgeId: String(_id), row: String(row), person: String(person) };
};

const applyArgs = (
  seeded: { edgeId: string; row: string; person: string },
  over: Record<string, unknown> = {},
) => ({
  edgeId: seeded.edgeId,
  note: RESTORE_NOTE,
  actor: AGENT_ACTOR,
  expectedPersonId: seeded.person,
  expectedTargetId: seeded.row,
  snapshot: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'restore-edge-')), 'edge.json'),
  apply: true,
  ...over,
});

const storedEdge = async (edgeId: string) => (await RoleAssignment.findById(edgeId).lean()) as any;

const expectUntouched = async (edgeId: string, regate: ReturnType<typeof vi.fn>) => {
  expect(regate).not.toHaveBeenCalled();
  expect(await storedEdge(edgeId)).toMatchObject({
    archived: true,
    reviewStatus: 'DISPUTED',
    reviewNotes: STAGE_NOTE,
  });
};

describe('role-assignments:restore-detached-edge (#5968)', () => {
  it('restores a stage-detached edge, snapshots its pre-image, records the review, and re-gates its row', async () => {
    const seeded = await seedDetachedEdge();
    const regate = vi.fn().mockResolvedValue(undefined);
    const args = applyArgs(seeded);
    const result = await restoreDetachedRoleAssignmentEdge(args, regate);
    expect(result).toMatchObject({
      found: true,
      decider: 'stage-or-agent',
      refusal: null,
      restored: true,
      regatedRow: true,
    });
    expect(regate).toHaveBeenCalledTimes(1);
    expect(regate).toHaveBeenCalledWith(seeded.row);
    const after = await storedEdge(seeded.edgeId);
    expect(after).toMatchObject({
      archived: false,
      reviewStatus: 'UNREVIEWED',
      reviewNotes: RESTORE_NOTE,
      reviewedBy: AGENT_ACTOR,
    });
    expect(after.reviewedAt).toBeInstanceOf(Date);
    const snapshot = JSON.parse(fs.readFileSync(args.snapshot, 'utf8'));
    expect(snapshot.edge).toMatchObject({
      archived: true,
      reviewStatus: 'DISPUTED',
      reviewNotes: STAGE_NOTE,
    });
    expect(fs.statSync(args.snapshot).mode & 0o777).toBe(0o600);
  });

  it('restores an edge an agent detached through detach-edge with its session label', async () => {
    const seeded = await seedDetachedEdge({
      reviewNotes: 'center page lists a different lead',
      reviewedBy: AGENT_ACTOR,
      reviewedByAgent: true,
    });
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), vi.fn());
    expect(result).toMatchObject({ decider: 'stage-or-agent', restored: true });
    expect((await storedEdge(seeded.edgeId)).reviewedByAgent).toBeUndefined();
  });

  it.each([
    ['decided by the owner', 'owner' as const],
    ['with no recorded decider', undefined],
  ])(
    'refuses an edge detach-edge detached %s under a session label that is not netid-shaped',
    async (_case, decidedBy) => {
      const seeded = await seedDetachedEdge({ archived: false, reviewStatus: 'UNREVIEWED' });
      await detachRoleAssignmentEdge(
        {
          edgeId: seeded.edgeId,
          note: 'center page lists a different lead',
          actor: NON_NETID_OWNER_LABEL,
          ...(decidedBy ? { decidedBy } : {}),
          apply: true,
        },
        vi.fn(),
      );
      const before = await storedEdge(seeded.edgeId);
      const regate = vi.fn();
      const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
      expect(result).toMatchObject({
        decider: 'owner',
        refusal: 'detachment-decided-by-owner',
        restored: false,
      });
      expect(regate).not.toHaveBeenCalled();
      expect(await storedEdge(seeded.edgeId)).toEqual(before);
    },
  );

  it('restores an edge detach-edge detached as decided by an agent', async () => {
    const seeded = await seedDetachedEdge({ archived: false, reviewStatus: 'UNREVIEWED' });
    await detachRoleAssignmentEdge(
      {
        edgeId: seeded.edgeId,
        note: 'center page lists a different lead',
        actor: AGENT_ACTOR,
        decidedBy: 'agent',
        apply: true,
      },
      vi.fn(),
    );
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), vi.fn());
    expect(result).toMatchObject({ decider: 'stage-or-agent', restored: true });
  });

  it('prints shapes and never the note, the actor or any id', async () => {
    const seeded = await seedDetachedEdge();
    const printed = JSON.stringify(
      await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), vi.fn()),
    );
    for (const secret of [RESTORE_NOTE, STAGE_NOTE, AGENT_ACTOR, seeded.person, seeded.row]) {
      expect(printed).not.toContain(secret);
    }
  });

  it.each([
    ['a human netid reviewer', { reviewedBy: SYNTHETIC_OWNER_NETID }],
    ['a note recording an owner decision', { reviewNotes: 'Owner decision: wrong lead (#5000).' }],
    [
      'a note recording an operator detachment',
      {
        reviewNotes:
          'Detached by an operator: the research row was archived as operator:not-research, so its lead claim is disputed rather than ended (#4917).',
      },
    ],
  ])('refuses a detachment decided by the owner through %s', async (_case, over) => {
    const seeded = await seedDetachedEdge(over);
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(result).toMatchObject({
      decider: 'owner',
      refusal: 'detachment-decided-by-owner',
      restored: false,
    });
    expect(regate).not.toHaveBeenCalled();
    expect(await storedEdge(seeded.edgeId)).toMatchObject({
      archived: true,
      reviewStatus: 'DISPUTED',
    });
  });

  it('refuses, failing closed, a detachment nobody can attribute', async () => {
    const seeded = await seedDetachedEdge({ reviewNotes: 'wrong lead' });
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(result).toMatchObject({
      decider: 'unattributed',
      refusal: 'detachment-decider-unattributed',
      restored: false,
    });
    expect(regate).not.toHaveBeenCalled();
    expect(await storedEdge(seeded.edgeId)).toMatchObject({ archived: true });
  });

  it('refuses a person id that does not match the expected one', async () => {
    const seeded = await seedDetachedEdge();
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(
      applyArgs(seeded, { expectedPersonId: String(new mongoose.Types.ObjectId()) }),
      regate,
    );
    expect(result).toMatchObject({ refusal: 'person-does-not-match-expected', restored: false });
    await expectUntouched(seeded.edgeId, regate);
  });

  it('refuses a target id that does not match the expected one', async () => {
    const seeded = await seedDetachedEdge();
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(
      applyArgs(seeded, { expectedTargetId: String(new mongoose.Types.ObjectId()) }),
      regate,
    );
    expect(result).toMatchObject({ refusal: 'target-does-not-match-expected', restored: false });
    await expectUntouched(seeded.edgeId, regate);
  });

  it('refuses an edge whose person no longer resolves', async () => {
    const seeded = await seedDetachedEdge({}, { seedPerson: false });
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: 'person-does-not-resolve', restored: false });
    await expectUntouched(seeded.edgeId, regate);
  });

  it('refuses an edge whose target no longer resolves', async () => {
    const seeded = await seedDetachedEdge({}, { seedRow: false });
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: 'target-does-not-resolve', restored: false });
    await expectUntouched(seeded.edgeId, regate);
  });

  it('refuses an edge whose person record is archived', async () => {
    const seeded = await seedDetachedEdge({}, { personArchived: true });
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: 'person-is-archived', restored: false });
    await expectUntouched(seeded.edgeId, regate);
  });

  it.each([
    ['a live edge', { archived: false, reviewStatus: 'UNREVIEWED' }],
    ['an archived edge that is not disputed', { archived: true, reviewStatus: 'UNREVIEWED' }],
    ['a disputed edge that is not archived', { archived: false, reviewStatus: 'DISPUTED' }],
  ])('refuses %s', async (_case, over) => {
    const seeded = await seedDetachedEdge(over);
    const regate = vi.fn();
    const before = await storedEdge(seeded.edgeId);
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: 'edge-not-archived-as-disputed', restored: false });
    expect(regate).not.toHaveBeenCalled();
    expect(await storedEdge(seeded.edgeId)).toEqual(before);
  });

  it('refuses when the person already holds a live twin of the edge', async () => {
    const seeded = await seedDetachedEdge();
    await db()
      .collection('role_assignments')
      .insertOne({
        personId: new mongoose.Types.ObjectId(seeded.person),
        target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId(seeded.row) },
        role: 'PI',
        state: 'CURRENT',
        reviewStatus: 'UNREVIEWED',
        archived: false,
      });
    const regate = vi.fn();
    const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(result).toMatchObject({ refusal: 'live-twin-edge-exists', restored: false });
    await expectUntouched(seeded.edgeId, regate);
  });

  it('writes nothing on a dry run, not even the snapshot', async () => {
    const seeded = await seedDetachedEdge();
    const regate = vi.fn();
    const args = applyArgs(seeded, { apply: false });
    const before = await storedEdge(seeded.edgeId);
    const result = await restoreDetachedRoleAssignmentEdge(args, regate);
    expect(result).toMatchObject({ decider: 'stage-or-agent', refusal: null, restored: false });
    expect(regate).not.toHaveBeenCalled();
    expect(await storedEdge(seeded.edgeId)).toEqual(before);
    expect(fs.existsSync(args.snapshot)).toBe(false);
  });

  it('refuses a second run as a no-op, because the edge is no longer disputed', async () => {
    const seeded = await seedDetachedEdge();
    const regate = vi.fn().mockResolvedValue(undefined);
    await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    const afterFirst = await storedEdge(seeded.edgeId);
    const second = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
    expect(second).toMatchObject({ refusal: 'edge-not-archived-as-disputed', restored: false });
    expect(regate).toHaveBeenCalledTimes(1);
    expect(await storedEdge(seeded.edgeId)).toEqual(afterFirst);
  });

  it('reports an edge that changed between the read and the write instead of overwriting it', async () => {
    const seeded = await seedDetachedEdge();
    const regate = vi.fn();
    const original = RoleAssignment.updateOne.bind(RoleAssignment);
    const spy = vi.spyOn(RoleAssignment, 'updateOne').mockImplementationOnce(((
      filter: any,
      update: any,
    ) =>
      db()
        .collection('role_assignments')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(seeded.edgeId) },
          { $set: { reviewNotes: 'a later stage note (#9999).' } },
        )
        .then(() => original(filter, update))) as any);
    try {
      const result = await restoreDetachedRoleAssignmentEdge(applyArgs(seeded), regate);
      expect(result).toMatchObject({ refusal: 'edge-changed-since-read', restored: false });
    } finally {
      spy.mockRestore();
    }
    expect(regate).not.toHaveBeenCalled();
    expect(await storedEdge(seeded.edgeId)).toMatchObject({ archived: true });
  });
});

describe('restore-detached-edge arguments', () => {
  const id = (c: string) => c.repeat(24);
  const fullApply = [
    `--edge=${id('a')}`,
    '--note=stage misfired',
    `--expect-person=${id('b')}`,
    `--expect-target=${id('c')}`,
    `--snapshot=${path.join(os.tmpdir(), 'restore-edge-args.json')}`,
    '--apply',
  ];
  const env = { DEV_WRITE_OWNER: AGENT_ACTOR };

  it.each([
    ['two --edge flags', [`--edge=${id('a')}`, `--edge=${id('b')}`, '--note=x'], /exactly one/],
    ['a comma-separated edge list', [`--edge=${id('a')},${id('b')}`, '--note=x'], /24-character/],
    ['a file list', [`--edges-file=/tmp/edges.json`, '--note=x'], /Unknown/],
    ['a positional edge id', [`--edge=${id('a')}`, id('b'), '--note=x'], /Unknown/],
    ['a bulk flag', [`--edge=${id('a')}`, '--note=x', '--all'], /Unknown/],
    ['no edge at all', ['--note=x'], /exactly one/],
  ])('rejects bulk input given as %s', (_case, argv, message) => {
    expect(() => parseRestoreDetachedRoleAssignmentEdgeArgs(argv, env)).toThrow(message);
  });

  it('requires a note', () => {
    expect(() => parseRestoreDetachedRoleAssignmentEdgeArgs([`--edge=${id('a')}`], env)).toThrow(
      /--note is required/,
    );
  });

  it.each([
    ['--snapshot', /--snapshot/],
    ['--expect-person', /--expect-person/],
    ['--expect-target', /--expect-target/],
  ])('requires %s on an apply', (flag, message) => {
    const argv = fullApply.filter((arg) => !arg.startsWith(`${flag}=`));
    expect(() => parseRestoreDetachedRoleAssignmentEdgeArgs(argv, env)).toThrow(message);
  });

  it('requires an actor on an apply', () => {
    expect(() => parseRestoreDetachedRoleAssignmentEdgeArgs(fullApply, {})).toThrow(/actor/);
    expect(
      parseRestoreDetachedRoleAssignmentEdgeArgs([...fullApply, '--actor=ylabs-other'], {}),
    ).toMatchObject({ actor: 'ylabs-other', apply: true });
  });

  it('defaults to a dry run and takes the actor from DEV_WRITE_OWNER', () => {
    expect(
      parseRestoreDetachedRoleAssignmentEdgeArgs([`--edge=${id('A')}`, '--note=x'], env),
    ).toMatchObject({ edgeId: id('a'), apply: false, actor: AGENT_ACTOR });
  });
});

describe('who decided a detachment', () => {
  it.each([
    [{ reviewNotes: STAGE_NOTE }, 'stage-or-agent'],
    [{ reviewNotes: 'Retired as a lead claim (#2880, #1897).' }, 'stage-or-agent'],
    [
      { reviewNotes: 'center lists another lead', reviewedBy: AGENT_ACTOR, reviewedByAgent: true },
      'stage-or-agent',
    ],
    [{ reviewNotes: 'center lists another lead', reviewedBy: NON_NETID_OWNER_LABEL }, 'owner'],
    [{ reviewNotes: STAGE_NOTE, reviewedBy: AGENT_ACTOR, reviewedByAgent: false }, 'owner'],
    [{ reviewNotes: STAGE_NOTE, reviewedBy: SYNTHETIC_OWNER_NETID }, 'owner'],
    [
      { reviewNotes: STAGE_NOTE, reviewedBy: SYNTHETIC_OWNER_NETID, reviewedByAgent: true },
      'owner',
    ],
    [
      {
        reviewNotes: 'the owner said this is wrong (#5000)',
        reviewedBy: AGENT_ACTOR,
        reviewedByAgent: true,
      },
      'owner',
    ],
    [{ reviewNotes: 'wrong lead' }, 'unattributed'],
    [{}, 'unattributed'],
  ])('classifies %j as %s', (edge, decider) => {
    expect(classifyDetachmentDecider(edge)).toBe(decider);
  });
});
