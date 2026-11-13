import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { writeCanonicalMembership } from '../../scrapers/canonicalMembershipMaterializer';
import {
  detachRoleAssignmentEdge,
  parseDetachRoleAssignmentEdgeArgs,
} from '../detachRoleAssignmentEdge';
import { restoreDetachedRoleAssignmentEdge } from '../restoreDetachedRoleAssignmentEdge';

const PAGE = 'https://synthetic.yale.edu/lab/humanitarian/about/';
const ENDED_AT = new Date('2025-12-31T00:00:00.000Z');

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  for (const name of ['role_assignments', 'research_entities', 'researchers']) {
    await mongoose.connection.db!.collection(name).deleteMany({});
  }
});

const snapshotPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'operator-end-')), 'edge.json');

const seed = async (edge: Record<string, unknown> = {}) => {
  const person = await Researcher.create({ displayName: 'Ada Quill', archived: false });
  const row = await ResearchEntity.create({
    slug: 'synthetic-humanitarian-lab',
    name: 'Synthetic Humanitarian Lab',
    entityType: 'LAB',
    archived: false,
  });
  const _id = new mongoose.Types.ObjectId();
  await RoleAssignment.collection.insertOne({
    _id,
    personId: person._id,
    target: { kind: 'RESEARCH_ENTITY', id: row._id },
    role: 'PI',
    state: 'UNKNOWN',
    startedAt: new Date('2020-01-01T00:00:00.000Z'),
    confidence: 0.7,
    reviewStatus: 'UNREVIEWED',
    archived: false,
    rosterProvenance: { sourceName: 'dept-faculty-roster', sourceUrl: PAGE },
    ...edge,
  });
  return { edgeId: String(_id), personId: person._id, rowId: row._id };
};

const reassertFromRoster = (rowId: mongoose.Types.ObjectId, personId: mongoose.Types.ObjectId) =>
  writeCanonicalMembership(
    String(rowId),
    {
      legacyRole: 'pi',
      displayName: 'Ada Quill',
      isCurrentMember: true,
      confidence: 0.7,
      rosterProvenance: { sourceName: 'dept-faculty-roster', sourceUrl: PAGE },
    },
    { displayName: 'Ada Quill', hasCanonicalSourceReference: true, resolvedPersonId: personId },
  );

const endAsHistorical = (edgeId: string, decidedBy: 'owner' | 'agent' = 'agent') =>
  detachRoleAssignmentEdge(
    {
      edgeId,
      note: 'operator end: the page states the founder stepped down',
      decidedBy,
      actor: 'synthetic-operator',
      snapshot: snapshotPath(),
      apply: true,
      endAsHistorical: { endedAt: ENDED_AT, citationUrl: PAGE },
    },
    vi.fn().mockResolvedValue(undefined),
  );

const edgesFor = (personId: mongoose.Types.ObjectId) =>
  RoleAssignment.find({ personId }).lean<
    Array<{ state: string; endedAt?: Date; archived: boolean; operatorEnd?: unknown }>
  >();

