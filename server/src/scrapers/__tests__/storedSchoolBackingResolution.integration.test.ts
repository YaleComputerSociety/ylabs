import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { loadResolvedSchoolObservationsByRow } from '../storedSchoolBacking';

const STATED = 'Fixture School of Science';

describe('the school readings the engine resolves for a row (#6096)', () => {
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
    await Observation.collection.deleteMany({});
    await ResearchEntity.collection.deleteMany({});
    await ScrapeRun.collection.deleteMany({});
    resetInvalidatedScrapeRunCache();
  });

  const survivorId = new mongoose.Types.ObjectId();
  const shellId = new mongoose.Types.ObjectId();

  const row = (fields: Record<string, unknown>) =>
    ResearchEntity.collection.insertOne({
      kind: 'lab',
      entityType: 'LAB',
      name: String(fields.slug),
      ...fields,
    });

  const reading = (fields: Record<string, unknown>) =>
    Observation.collection.insertOne({
      entityType: 'researchEntity',
      field: 'school',
      value: STATED,
      sourceName: 'fixture-lane',
      sourceUrl: 'https://fixture-lab.example.edu/about',
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      entityId: null,
      ...fields,
    });

  const resolvedReadingsFor = async () => {
    const byRow = await loadResolvedSchoolObservationsByRow([
      { _id: survivorId, slug: 'fixture-survivor-lab' },
    ]);
    const readings = byRow.get(String(survivorId)) ?? { own: [], mergedIn: [] };
    return {
      own: readings.own.map((observation) => observation.sourceName).sort(),
      mergedIn: readings.mergedIn.map((observation) => observation.sourceName).sort(),
    };
  };
  const resolvedValuesFor = async () => (await resolvedReadingsFor()).own;

  beforeEach(async () => {
    await row({ _id: survivorId, slug: 'fixture-survivor-lab', archived: false });
    await row({
      _id: shellId,
      slug: 'fixture-merged-shell',
      archived: true,
      canonicalGroupId: survivorId,
    });
  });

  it('reads a superseded reading on the row slug and drops a rolled-back one', async () => {
    await reading({
      entityKey: 'fixture-survivor-lab',
      superseded: true,
      sourceName: 'superseded',
    });
    await reading({
      entityKey: 'fixture-survivor-lab',
      sourceName: 'rolled-back',
      rollback: { rolledBackAt: new Date() },
    });
    expect(await resolvedValuesFor()).toEqual(['superseded']);
  });

  it('keeps a merged-in row reading apart, because the survivor owns its school', async () => {
    await reading({ entityKey: 'fixture-merged-shell', sourceName: 'merged-in-key' });
    await reading({
      entityKey: 'fixture-unrelated-key',
      entityId: survivorId,
      sourceName: 'entity-id-anchored',
    });
    expect(await resolvedReadingsFor()).toEqual({
      own: ['entity-id-anchored'],
      mergedIn: ['merged-in-key'],
    });
  });

  it('drops a reading from an invalidated scrape run', async () => {
    const runId = new mongoose.Types.ObjectId();
    await ScrapeRun.collection.insertOne({ _id: runId, invalidated: true });
    await reading({
      entityKey: 'fixture-survivor-lab',
      sourceName: 'invalidated-run',
      scrapeRunId: runId,
    });
    await reading({ entityKey: 'fixture-survivor-lab', sourceName: 'kept-run' });
    expect(await resolvedValuesFor()).toEqual(['kept-run']);
  });

  it('reads an old key the engine adopts into the row by rename, and no unrelated key', async () => {
    await Observation.collection.insertOne({
      entityType: 'researchEntity',
      entityKey: 'fixture-old-lab-name',
      entityId: survivorId,
      field: 'name',
      value: 'Fixture Old Lab Name',
      sourceName: 'reslug',
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: true,
    });
    await reading({ entityKey: 'fixture-old-lab-name', sourceName: 'renamed-key' });
    await reading({ entityKey: 'fixture-other-lab', sourceName: 'unrelated-key' });
    expect(await resolvedValuesFor()).toEqual(['renamed-key']);
  });

  it('drops a reading the materializer ignores, such as one read off a course page', async () => {
    await reading({
      entityKey: 'fixture-survivor-lab',
      sourceName: 'course-page',
      sourceUrl: 'https://fixture-college.example.edu/courses/fixture-101',
    });
    expect(await resolvedValuesFor()).toEqual([]);
  });
});
