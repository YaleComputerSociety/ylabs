import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  GATE_SCORECARD_SNAPSHOT_COLLECTION,
  GateScorecardSnapshot,
} from '../../models/gateScorecardSnapshot';
import {
  connectedDatabaseName,
  environmentForConnectedDatabase,
  readStoredGateScorecards,
  writeGateScorecardSnapshot,
  type StoredGateScorecard,
} from '../gateScorecardSnapshotStore';

let memoryServer: MongoMemoryServer | undefined;

const snapshot = (overrides: Partial<StoredGateScorecard> = {}): StoredGateScorecard => ({
  gate: 'launchTrust',
  environment: 'development',
  databaseName: connectedDatabaseName(),
  measuredAt: new Date('2026-06-07T00:00:00.000Z'),
  storedAt: new Date('2026-06-07T00:00:05.000Z'),
  refreshRunId: 'run-1',
  evaluated: {
    command: 'yarn launch:trust-contract --collection=all --mode=student-ready-only --strict',
    exitCode: 1,
    artifactWritten: true,
    artifactPath: '/tmp/ylabs-launch-trust-contract.json',
    artifactGeneratedAt: '2026-06-07T00:00:00.000Z',
    artifactDatabase: 'development',
    artifactEnvironment: 'development',
  },
  summary: { pass: false, heldCount: 4, publicVisibilityViolations: 0, repairLaneCount: 1 },
  ...overrides,
});

describe('gate scorecard snapshots over a real store', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('development'));
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.db!.collection(GATE_SCORECARD_SNAPSHOT_COLLECTION).deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('derives the environment from the database it is connected to', () => {
    expect(connectedDatabaseName()).toBe('development');
    expect(environmentForConnectedDatabase(connectedDatabaseName())).toBe('development');
  });

  it('round-trips what was evaluated alongside the verdict', async () => {
    await writeGateScorecardSnapshot(snapshot());

    const rows = await readStoredGateScorecards();
    const stored = rows.get('launchTrust');

    expect(stored?.measuredAt.toISOString()).toBe('2026-06-07T00:00:00.000Z');
    expect(stored?.refreshRunId).toBe('run-1');
    expect(stored?.evaluated).toMatchObject({
      command: 'yarn launch:trust-contract --collection=all --mode=student-ready-only --strict',
      exitCode: 1,
      artifactWritten: true,
      artifactDatabase: 'development',
    });
    expect(stored?.summary).toMatchObject({ pass: false, heldCount: 4 });
  });

  it('keeps one row per gate and replaces a verdict with a later failed refresh', async () => {
    await writeGateScorecardSnapshot(snapshot());
    await writeGateScorecardSnapshot(
      snapshot({
        refreshRunId: 'run-2',
        measuredAt: new Date('2026-06-07T01:00:00.000Z'),
        evaluated: {
          command: 'yarn launch:trust-contract --collection=all --mode=student-ready-only --strict',
          exitCode: 2,
          artifactWritten: false,
          failureReason: 'the feeder wrote no scorecard',
        },
        summary: undefined,
      }),
    );

    expect(await GateScorecardSnapshot.countDocuments({ gate: 'launchTrust' })).toBe(1);
    const stored = (await readStoredGateScorecards()).get('launchTrust');
    expect(stored?.refreshRunId).toBe('run-2');
    expect(stored?.summary ?? undefined).toBeUndefined();
    expect(stored?.evaluated.failureReason).toBe('the feeder wrote no scorecard');
  });

  it('does not read a row stored against another database as this one', async () => {
    await writeGateScorecardSnapshot(snapshot({ databaseName: 'Beta', environment: 'beta' }));

    expect((await readStoredGateScorecards()).size).toBe(0);
    expect((await readStoredGateScorecards('Beta')).get('launchTrust')?.environment).toBe('beta');
  });
});
