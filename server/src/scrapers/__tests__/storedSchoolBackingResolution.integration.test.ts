import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
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

  const resolvedValuesFor = async () => {
    const byRow = await loadResolvedSchoolObservationsByRow([
      { _id: survivorId, slug: 'fixture-survivor-lab' },
    ]);
    return (byRow.get(String(survivorId)) ?? []).map((observation) => observation.sourceName);
  };

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

  it('reads a merged-in row key and an entityId-anchored reading under a foreign key', async () => {
    await reading({ entityKey: 'fixture-merged-shell', sourceName: 'merged-in-key' });
    await reading({
      entityKey: 'fixture-unrelated-key',
      entityId: survivorId,
      sourceName: 'entity-id-anchored',
    });
    expect((await resolvedValuesFor()).sort()).toEqual(['entity-id-anchored', 'merged-in-key']);
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
