import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ScrapeRun } from '../../models/scrapeRun';
import type { ScrapeRunStatus } from '../../models/storedVocabularies';
import { materializeEntity } from '../entityMaterializer';
import { isCoveringKeyedRun, TITLE_COVERED_KEYS_METRIC } from '../latestFullCoverageRun';
import { clearC4Flags } from './c4FlagTestEnv';
import { FULL_COVERAGE_RUN_OPTIONS } from './fullCoverageRunFixture';

const NETID = 'kc6197';
const NETID_KEY = `netid:${NETID}`;
const SCHOOL_KEY = 'ysm:kestrel-covered';
const OTHER_SCHOOL_KEY = 'ysm:someone-else-synthetic';
const SCHOOL_LANE = 'ysm-faculty-directory';
const ROSTER_LANE = 'dept-faculty-roster';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/kestrel-covered/';
const ROSTER_LISTING = 'https://fixture-dept.yale.edu/people/faculty';
const NOW = new Date('2026-11-20T00:00:00Z');

const FULL_RUN_RANK = 'Assistant Professor of Fixture Medicine';
const KEYED_RUN_RANK = 'Associate Professor of Fixture Medicine';
const COPIED_RANK = 'Professor of Fixture Medicine';
const STORED_RANK = 'Lecturer in Fixture Medicine';

const FULL_RUN_START = '2026-10-01T00:00:00Z';
const KEYED_RUN_START = '2026-11-05T00:00:00Z';

type RunShape = {
  startedAt: string;
  options?: Record<string, unknown>;
  status?: ScrapeRunStatus;
  invalidated?: boolean;
  coveredKeys?: string[];
};

async function recordRun(sourceName: string, run: RunShape): Promise<mongoose.Types.ObjectId> {
  const _id = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    startedAt: new Date(run.startedAt),
    finishedAt: new Date(run.startedAt),
    status: run.status ?? 'success',
    invalidated: run.invalidated ?? false,
    options: run.options ?? FULL_COVERAGE_RUN_OPTIONS,
    ...(run.coveredKeys ? { metrics: { [TITLE_COVERED_KEYS_METRIC]: run.coveredKeys } } : {}),
  });
  return _id;
}

const keyedOptions = (only: string[] = [SCHOOL_KEY]) => ({
  dryRun: false,
  useCache: false,
  release: false,
  only,
});

async function recordKeyedRun(
  overrides: Partial<RunShape> = {},
  sourceName = SCHOOL_LANE,
): Promise<mongoose.Types.ObjectId> {
  return recordRun(sourceName, {
    startedAt: KEYED_RUN_START,
    options: keyedOptions(),
    coveredKeys: [SCHOOL_KEY],
    ...overrides,
  });
}

async function seedRead(input: {
  scrapeRunId: mongoose.Types.ObjectId;
  observedAt: string;
  title?: string;
  sourceName?: string;
  entityKey?: string;
  sourceUrl?: string;
  extraction?: Record<string, unknown>;
}): Promise<void> {
  const base = {
    entityType: 'user',
    entityKey: input.entityKey ?? SCHOOL_KEY,
    sourceId: new mongoose.Types.ObjectId(),
    scrapeRunId: input.scrapeRunId,
    sourceName: input.sourceName ?? SCHOOL_LANE,
    sourceUrl: input.sourceUrl ?? OFFICIAL_PAGE,
    confidence: 0.8,
    observedAt: new Date(input.observedAt),
    superseded: false,
  };
  await Observation.insertMany([
    { ...base, field: 'fname', value: 'Kestrel' },
    { ...base, field: 'lname', value: 'Covered' },
    ...(input.title
      ? [
          {
            ...base,
            field: 'title',
            value: input.title,
            ...(input.extraction ? { extraction: input.extraction } : {}),
          },
        ]
      : []),
  ]);
}

async function seedFullRunRead(title = FULL_RUN_RANK): Promise<void> {
  const fullRunId = await recordRun(SCHOOL_LANE, { startedAt: FULL_RUN_START });
  await seedRead({ scrapeRunId: fullRunId, observedAt: FULL_RUN_START, title });
}

async function seedRosterListingRead(): Promise<void> {
  await seedRead({
    scrapeRunId: new mongoose.Types.ObjectId(),
    observedAt: '2026-11-09T00:00:00Z',
    title: COPIED_RANK,
    sourceName: ROSTER_LANE,
    entityKey: NETID_KEY,
    sourceUrl: ROSTER_LISTING,
  });
}

async function storedTitle(): Promise<string | undefined> {
  const researcher: any = await Researcher.findOne({ 'identifiers.netid': NETID }).lean();
  return researcher?.profile?.title;
}

async function materializeEveryKey(): Promise<number[]> {
  const written: number[] = [];
  for (const entityKey of [NETID_KEY, SCHOOL_KEY]) {
    written.push((await materializeEntity('user', { entityKey }, { now: NOW })).fieldsWritten);
  }
  return written;
}

