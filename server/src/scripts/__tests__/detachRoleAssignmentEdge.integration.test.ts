import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleAssignment, roleAssignmentReattachWrite } from '../../models/roleAssignment';
import {
  detachRoleAssignmentEdge,
  parseDetachRoleAssignmentEdgeArgs,
} from '../detachRoleAssignmentEdge';

let server: MongoMemoryServer;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.collection('role_assignments').deleteMany({});
});

const seedEdge = async (over: Record<string, unknown> = {}) => {
  const row = new mongoose.Types.ObjectId();
  const person = new mongoose.Types.ObjectId();
  const _id = new mongoose.Types.ObjectId();
  await mongoose.connection.db!.collection('role_assignments').insertOne({
    _id,
    personId: person,
    target: { kind: 'RESEARCH_ENTITY', id: row },
    role: 'CORE_FACULTY',
    state: 'CURRENT',
    reviewStatus: 'UNREVIEWED',
    archived: false,
    ...over,
  });
  return { edgeId: String(_id), row: String(row), person, rowObjectId: row };
};

describe('role-assignments:detach-edge (#5614)', () => {
  it('changes nothing on a dry run', async () => {
    const { edgeId } = await seedEdge();
    const regate = vi.fn();
    const result = await detachRoleAssignmentEdge(
      { edgeId, note: 'wrong person', apply: false },
      regate,
    );
    expect(result).toMatchObject({ found: true, live: true, detached: false, regatedRow: false });
    expect(regate).not.toHaveBeenCalled();
    expect(((await RoleAssignment.findById(edgeId).lean()) as any).archived).toBe(false);
  });

  it('detaches one live edge as DISPUTED with the note, snapshots it, and re-gates its row', async () => {
    const { edgeId, row } = await seedEdge();
    const snapshot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'detach-')), 'edge.json');
    const regate = vi.fn().mockResolvedValue(undefined);
    const result = await detachRoleAssignmentEdge(
      { edgeId, note: 'center lists another person', snapshot, apply: true },
      regate,
    );
    expect(result).toMatchObject({ detached: true, regatedRow: true });
    expect(regate).toHaveBeenCalledWith(row);
    const after = (await RoleAssignment.findById(edgeId).lean()) as any;
    expect(after).toMatchObject({
      archived: true,
      reviewStatus: 'DISPUTED',
      reviewNotes: 'center lists another person',
    });
    expect(JSON.parse(fs.readFileSync(snapshot, 'utf8')).edge.archived).toBe(false);
  });

  it('records the actor who detached the edge, so a restore can tell an agent from the owner', async () => {
    const { edgeId } = await seedEdge({ reviewedBy: 'ylabs-earlier-session' });
    await detachRoleAssignmentEdge(
      {
        edgeId,
        note: 'wrong person',
        actor: 'ylabs-fixture-session',
        decidedBy: 'agent',
        apply: true,
      },
      vi.fn(),
    );
    const after = (await RoleAssignment.findById(edgeId).lean()) as any;
    expect(after.reviewedBy).toBe('ylabs-fixture-session');
    expect(after.reviewedByAgent).toBe(true);
    expect(after.reviewedAt).toBeInstanceOf(Date);
  });

  it('records an owner decision as not made by an agent', async () => {
    const { edgeId } = await seedEdge({
      reviewedBy: 'ylabs-earlier-session',
      reviewedByAgent: true,
    });
    await detachRoleAssignmentEdge(
      {
        edgeId,
        note: 'wrong person',
        actor: 'ylabs-review-session-2026',
        decidedBy: 'owner',
        apply: true,
      },
      vi.fn(),
    );
    const after = (await RoleAssignment.findById(edgeId).lean()) as any;
    expect(after).toMatchObject({
      reviewedBy: 'ylabs-review-session-2026',
      reviewedByAgent: false,
    });
  });

  it('clears an earlier reviewer when the detachment names no actor', async () => {
    const { edgeId } = await seedEdge({
      reviewedBy: 'ylabs-earlier-session',
      reviewedByAgent: true,
    });
    await detachRoleAssignmentEdge({ edgeId, note: 'wrong person', apply: true }, vi.fn());
    const after = (await RoleAssignment.findById(edgeId).lean()) as any;
    expect(after).toMatchObject({ archived: true, reviewStatus: 'DISPUTED' });
    expect(after.reviewedBy).toBeUndefined();
    expect(after.reviewedByAgent).toBeUndefined();
  });

  it('cannot be re-attached by a lane re-asserting the same edge', async () => {
    const { edgeId, person, rowObjectId } = await seedEdge();
    await detachRoleAssignmentEdge({ edgeId, note: 'wrong person', apply: true }, vi.fn());
    const write = roleAssignmentReattachWrite(
      {
        personId: person,
        'target.kind': 'RESEARCH_ENTITY',
        'target.id': rowObjectId,
        role: 'CORE_FACULTY',
      },
      'UNREVIEWED',
    );
    const result = await RoleAssignment.updateOne(write.filter, write.update);
    expect(result.modifiedCount).toBe(0);
    expect((await RoleAssignment.findById(edgeId).lean()) as any).toMatchObject({
      archived: true,
      reviewStatus: 'DISPUTED',
    });
  });

  it('leaves an already archived edge untouched', async () => {
    const { edgeId } = await seedEdge({ archived: true });
    const regate = vi.fn();
    const result = await detachRoleAssignmentEdge(
      { edgeId, note: 'wrong person', apply: true },
      regate,
    );
    expect(result).toMatchObject({ found: true, live: false, detached: false });
    expect(regate).not.toHaveBeenCalled();
  });

  it('takes exactly one edge, a note, and a snapshot path for an apply', () => {
    const id = 'a'.repeat(24);
    expect(() =>
      parseDetachRoleAssignmentEdgeArgs([`--edge=${id}`, `--edge=${'b'.repeat(24)}`, '--note=x']),
    ).toThrow(/exactly one edge/);
    expect(() => parseDetachRoleAssignmentEdgeArgs([`--edge=${id}`])).toThrow(/--note is required/);
    expect(() =>
      parseDetachRoleAssignmentEdgeArgs([`--edge=${id}`, '--note=x', '--apply']),
    ).toThrow(/--snapshot/);
    expect(() =>
      parseDetachRoleAssignmentEdgeArgs([
        `--edge=${id}`,
        '--note=x',
        '--snapshot=./tmp/x.json',
        '--apply',
      ]),
    ).toThrow(/--decided-by/);
    expect(() =>
      parseDetachRoleAssignmentEdgeArgs([`--edge=${id}`, '--note=x', '--decided-by=someone']),
    ).toThrow(/owner or agent/);
    expect(
      parseDetachRoleAssignmentEdgeArgs(
        [`--edge=${id}`, '--note=x', '--snapshot=./tmp/x.json', '--decided-by=agent', '--apply'],
        {},
      ),
    ).toMatchObject({ decidedBy: 'agent', apply: true });
    expect(
      parseDetachRoleAssignmentEdgeArgs([`--edge=${id}`, '--note=wrong person'], {}),
    ).toMatchObject({ edgeId: id, apply: false });
    expect(
      parseDetachRoleAssignmentEdgeArgs([`--edge=${id}`, '--note=x'], {
        DEV_WRITE_OWNER: 'ylabs-fixture-session',
      }),
    ).toMatchObject({ actor: 'ylabs-fixture-session' });
    expect(
      parseDetachRoleAssignmentEdgeArgs([`--edge=${id}`, '--note=x', '--actor=ylabs-other'], {}),
    ).toMatchObject({ actor: 'ylabs-other' });
  });
});
