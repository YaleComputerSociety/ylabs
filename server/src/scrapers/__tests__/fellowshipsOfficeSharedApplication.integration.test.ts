import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { materializeEntity } from '../entityMaterializer';
import { YaleCollegeFellowshipsOfficeScraper } from '../sources/yaleCollegeFellowshipsOfficeScraper';

beforeEach(clearC4Flags);

const LANE = 'yale-college-fellowships-office';
const SHARED_APPLICATION =
  'https://yale.communityforce.com/Funds/FundDetails.aspx?FixtureSharedApplication';
const FIRST_URL = 'https://funding.yale.edu/fixture-first-program';
const SECOND_URL = 'https://funding.yale.edu/fixture-second-program';

const pages: Record<string, string> = {
  [FIRST_URL]: `<main><h1>Fixture First Research Fellowship</h1><p>The first fellowship supports independent research with a faculty mentor across the academic year.</p><p>Deadline: January 15, 2027</p><a href="${SHARED_APPLICATION}">Joint application</a></main>`,
  [SECOND_URL]: `<main><h1>Fixture Second Research Fellowship</h1><p>The second fellowship funds summer research for juniors in the sciences.</p><p>Deadline: March 1, 2027</p><a href="${SHARED_APPLICATION}">Apply</a></main>`,
};

async function runLaneAndPersist(pageUrls: string[]): Promise<string[]> {
  const sourceId = new mongoose.Types.ObjectId();
  const emitted: any[] = [];
  const scraper = new YaleCollegeFellowshipsOfficeScraper({
    pageUrls,
    fetchPage: async (url: string) => {
      const html = pages[url];
      if (!html) throw new Error(`unexpected fetch ${url}`);
      return html;
    },
  });
  await scraper.run({
    scrapeRunId: 'run-1',
    sourceId: String(sourceId),
    sourceName: LANE,
    sourceWeight: 0.95,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (items: any) => {
      emitted.push(...(Array.isArray(items) ? items : [items]));
    },
    log: vi.fn(),
  } as any);
  const fellowshipObservations = emitted.filter((o) => o.entityType === 'fellowship');
  for (const o of fellowshipObservations) {
    await Observation.create({
      ...o,
      sourceId,
      sourceName: LANE,
      confidence: o.confidence ?? 0.95,
      observedAt: o.observedAt ?? new Date('2026-09-30T00:00:00Z'),
      superseded: false,
    });
  }
  return [...new Set(fellowshipObservations.map((o) => String(o.entityKey)))];
}

describe('fellowships office programs that share one application', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'fellowships']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('materializes one row per program, each carrying only its own description and deadline', async () => {
    const keys = await runLaneAndPersist([FIRST_URL, SECOND_URL]);
    expect(keys).toHaveLength(2);
    for (const entityKey of keys) {
      await materializeEntity('fellowship', { entityKey });
    }

    const rows = await Fellowship.find({}).lean<any[]>();
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => /First/.test(r.title));
    const second = rows.find((r) => /Second/.test(r.title));
    expect(first?.description).toMatch(/first fellowship/);
    expect(first?.description).not.toMatch(/second fellowship/);
    expect(second?.description).toMatch(/second fellowship/);
    expect(second?.description).not.toMatch(/first fellowship/);
    expect(String(first?.deadline ?? '')).not.toBe(String(second?.deadline ?? ''));
    expect(first?.applicationLink).toBe(SHARED_APPLICATION);
    expect(second?.applicationLink).toBe(SHARED_APPLICATION);
  });

  it('mints the missing program instead of folding it into the row the lane already owns at that application', async () => {
    const [firstKey] = await runLaneAndPersist([FIRST_URL]);
    await materializeEntity('fellowship', { entityKey: firstKey });
    const before = await Fellowship.findOne({}).lean<any>();

    const [secondKey] = await runLaneAndPersist([SECOND_URL]);
    const result = await materializeEntity('fellowship', { entityKey: secondKey });

    expect(result.created).toBe(true);
    expect(await Fellowship.countDocuments({})).toBe(2);
    const after = await Fellowship.findById(before._id).lean<any>();
    expect(after.title).toBe(before.title);
    expect(after.description).toBe(before.description);
  });

  it('still lets the enrich-only catalog join the lane row through its fund page', async () => {
    const [firstKey] = await runLaneAndPersist([FIRST_URL]);
    const owned = await materializeEntity('fellowship', { entityKey: firstKey });

    const catalogKey = 'student-grants-database:funds-funddetails-aspx-fixturesharedapplication';
    const sourceId = new mongoose.Types.ObjectId();
    for (const [field, value] of [
      ['title', 'Fixture First Research Fellowship'],
      ['sourceName', 'student-grants-database'],
      ['sourceUrl', SHARED_APPLICATION],
      ['applicationLink', SHARED_APPLICATION],
    ]) {
      await Observation.create({
        entityType: 'fellowship',
        entityKey: catalogKey,
        field,
        value,
        sourceId,
        sourceName: 'student-grants-database',
        sourceUrl: SHARED_APPLICATION,
        confidence: 0.9,
        observedAt: new Date('2026-09-30T00:00:00Z'),
        superseded: false,
      });
    }
    const joined = await materializeEntity('fellowship', { entityKey: catalogKey });

    expect(joined.created).toBe(false);
    expect(String(joined.entityId)).toBe(String(owned.entityId));
    expect(await Fellowship.countDocuments({})).toBe(1);
  });
});