describe('an operator-ended role edge (#5979)', () => {
  it('ends the edge as HISTORICAL with an operator end record and re-gates its row', async () => {
    const { edgeId, rowId } = await seed();
    const regate = vi.fn().mockResolvedValue(undefined);
    const result = await detachRoleAssignmentEdge(
      {
        edgeId,
        note: 'operator end: the page states the founder stepped down',
        decidedBy: 'agent',
        snapshot: snapshotPath(),
        apply: true,
        endAsHistorical: { endedAt: ENDED_AT, citationUrl: PAGE },
      },
      regate,
    );

    expect(result).toMatchObject({ endedAsHistorical: true, detached: false, regatedRow: true });
    expect(regate).toHaveBeenCalledWith(String(rowId));
    const stored = (await RoleAssignment.findById(edgeId).lean()) as any;
    expect(stored).toMatchObject({ state: 'HISTORICAL', endedAt: ENDED_AT, archived: false });
    expect(stored.operatorEnd).toMatchObject({
      endedAt: ENDED_AT,
      citationUrl: PAGE,
      decidedBy: 'agent',
      previousState: 'UNKNOWN',
    });
  });

  it('stays ended, with no twin, when the roster re-asserts the same person, row and role', async () => {
    const { edgeId, personId, rowId } = await seed();
    await endAsHistorical(edgeId);
    const write = await reassertFromRoster(rowId, personId);

    expect(write.outcome).toBe('refused-operator-ended');
    const edges = await edgesFor(personId);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ state: 'HISTORICAL', endedAt: ENDED_AT });
  });

  it('revives a lane-ended historical edge on a re-assert exactly as before', async () => {
    const { personId, rowId } = await seed({ state: 'HISTORICAL', endedAt: ENDED_AT });
    const write = await reassertFromRoster(rowId, personId);

    expect(write.outcome).not.toBe('refused-operator-ended');
    const edges = await edgesFor(personId);
    expect(edges).toHaveLength(1);
    expect(edges[0].state).not.toBe('HISTORICAL');
    expect(edges[0].endedAt).toBeUndefined();
  });

  it('is undone by restore-detached-edge, after which the roster refreshes it again', async () => {
    const { edgeId, personId, rowId } = await seed();
    await endAsHistorical(edgeId);
    const restored = await restoreDetachedRoleAssignmentEdge(
      {
        edgeId,
        note: 'operator end was wrong',
        actor: 'synthetic-operator',
        expectedPersonId: String(personId),
        expectedTargetId: String(rowId),
        snapshot: snapshotPath(),
        apply: true,
      },
      vi.fn().mockResolvedValue(undefined),
    );

    expect(restored).toMatchObject({ refusal: null, restored: true });
    const after = (await RoleAssignment.findById(edgeId).lean()) as any;
    expect(after.state).toBe('UNKNOWN');
    expect(after.endedAt).toBeUndefined();
    expect(after.operatorEnd).toBeUndefined();
    expect((await reassertFromRoster(rowId, personId)).outcome).not.toBe('refused-operator-ended');
  });

  it('refuses to undo an end the owner decided', async () => {
    const { edgeId, personId, rowId } = await seed();
    await endAsHistorical(edgeId, 'owner');
    const restored = await restoreDetachedRoleAssignmentEdge(
      {
        edgeId,
        note: 'try to undo',
        actor: 'synthetic-operator',
        expectedPersonId: String(personId),
        expectedTargetId: String(rowId),
        snapshot: snapshotPath(),
        apply: true,
      },
      vi.fn(),
    );

    expect(restored).toMatchObject({ refusal: 'operator-end-decided-by-owner', restored: false });
    expect(((await RoleAssignment.findById(edgeId).lean()) as any).state).toBe('HISTORICAL');
  });

  it('is a no-op the second time', async () => {
    const { edgeId } = await seed();
    await endAsHistorical(edgeId);
    const first = (await RoleAssignment.findById(edgeId).lean()) as any;
    const second = await endAsHistorical(edgeId);
    const after = (await RoleAssignment.findById(edgeId).lean()) as any;

    expect(second).toMatchObject({ live: false, detached: false, regatedRow: false });
    expect(after.operatorEnd.recordedAt.getTime()).toBe(first.operatorEnd.recordedAt.getTime());
    expect(after.state).toBe('HISTORICAL');
  });

  it('refuses an end date before the edge started', async () => {
    const { edgeId } = await seed({ startedAt: new Date('2026-06-01T00:00:00.000Z') });
    const result = await endAsHistorical(edgeId);

    expect(result).toMatchObject({ refusal: 'ended-before-started', detached: false });
    expect(((await RoleAssignment.findById(edgeId).lean()) as any).state).toBe('UNKNOWN');
  });
});

describe('role-assignments:detach-edge --end-as-historical arguments', () => {
  const base = ['--edge=0123456789abcdef01234567', '--note=stepped down', '--end-as-historical'];

  it('requires a real past --ended-at and a page --citation', () => {
    expect(() => parseDetachRoleAssignmentEdgeArgs([...base, `--citation=${PAGE}`])).toThrow(
      /--ended-at/,
    );
    expect(() => parseDetachRoleAssignmentEdgeArgs([...base, '--ended-at=2025-12-31'])).toThrow(
      /--citation/,
    );
    expect(() =>
      parseDetachRoleAssignmentEdgeArgs([...base, '--ended-at=2025-02-30', `--citation=${PAGE}`]),
    ).toThrow(/real calendar date/);
    expect(() =>
      parseDetachRoleAssignmentEdgeArgs([...base, '--ended-at=2999-01-01', `--citation=${PAGE}`]),
    ).toThrow(/future/);
    expect(
      parseDetachRoleAssignmentEdgeArgs([...base, '--ended-at=2025-12-31', `--citation=${PAGE}`])
        .endAsHistorical,
    ).toEqual({ endedAt: ENDED_AT, citationUrl: PAGE });
  });

  it('refuses --ended-at or --citation without the flag', () => {
    expect(() =>
      parseDetachRoleAssignmentEdgeArgs([
        '--edge=0123456789abcdef01234567',
        '--note=x',
        '--ended-at=2025-12-31',
      ]),
    ).toThrow(/only apply with/);
  });
});