describe('a newer keyed run that covered the key makes its first-hand read fresh (#6197)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    await Researcher.create({
      displayName: 'Kestrel Covered',
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
      profile: { title: STORED_RANK },
    });
  });

  it("serves a covered key's read from a keyed run newer than the full run, then writes nothing", async () => {
    await seedFullRunRead();
    const keyedRunId = await recordKeyedRun();
    await seedRead({ scrapeRunId: keyedRunId, observedAt: KEYED_RUN_START, title: KEYED_RUN_RANK });

    await materializeEveryKey();
    expect(await storedTitle()).toBe(KEYED_RUN_RANK);

    expect(await materializeEveryKey()).toEqual([0, 0]);
  });

  it("keeps the full run's read for a key the newer keyed run did not cover", async () => {
    await seedFullRunRead();
    const keyedRunId = await recordKeyedRun({
      options: keyedOptions([OTHER_SCHOOL_KEY]),
      coveredKeys: [OTHER_SCHOOL_KEY],
    });
    await seedRead({ scrapeRunId: keyedRunId, observedAt: KEYED_RUN_START, title: KEYED_RUN_RANK });

    await materializeEveryKey();

    expect(await storedTitle()).toBe(FULL_RUN_RANK);
  });

  it('gives a keyed run older than the full run no authority', async () => {
    await recordRun(SCHOOL_LANE, { startedAt: FULL_RUN_START });
    const olderKeyedRunId = await recordKeyedRun({ startedAt: '2026-09-01T00:00:00Z' });
    await seedRead({
      scrapeRunId: olderKeyedRunId,
      observedAt: '2026-09-01T00:00:00Z',
      title: KEYED_RUN_RANK,
    });

    expect(await materializeEveryKey()).toEqual([0, 0]);
    expect(await storedTitle()).toBe(STORED_RANK);
  });

  it.each([
    ['an interrupted', { status: 'interrupted' }],
    ['a failed', { status: 'failure' }],
    ['a partial', { status: 'partial' }],
    ['an invalidated', { invalidated: true }],
    ['a dry', { options: { ...keyedOptions(), dryRun: true } }],
  ] as Array<[string, Partial<RunShape>]>)(
    '%s keyed run covers no one',
    async (_label, overrides) => {
      await seedFullRunRead();
      const keyedRunId = await recordKeyedRun(overrides);
      await seedRead({
        scrapeRunId: keyedRunId,
        observedAt: KEYED_RUN_START,
        title: KEYED_RUN_RANK,
      });

      await materializeEveryKey();

      expect(await storedTitle()).toBe(FULL_RUN_RANK);
    },
  );

  it('retires nothing when a covering keyed read states no title', async () => {
    await Researcher.updateOne(
      { 'identifiers.netid': NETID },
      { $set: { 'profile.title': FULL_RUN_RANK } },
    );
    await seedFullRunRead();
    await seedRosterListingRead();
    const keyedRunId = await recordKeyedRun({ startedAt: '2026-11-12T00:00:00Z' });
    await seedRead({ scrapeRunId: keyedRunId, observedAt: '2026-11-12T00:00:00Z' });

    expect(await materializeEveryKey()).toEqual([0, 0]);
    expect(await storedTitle()).toBe(FULL_RUN_RANK);

    await Researcher.updateOne({ 'identifiers.netid': NETID }, { $unset: { 'profile.title': 1 } });
    await materializeEveryKey();
    expect(await storedTitle()).toBe(FULL_RUN_RANK);
  });
});

describe("a marked roster title is fresh only from the lane's latest full run (#5578)", () => {
  let replSet: MongoMemoryReplSet;
  const MARKED = { source: 'profileTitleBlock' };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    await Researcher.create({
      displayName: 'Kestrel Covered',
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
      profile: { title: STORED_RANK },
    });
  });

  async function seedMarkedRosterRead(): Promise<void> {
    const fullRunId = await recordRun(ROSTER_LANE, { startedAt: FULL_RUN_START });
    await seedRead({
      scrapeRunId: fullRunId,
      observedAt: FULL_RUN_START,
      title: KEYED_RUN_RANK,
      sourceName: ROSTER_LANE,
      entityKey: NETID_KEY,
      extraction: MARKED,
    });
  }

  it("serves a marked roster read from the lane's latest full run", async () => {
    await seedMarkedRosterRead();

    await materializeEveryKey();

    expect(await storedTitle()).toBe(KEYED_RUN_RANK);
  });

  it('gives the same marked read no authority once a newer full run exists', async () => {
    await seedMarkedRosterRead();
    await recordRun(ROSTER_LANE, { startedAt: '2026-11-01T00:00:00Z' });

    expect(await materializeEveryKey()).toEqual([0, 0]);
    expect(await storedTitle()).toBe(STORED_RANK);
  });
});

describe('the covering keyed run screen (#6197)', () => {
  const covering = {
    status: 'success',
    invalidated: false,
    options: keyedOptions(),
    metrics: { [TITLE_COVERED_KEYS_METRIC]: [SCHOOL_KEY] },
  };

  it('counts only a completed, written, keyed run that recorded covered keys', () => {
    expect(isCoveringKeyedRun(covering)).toBe(true);
    expect(isCoveringKeyedRun({ ...covering, status: 'interrupted' })).toBe(false);
    expect(isCoveringKeyedRun({ ...covering, status: 'failure' })).toBe(false);
    expect(isCoveringKeyedRun({ ...covering, invalidated: true })).toBe(false);
    expect(isCoveringKeyedRun({ ...covering, options: { ...keyedOptions(), dryRun: true } })).toBe(
      false,
    );
    expect(isCoveringKeyedRun({ ...covering, options: { ...keyedOptions(), only: [] } })).toBe(
      false,
    );
    expect(isCoveringKeyedRun({ ...covering, metrics: { [TITLE_COVERED_KEYS_METRIC]: [] } })).toBe(
      false,
    );
    expect(isCoveringKeyedRun({ ...covering, metrics: undefined })).toBe(false);
  });
});
