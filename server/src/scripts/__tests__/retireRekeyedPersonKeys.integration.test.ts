import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import { REKEYED_PERSON_KEY_RETIREMENT_REASON } from '../../scrapers/rekeyedPersonKeyPlan';
import {
  parseRetireRekeyedPersonKeysArgs,
  runRekeyedPersonKeyRetirement,
} from '../retireRekeyedPersonKeys';

const LANE = 'dept-faculty-roster';
const ROSTER = 'https://chemistry.yale.edu/people/faculty';
const PAGE = 'https://chemistry.yale.edu/people/wren-tallowmere';
const OLD_KEY = 'dept:chemistry:wren-tallowmere';
const NEW_KEY = 'netid:wt482';

describe('observations:retire-rekeyed-person-keys (#5817)', () => {
  let replSet: MongoMemoryReplSet;
  let sourceId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.createIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'sources', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    const source = await Source.create({ name: LANE, displayName: 'Rosters', defaultWeight: 0.7 });
    sourceId = source._id as mongoose.Types.ObjectId;
  });

  const seedRead = async (input: {
    key: string;
    startedAt: string;
    netid?: string;
    options?: Record<string, unknown>;
  }) => {
    const run = await ScrapeRun.create({
      sourceId,
      sourceName: LANE,
      startedAt: new Date(input.startedAt),
      status: 'success',
      options: input.options ?? {},
    });
    const observedAt = new Date(new Date(input.startedAt).getTime() + 1000);
    const base = {
      entityType: 'user',
      entityKey: input.key,
      sourceId,
      sourceName: LANE,
      scrapeRunId: run._id,
      observedAt,
      confidence: 0.7,
      superseded: false,
    };
    const fields: Array<[string, unknown, string]> = [
      ['fname', 'Wren', ROSTER],
      ['lname', 'Tallowmere', ROSTER],
      ['departments', ['Chemistry'], ROSTER],
      ['dataSources', [LANE], ROSTER],
      ['profileUrls', { departmental: PAGE }, PAGE],
      ['title', 'Professor of Chemistry', PAGE],
      ...(input.netid
        ? ([['netid', input.netid, ROSTER]] as Array<[string, unknown, string]>)
        : []),
    ];
    await Observation.insertMany(
      fields.map(([field, value, sourceUrl]) => ({
        ...base,
        field,
        value,
        sourceUrl,
        observationFingerprint: `${input.key}:${field}:${run._id}`,
      })),
    );
  };

  it('plans in a dry run, retires on apply, and a second apply retires nothing', async () => {
    await seedRead({ key: OLD_KEY, startedAt: '2026-10-01T00:00:00Z' });
    await seedRead({ key: NEW_KEY, startedAt: '2026-11-01T00:00:00Z', netid: 'wt482' });

    const dry = await runRekeyedPersonKeyRetirement({ apply: false, lanes: [LANE] });
    expect(dry.report.lanes[LANE]).toMatchObject({
      wouldRetireKeys: 1,
      wouldRetireObservations: 6,
      counts: { admitted: { '(a) dept: -> netid:': 1 } },
    });
    expect(dry.report.projection.twinKeysProjected).toBe(1);
    expect(dry.report.retiredObservations).toBe(0);
    expect(await Observation.countDocuments({ entityKey: OLD_KEY, superseded: false })).toBe(6);

    const applied = await runRekeyedPersonKeyRetirement({
      apply: true,
      acceptServedChanges: true,
      lanes: [LANE],
    });
    expect(applied.report.retiredObservations).toBe(6);
    const retired = await Observation.find({ entityKey: OLD_KEY }).lean<
      Array<{ superseded: boolean; rollback?: { reason?: string } }>
    >();
    expect(retired.every((row) => row.superseded)).toBe(true);
    expect(new Set(retired.map((row) => row.rollback?.reason))).toEqual(
      new Set([REKEYED_PERSON_KEY_RETIREMENT_REASON]),
    );

    const again = await runRekeyedPersonKeyRetirement({ apply: true, lanes: [LANE] });
    expect(again.report.retiredObservations).toBe(0);
    expect(again.report.lanes[LANE].wouldRetireKeys).toBe(0);
  });

  it('plans nothing when the newer read was a --limit run', async () => {
    await seedRead({ key: OLD_KEY, startedAt: '2026-10-01T00:00:00Z' });
    await seedRead({
      key: NEW_KEY,
      startedAt: '2026-11-01T00:00:00Z',
      netid: 'wt482',
      options: { limit: 5 },
    });
    const dry = await runRekeyedPersonKeyRetirement({ apply: false, lanes: [LANE] });
    expect(dry.report.lanes[LANE].wouldRetireKeys).toBe(0);
  });

  it('refuses an apply without the confirm flag shape and an unknown lane', () => {
    expect(() => parseRetireRekeyedPersonKeysArgs([])).toThrow(/requires --lanes/);
    expect(() =>
      parseRetireRekeyedPersonKeysArgs(['--lanes=official-profile-pi-backfill']),
    ).toThrow(/does not plan lane/);
    expect(
      parseRetireRekeyedPersonKeysArgs(['--lanes=dept-faculty-roster', '--apply']),
    ).toMatchObject({ apply: true, confirmed: false, lanes: [LANE] });
  });
});
