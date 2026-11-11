import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

import { Account } from '../account';
import { Observation } from '../observation';
import { Researcher } from '../researcher';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { clearC4Flags } from '../../scrapers/__tests__/c4FlagTestEnv';

/**
 * The person-key lookup behind a researcher's pooled title is one `$or` read with an
 * entityId, an entityKey, an address and an official-page arm, and one arm without a usable
 * index turns the whole read into a scan (#5578). The command is captured from the real
 * caller rather than restated, and explained with the address index present and dropped.
 */
const NETID = 'qs5578';
const ADDRESS = 'quinn.synthetic5578@yale.edu';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/quinn-synthetic/';
const FILLER_KEYS = 4000;
const EMAIL_INDEX = 'field_1_value_1';
const ARM_INDEXES = [
  'entityType_1_entityId_1_field_1_observedAt_-1',
  'entityType_1_entityKey_1_field_1_observedAt_-1',
  EMAIL_INDEX,
  'sourceUrl_1_observedAt_-1',
];

interface PlanReading {
  stages: string[];
  indexes: string[];
  docsExamined: number;
}

const distinctValues = (plan: string, key: string): string[] => [
  ...new Set(
    (plan.match(new RegExp(`"${key}":"([A-Za-z_.\\-0-9]+)"`, 'g')) || []).map(
      (match) => match.split('"')[3],
    ),
  ),
];

async function explain(command: Record<string, any>): Promise<PlanReading> {
  const { lsid: _lsid, $db: _db, $clusterTime: _clusterTime, ...explainable } = command;
  const explained: any = await mongoose.connection.db!.command({
    explain: explainable,
    verbosity: 'executionStats',
  });
  const winningPlan = JSON.stringify(explained.queryPlanner.winningPlan);
  return {
    stages: distinctValues(winningPlan, 'stage'),
    indexes: distinctValues(winningPlan, 'indexName'),
    docsExamined: explained.executionStats.totalDocsExamined,
  };
}

const observation = (entityKey: string, field: string, value: unknown, sourceUrl: string) => ({
  entityType: 'user',
  entityKey,
  sourceId: new mongoose.Types.ObjectId(),
  field,
  value,
  sourceName: 'dept-faculty-roster',
  sourceUrl,
  confidence: 0.7,
  observedAt: new Date('2026-10-01T00:00:00Z'),
  superseded: false,
});

describe('the person-key lookup reads every $or arm through an index (#5578)', () => {
  let server: MongoMemoryServer;
  let captured: Record<string, any>[] = [];

  beforeAll(async () => {
    clearC4Flags();
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), {
      autoIndex: false,
      autoCreate: false,
      monitorCommands: true,
    });
    mongoose.connection.getClient().on('commandStarted', (event: any) => {
      if (event.commandName === 'find') captured.push(event.command);
    });
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.createCollection(name);
    }
    await Observation.createIndexes();
    await Researcher.createIndexes();
    await Account.createIndexes();

    const filler: Record<string, unknown>[] = [];
    for (let index = 0; index < FILLER_KEYS; index += 1) {
      const key = `netid:filler${index}`;
      const page = `https://fixture-dept.yale.edu/people/filler-${index}`;
      filler.push(observation(key, 'email', `filler${index}@yale.edu`, page));
      filler.push(observation(key, 'title', 'Professor of Fixtures', page));
    }
    await Observation.insertMany(filler);
    await Account.create({ netid: NETID, email: ADDRESS, status: 'ACTIVE' });
    await Researcher.create({
      displayName: 'Quinn Synthetic',
      identifiers: { netid: NETID },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OFFICIAL_PAGE,
          verifiedAt: new Date('2026-09-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
    });
    await Observation.insertMany([
      observation(`netid:${NETID}`, 'fname', 'Quinn', OFFICIAL_PAGE),
      observation(`netid:${NETID}`, 'lname', 'Synthetic', OFFICIAL_PAGE),
      observation(`netid:${NETID}`, 'title', 'Professor of Medicine', OFFICIAL_PAGE),
      observation('netid:quinn.synthetic5578', 'email', ADDRESS, 'https://fixture-dept.yale.edu/'),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  async function capturedPersonKeyLookup(): Promise<Record<string, any>> {
    captured = [];
    await materializeEntity('user', { entityKey: `netid:${NETID}` }, { dryRun: true });
    const lookups = captured.filter(
      (command) =>
        command.find === 'observations' &&
        Array.isArray(command.filter?.$or) &&
        command.filter.$or.some((arm: Record<string, unknown>) => 'entityId' in arm),
    );
    expect(lookups).toHaveLength(1);
    return lookups[0];
  }

  it('plans an index scan for the entityId, entityKey, address and official-page arms', async () => {
    const command = await capturedPersonKeyLookup();
    const plan = await explain(command);

    expect(command.filter.$or).toHaveLength(4);
    expect(plan.stages).toContain('OR');
    expect(plan.stages).not.toContain('COLLSCAN');
    expect(plan.indexes).toEqual(expect.arrayContaining(ARM_INDEXES));
    expect(plan.docsExamined).toBeLessThan(20);
  });

  it('matches the official page with and without its trailing slash', async () => {
    const command = await capturedPersonKeyLookup();
    const pageArm = command.filter.$or.find((arm: Record<string, any>) => arm.sourceUrl);

    expect(pageArm.sourceUrl.$in).toEqual(
      expect.arrayContaining([OFFICIAL_PAGE, OFFICIAL_PAGE.replace(/\/$/, '')]),
    );
  });

  it('falls back to a scan when the address index is missing', async () => {
    const command = await capturedPersonKeyLookup();
    await mongoose.connection.db!.collection('observations').dropIndex(EMAIL_INDEX);
    try {
      const plan = await explain(command);
      expect(plan.indexes).not.toContain(EMAIL_INDEX);
      expect(plan.docsExamined).toBeGreaterThan(FILLER_KEYS);
    } finally {
      await Observation.createIndexes();
    }
  });
});
