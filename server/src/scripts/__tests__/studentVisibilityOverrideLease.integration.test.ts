import { MongoClient, type Db } from 'mongodb';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeConnections } from '../../db/connections';
import { DevWriteRefusedError, resetDevWriteGuardStateForTests } from '../../db/devWriteGuard';
import { DEV_WRITE_LAUNCH_COLLECTION } from '../../db/devWriteLaunch';
import {
  DEV_APPLY_LEASE_NAME,
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_OWNER_ENV,
  DEV_WRITE_LEASE_SWITCH_ENV,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
} from '../../db/devWriteLease';
import { main, runStudentVisibilityOverride } from '../studentVisibilityOverride';
import {
  STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
  parseStudentVisibilityOverrideArgs,
} from '../studentVisibilityOverrideCore';

const SLUG = 'synthetic-held-center';
const REASON = 'synthetic_hold_code: a synthetic center held for a test';
const OVERRIDE_ENV_KEYS = [
  'MONGODBURL',
  'SCRAPER_ENV',
  'ALLOW_NON_PROD_SCRAPER_WRITES',
  'DEV_WRITE_OWNER',
  DEV_WRITE_LEASE_SWITCH_ENV,
  DEV_WRITE_LEASE_OWNER_ENV,
] as const;

const overrideArgv = (mode: string[]) => [
  `--slug=${SLUG}`,
  '--tier=suppressed',
  `--reason=${REASON}`,
  '--actor=agent:fixture',
  ...mode,
];
const APPLY = ['--apply', '--confirm-student-visibility-override'];

let memoryServer: MongoMemoryServer;
let client: MongoClient;
let savedEnv: Partial<Record<(typeof OVERRIDE_ENV_KEYS)[number], string | undefined>>;

const development = (): Db => client.db('Development');

const seedReasonlessCenterHold = async () =>
  development().collection('research_entities').insertOne({
    slug: SLUG,
    name: 'Synthetic Held Center',
    displayName: 'Synthetic Held Center',
    kind: 'center',
    entityType: 'CENTER',
    archived: false,
    studentVisibilityTier: 'suppressed',
    studentVisibilityOverrideTier: 'suppressed',
  });

const storedRow = () => development().collection('research_entities').findOne({ slug: SLUG });
const auditEventCount = () => development().collection('admin_audit_events').countDocuments();
const applyLeases = () =>
  development()
    .collection(DEV_WRITE_LEASE_COLLECTION)
    .find({ sourceName: DEV_APPLY_LEASE_NAME })
    .toArray();
const applyLaunches = () =>
  development()
    .collection(DEV_WRITE_LAUNCH_COLLECTION)
    .find({ kind: 'apply', scriptName: STUDENT_VISIBILITY_OVERRIDE_SCRIPT })
    .toArray();

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  client = await MongoClient.connect(memoryServer.getUri());
});

afterAll(async () => {
  await client?.close();
  await memoryServer?.stop();
});

beforeEach(async () => {
  savedEnv = Object.fromEntries(OVERRIDE_ENV_KEYS.map((key) => [key, process.env[key]]));
  delete process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  process.env.MONGODBURL = `${memoryServer.getUri()}Development`;
  process.env.SCRAPER_ENV = 'development';
  process.env.ALLOW_NON_PROD_SCRAPER_WRITES = 'true';
  process.env.DEV_WRITE_OWNER = 'override-lease-test';
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  await development().dropDatabase();
  await seedReasonlessCenterHold();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await releaseHeldDevWriteLeases();
  await mongoose.disconnect();
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  vi.restoreAllMocks();
  for (const key of OVERRIDE_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('student-visibility:override under the Development write lease guard', () => {
  it('writes an apply through the CLI entry point, taking the apply lease and releasing it', async () => {
    await main(overrideArgv(APPLY));

    expect(await storedRow()).toMatchObject({
      studentVisibilityTier: 'suppressed',
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: REASON,
    });
    expect(await auditEventCount()).toBe(1);
    expect(await applyLaunches()).toHaveLength(1);
    const leases = await applyLeases();
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({ locked: false, releaseReason: 'success' });
  });

  it('is still refused by the guard when the connection opened before the apply guard ran', async () => {
    await initializeConnections();

    await expect(
      runStudentVisibilityOverride(parseStudentVisibilityOverrideArgs(overrideArgv(APPLY))),
    ).rejects.toBeInstanceOf(DevWriteRefusedError);

    expect((await storedRow())?.studentVisibilitySuppressionReason).toBeUndefined();
    expect(await auditEventCount()).toBe(0);
    expect(await applyLeases()).toHaveLength(0);
  });

  it('takes no lease and writes nothing on a dry run', async () => {
    const before = await storedRow();

    await main(overrideArgv(['--dry-run']));

    expect(await storedRow()).toEqual(before);
    expect(await auditEventCount()).toBe(0);
    expect(await applyLeases()).toHaveLength(0);
    expect(await applyLaunches()).toHaveLength(0);
  });

  it('refuses an apply without the write opt-in before it connects', async () => {
    delete process.env.ALLOW_NON_PROD_SCRAPER_WRITES;

    await expect(main(overrideArgv(APPLY))).rejects.toThrow('ALLOW_NON_PROD_SCRAPER_WRITES');

    expect(mongoose.connection.readyState).toBe(0);
    expect(await storedRow()).not.toHaveProperty('studentVisibilitySuppressionReason');
    expect(await applyLeases()).toHaveLength(0);
  });
});
