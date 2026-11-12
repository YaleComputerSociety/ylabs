import fs from 'fs';
import os from 'os';
import path from 'path';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectScriptMongo } from '../../db/connections';
import { DevWriteRefusedError, resetDevWriteGuardStateForTests } from '../../db/devWriteGuard';
import {
  DEV_APPLY_LEASE_NAME,
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_OWNER_ENV,
  DEV_WRITE_LEASE_SWITCH_ENV,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
} from '../../db/devWriteLease';
import {
  restoreDetachedRoleAssignmentEdge,
  runRestoreDetachedRoleAssignmentEdgeCommand,
} from '../restoreDetachedRoleAssignmentEdge';

const SESSION = 'ylabs-fixture-session';
const STAGE_NOTE =
  'Detached as a same-surname lead on an entity whose own identity names a different person (#2768).';
const ENV_KEYS = [
  DEV_WRITE_LEASE_SWITCH_ENV,
  DEV_WRITE_LEASE_OWNER_ENV,
  'DEV_WRITE_OWNER',
  'MONGODBURL',
] as const;

let memoryServer: MongoMemoryServer;
let client: MongoClient;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

const development = (): Db => client.db('Development');
const developmentUri = () => `${memoryServer.getUri()}Development`;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  client = await MongoClient.connect(memoryServer.getUri());
});

afterAll(async () => {
  await client?.close();
  await memoryServer?.stop();
});

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  delete process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  process.env.DEV_WRITE_OWNER = SESSION;
  process.env.MONGODBURL = developmentUri();
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  await development().dropDatabase();
});

afterEach(async () => {
  await releaseHeldDevWriteLeases();
  await mongoose.disconnect();
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const seedStageDetachedEdge = async () => {
  const person = new ObjectId();
  const row = new ObjectId();
  const edge = new ObjectId();
  await development()
    .collection('researchers')
    .insertOne({ _id: person, displayName: 'Fixture Person', archived: false });
  await development().collection('research_entities').insertOne({ _id: row, slug: 'fixture-row' });
  await development()
    .collection('role_assignments')
    .insertOne({
      _id: edge,
      personId: person,
      target: { kind: 'RESEARCH_ENTITY', id: row },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      reviewStatus: 'DISPUTED',
      reviewNotes: STAGE_NOTE,
      archived: true,
    });
  return { edge: String(edge), person: String(person), row: String(row) };
};

const snapshotPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'restore-edge-lease-')), 'edge.json');

const storedEdge = async (edge: string) =>
  development()
    .collection('role_assignments')
    .findOne({ _id: new ObjectId(edge) });

describe('restore-detached-edge under the Development write lease (#5879)', () => {
  it('applies through its apply guard, which takes the lease, and re-gates the row', async () => {
    const seeded = await seedStageDetachedEdge();
    const regate = vi.fn().mockResolvedValue(undefined);
    const printed: string[] = [];

    const result = await runRestoreDetachedRoleAssignmentEdgeCommand(
      [
        `--edge=${seeded.edge}`,
        '--note=the stage predicate misfired',
        `--expect-person=${seeded.person}`,
        `--expect-target=${seeded.row}`,
        `--snapshot=${snapshotPath()}`,
        '--apply',
        '--confirm-restore-role-edge',
      ],
      { regate, log: (line) => printed.push(line) },
    );

    expect(result).toMatchObject({ restored: true, regatedRow: true, refusal: null });
    expect(regate).toHaveBeenCalledWith(seeded.row);
    expect(await storedEdge(seeded.edge)).toMatchObject({
      archived: false,
      reviewStatus: 'UNREVIEWED',
      reviewedBy: SESSION,
    });
    const lease = await development()
      .collection(DEV_WRITE_LEASE_COLLECTION)
      .findOne({ sourceName: DEV_APPLY_LEASE_NAME });
    expect(lease).toMatchObject({ ownerLabel: SESSION });
    expect(String(lease?.command)).toContain('role-assignments:restore-detached-edge');
    expect(JSON.parse(printed[0])).toMatchObject({ mode: 'apply', restored: true });
  });

  it('re-gates the row through the real student visibility gate', async () => {
    const seeded = await seedStageDetachedEdge();
    await runRestoreDetachedRoleAssignmentEdgeCommand(
      [
        `--edge=${seeded.edge}`,
        '--note=the stage predicate misfired',
        `--expect-person=${seeded.person}`,
        `--expect-target=${seeded.row}`,
        `--snapshot=${snapshotPath()}`,
        '--apply',
        '--confirm-restore-role-edge',
      ],
      { log: () => undefined },
    );
    const row = await development()
      .collection('research_entities')
      .findOne({ _id: new ObjectId(seeded.row) });
    expect(row?.studentVisibilityEvaluatedAt).toBeInstanceOf(Date);
  });

  it('is refused by the model guard when the same write skips the apply guard, so the lease is what admits it', async () => {
    const seeded = await seedStageDetachedEdge();
    const regate = vi.fn();
    await connectScriptMongo(developmentUri());

    const refusal = await restoreDetachedRoleAssignmentEdge(
      {
        edgeId: seeded.edge,
        note: 'the stage predicate misfired',
        actor: SESSION,
        expectedPersonId: seeded.person,
        expectedTargetId: seeded.row,
        snapshot: snapshotPath(),
        apply: true,
      },
      regate,
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(DevWriteRefusedError);
    expect(regate).not.toHaveBeenCalled();
    expect(await storedEdge(seeded.edge)).toMatchObject({
      archived: true,
      reviewStatus: 'DISPUTED',
      reviewNotes: STAGE_NOTE,
    });
  });

  it('takes no lease and writes nothing on a dry run', async () => {
    const seeded = await seedStageDetachedEdge();
    const before = await storedEdge(seeded.edge);

    const result = await runRestoreDetachedRoleAssignmentEdgeCommand(
      [`--edge=${seeded.edge}`, '--note=the stage predicate misfired'],
      { log: () => undefined },
    );

    expect(result).toMatchObject({ restored: false, refusal: null, decider: 'stage-or-agent' });
    expect(await storedEdge(seeded.edge)).toEqual(before);
    expect(await development().collection(DEV_WRITE_LEASE_COLLECTION).countDocuments()).toBe(0);
  });
});
