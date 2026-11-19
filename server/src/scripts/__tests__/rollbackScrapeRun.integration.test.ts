import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { clearC4Flags } from '../../scrapers/__tests__/c4FlagTestEnv';
import { resetInvalidatedScrapeRunCache } from '../../scrapers/invalidatedScrapeRuns';
import { appendObservations } from '../../scrapers/observationStore';
import { parseRollbackScrapeRunArgs, rollbackScrapeRun } from '../rollbackScrapeRun';

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
  clearC4Flags();
  resetInvalidatedScrapeRunCache();
  await Observation.deleteMany({});
  await ScrapeRun.deleteMany({});
});

const SOURCE = { id: new mongoose.Types.ObjectId(), name: 'fixture-roster-source' };
const OTHER_SOURCE = { id: new mongoose.Types.ObjectId(), name: 'fixture-other-source' };
const NOTE = 'run added links to differently named people';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const startRun = async (source = SOURCE, over: Record<string, unknown> = {}) => {
  await tick();
  const run = await ScrapeRun.create({
    sourceId: source.id,
    sourceName: source.name,
    status: 'success',
    startedAt: new Date(),
    ...over,
  });
  await tick();
  return String(run._id);
};

const write = (runId: string, rows: Array<[string, string, unknown]>, source = SOURCE) =>
  appendObservations(
    rows.map(([entityKey, field, value]) => ({
      entityType: 'researchEntity' as const,
      entityKey,
      field,
      value,
      sourceUrl: `https://example.edu/fixture/${entityKey}`,
    })),
    {
      scrapeRunId: runId,
      sourceId: String(source.id),
      sourceName: source.name,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );

const dump = async () =>
  (await Observation.find({}).sort({ _id: 1 }).lean()).map((row) => {
    const { updatedAt: _updatedAt, ...rest } = row as Record<string, unknown>;
    return JSON.parse(JSON.stringify(rest));
  });

const seedPriorState = async () => {
  const olderRun = await startRun();
  await write(olderRun, [['fixture-lab-e', 'researchAreas', ['former topic']]]);
  const priorRun = await startRun();
  await write(priorRun, [
    ['fixture-lab-a', 'name', 'Fixture Lab A'],
    ['fixture-lab-b', 'researchAreas', ['synthetic biology']],
    ['fixture-lab-c', 'websiteUrl', 'https://example.edu/lab-c'],
    ['fixture-lab-e', 'researchAreas', ['current topic']],
  ]);
  const otherRun = await startRun(OTHER_SOURCE);
  await write(otherRun, [['fixture-lab-a', 'name', 'Fixture Laboratory A']], OTHER_SOURCE);
  return dump();
};

const writeBadRun = async () => {
  const badRun = await startRun();
  const result = await write(badRun, [
    ['fixture-lab-a', 'name', 'Fixture Lab A Renamed'],
    ['fixture-lab-b', 'researchAreas', ['synthetic biology']],
    ['fixture-lab-d', 'name', 'Fixture Lab D'],
  ]);
  expect(result.superseded).toBe(2);
  return badRun;
};

const liveValues = async () =>
  (await Observation.find({ superseded: false }).lean())
    .map((row) => `${row.sourceName}|${row.entityKey}|${row.field}|${JSON.stringify(row.value)}`)
    .sort();

describe('observations:rollback-scrape-run (#5735)', () => {
  it('restores the exact pre-run state and touches nothing outside the run', async () => {
    const before = await seedPriorState();
    const badRun = await writeBadRun();

    const result = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: true });

    expect(result).toMatchObject({
      applied: true,
      refusals: [],
      invalidatedRun: true,
      retiredRunObservations: 3,
      restoredObservations: 2,
    });
    const after = await dump();
    const outsideRun = after.filter((row) => row.scrapeRunId !== badRun);
    expect(outsideRun).toEqual(before);
    for (const row of after.filter((r) => r.scrapeRunId === badRun)) {
      expect(row.superseded).toBe(true);
      expect(row.rollback?.reason).toContain(NOTE);
    }
    expect((await ScrapeRun.findById(badRun).lean())?.invalidated).toBe(true);
  });

  it('retires every row of a run that wrote the same field twice', async () => {
    const before = await seedPriorState();
    const badRun = await startRun();
    await write(badRun, [['fixture-lab-a', 'name', 'Fixture Lab A First Rename']]);
    await write(badRun, [['fixture-lab-a', 'name', 'Fixture Lab A Second Rename']]);

    const plan = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: false });
    expect(plan).toMatchObject({ runObservations: 2, restorableObservations: 1, refusals: [] });

    const result = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: true });

    expect(result).toMatchObject({ applied: true, restoredObservations: 1 });
    const after = await dump();
    expect(after.filter((row) => row.scrapeRunId !== badRun)).toEqual(before);
    expect(after.filter((row) => row.scrapeRunId === badRun && !row.superseded)).toEqual([]);
  });

  it('changes nothing on a second apply', async () => {
    await seedPriorState();
    const badRun = await writeBadRun();
    await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: true });
    const afterFirst = await dump();

    const second = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: true });

    expect(second).toMatchObject({
      applied: true,
      refusals: [],
      alreadyInvalidated: true,
      invalidatedRun: false,
      retiredRunObservations: 0,
      restoredObservations: 0,
    });
    expect(await dump()).toEqual(afterFirst);
  });

  it('plans without writing on a dry run', async () => {
    await seedPriorState();
    const badRun = await writeBadRun();
    const before = await dump();

    const plan = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: false });

    expect(plan).toMatchObject({
      applied: false,
      runObservations: 3,
      liveRunObservations: 3,
      restorableObservations: 2,
      refusals: [],
    });
    expect(await dump()).toEqual(before);
    expect((await ScrapeRun.findById(badRun).lean())?.invalidated).toBe(false);
  });

  it('refuses once a later run of the same source has written', async () => {
    await seedPriorState();
    const badRun = await writeBadRun();
    const laterRun = await startRun();
    await write(laterRun, [['fixture-lab-c', 'websiteUrl', 'https://example.edu/lab-c-new']]);
    const before = await dump();
    const liveBefore = await liveValues();

    const result = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: true });

    expect(result.applied).toBe(false);
    expect(result.refusals).toContain('LATER_WRITES_TO_SOURCE');
    expect(await dump()).toEqual(before);
    expect(await liveValues()).toEqual(liveBefore);
  });

  it('refuses when an observation outside the run superseded one of its observations', async () => {
    await seedPriorState();
    const badRun = await writeBadRun();
    const badRow = await Observation.findOne({ scrapeRunId: badRun, entityKey: 'fixture-lab-d' });
    await Observation.updateOne(
      { _id: badRow!._id },
      { $set: { superseded: true, supersededBy: new mongoose.Types.ObjectId() } },
    );
    const before = await dump();

    const result = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: true });

    expect(result.refusals).toEqual(['RUN_SUPERSEDED_FROM_OUTSIDE']);
    expect(await dump()).toEqual(before);
  });

  it('refuses a run that was materialized', async () => {
    await seedPriorState();
    const badRun = await writeBadRun();
    await ScrapeRun.updateOne({ _id: badRun }, { $set: { entitiesUpdated: 4 } });
    const before = await dump();

    const result = await rollbackScrapeRun({ runId: badRun, note: NOTE, apply: true });

    expect(result.refusals).toEqual(['RUN_WAS_MATERIALIZED']);
    expect(await dump()).toEqual(before);
  });

  it('reports a missing run', async () => {
    const result = await rollbackScrapeRun({
      runId: String(new mongoose.Types.ObjectId()),
      note: NOTE,
      apply: true,
    });
    expect(result.refusals).toEqual(['RUN_NOT_FOUND']);
  });
});

describe('parseRollbackScrapeRunArgs', () => {
  const RUN = 'a'.repeat(24);

  it('requires exactly one run, a note, and a snapshot to apply', () => {
    expect(() => parseRollbackScrapeRunArgs([`--note=${NOTE}`])).toThrow(/exactly one run/);
    expect(() =>
      parseRollbackScrapeRunArgs([`--run=${RUN}`, `--run=${RUN}`, `--note=${NOTE}`]),
    ).toThrow(/exactly one run/);
    expect(() => parseRollbackScrapeRunArgs([`--run=${RUN}`])).toThrow(/--note is required/);
    expect(() => parseRollbackScrapeRunArgs([`--run=${RUN}`, `--note=${NOTE}`, '--apply'])).toThrow(
      /requires --snapshot/,
    );
    expect(() => parseRollbackScrapeRunArgs([`--run=${RUN}`, `--note=${NOTE}`, '--all'])).toThrow(
      /Unknown/,
    );
  });

  it('defaults to a dry run', () => {
    expect(parseRollbackScrapeRunArgs([`--run=${RUN}`, `--note=${NOTE}`])).toMatchObject({
      runId: RUN,
      apply: false,
      confirmed: false,
    });
  });
});
