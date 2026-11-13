import { MongoClient, ObjectId, type Db } from 'mongodb';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { runSupersedeObservationsCommand, supersedeObservations } from '../supersedeObservations';
import { runUnfoldResearcherShellCommand, unfoldResearcherShell } from '../unfoldResearcherShell';
import { retireObservationIds, runRetireObservationIdsCommand } from '../retireObservationIds';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SESSION = 'agent:ylabs-fixture-session';
const ENV_KEYS = [
  DEV_WRITE_LEASE_SWITCH_ENV,
  DEV_WRITE_LEASE_OWNER_ENV,
  'DEV_WRITE_OWNER',
  'MONGODBURL',
  'ALLOW_NON_PROD_SCRAPER_WRITES',
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
  process.env.ALLOW_NON_PROD_SCRAPER_WRITES = 'true';
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

const seedFold = async () => {
  const shell = new ObjectId();
  const survivor = new ObjectId();
  await development()
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
  return { shell: String(shell), survivor: String(survivor) };
};

const seedObservation = async () => {
  const _id = new ObjectId();
  await development().collection('observations').insertOne({
    _id,
    entityType: 'user',
    entityKey: 'netid:zz9991',
    field: 'email',
    value: 'fixture@example.invalid',
    sourceId: new ObjectId(),
    sourceName: 'orcid-works',
    confidence: 0.8,
    observedAt: new Date(),
    superseded: false,
  });
  return String(_id);
};

const lease = () =>
  development()
    .collection(DEV_WRITE_LEASE_COLLECTION)
    .findOne({ sourceName: DEV_APPLY_LEASE_NAME });

describe('unfold-shell and observations:supersede under the Development write lease (#6018)', () => {
  it('unfold-shell applies through its apply guard, which takes the lease', async () => {
    const seeded = await seedFold();
    const result = await runUnfoldResearcherShellCommand(
      [
        `--shell=${seeded.shell}`,
        `--expect-survivor=${seeded.survivor}`,
        '--note=two different people',
        '--apply',
        '--confirm-unfold-shell',
      ],
      { log: () => undefined },
    );
    expect(result).toMatchObject({ unfolded: true, refusal: null });
    expect(await lease()).toMatchObject({ ownerLabel: SESSION });
    expect(String((await lease())?.command)).toContain('researchers:unfold-shell');
    const audit = await development().collection('admin_audit_events').findOne({});
    expect(audit).toMatchObject({ actorNetid: SESSION, targetId: seeded.shell });
  });

  it('unfold-shell is refused by the model guard when it skips the apply guard', async () => {
    const seeded = await seedFold();
    await connectScriptMongo(developmentUri());
    const refusal = await unfoldResearcherShell({
      shellId: seeded.shell,
      expectedSurvivorId: seeded.survivor,
      note: 'two different people',
      actor: SESSION,
      apply: true,
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(DevWriteRefusedError);
    const shell = await development()
      .collection('researchers')
      .findOne({ _id: new ObjectId(seeded.shell) });
    expect(shell?.archived).toBe(true);
  });

  it('unfold-shell takes no lease and writes nothing on a dry run', async () => {
    const seeded = await seedFold();
    const result = await runUnfoldResearcherShellCommand(
      [`--shell=${seeded.shell}`, '--note=two different people'],
      { log: () => undefined },
    );
    expect(result).toMatchObject({ unfolded: false, refusal: null });
    expect(await development().collection(DEV_WRITE_LEASE_COLLECTION).countDocuments()).toBe(0);
    expect(await development().collection('admin_audit_events').countDocuments()).toBe(0);
  });

  it('observations:supersede applies through its apply guard, which takes the lease', async () => {
    const id = await seedObservation();
    const result = await runSupersedeObservationsCommand(
      [
        `--ids=${id}`,
        '--reason=states the other person',
        '--apply',
        '--confirm-supersede-observations',
      ],
      { log: () => undefined },
    );
    expect(result).toMatchObject({ superseded: 1, refused: false });
    expect(String((await lease())?.command)).toContain('observations:supersede');
  });

  it('observations:supersede is refused by the model guard when it skips the apply guard', async () => {
    const id = await seedObservation();
    await connectScriptMongo(developmentUri());
    const refusal = await supersedeObservations({
      ids: [id],
      reason: 'states the other person',
      actor: SESSION,
      apply: true,
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(DevWriteRefusedError);
    const stored = await development()
      .collection('observations')
      .findOne({ _id: new ObjectId(id) });
    expect(stored?.superseded).toBe(false);
  });
  const seedRunObservation = async () => {
    const runId = new ObjectId();
    await development()
      .collection('scrape_runs')
      .insertOne({ _id: runId, sourceName: 'dept-faculty-roster', status: 'completed' });
    const id = new ObjectId();
    await development().collection('observations').insertOne({
      _id: id,
      scrapeRunId: runId,
      entityType: 'user',
      entityKey: 'netid:zz9993',
      field: 'email',
      value: 'fixture@example.invalid',
      sourceId: new ObjectId(),
      sourceName: 'dept-faculty-roster',
      confidence: 0.8,
      observedAt: new Date(),
      superseded: false,
    });
    const idsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retire-ids-')), 'ids.json');
    fs.writeFileSync(idsFile, JSON.stringify([String(id)]));
    return { runId: String(runId), id, idsFile };
  };

  it('observations:retire-ids applies through its apply guard, which takes the lease (#6029)', async () => {
    const seeded = await seedRunObservation();
    const result = await runRetireObservationIdsCommand(
      [
        `--run=${seeded.runId}`,
        `--ids-file=${seeded.idsFile}`,
        '--reason=pre-floor run',
        '--apply',
        '--confirm-retire-observation-ids',
      ],
      { log: () => undefined },
    );
    expect(result).toMatchObject({ retired: 1, refused: false });
    expect(String((await lease())?.command)).toContain('observations:retire-ids');
  });

  it('observations:retire-ids is refused by the model guard when it skips the apply guard (#6029)', async () => {
    const seeded = await seedRunObservation();
    await connectScriptMongo(developmentUri());
    const refusal = await retireObservationIds({
      runId: seeded.runId,
      ids: [String(seeded.id)],
      reason: 'pre-floor run',
      actor: SESSION,
      apply: true,
      restoreSuperseded: false,
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(DevWriteRefusedError);
    const stored = await development().collection('observations').findOne({ _id: seeded.id });
    expect(stored?.superseded).toBe(false);
  });
});
