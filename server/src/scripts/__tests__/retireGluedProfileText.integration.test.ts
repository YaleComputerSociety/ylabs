import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { runGluedProfileTextRetirement } from '../retireGluedProfileText';

const PAGE = 'https://eeb.example.edu/people/faculty/wren-halloway/';
const LOCKED_PAGE = 'https://medicine.example.edu/profile/sorrel-ambry/';
const GLUED = 'biologywren.halloway1@yale.edu';
const CLEAN = 'wren.halloway1@yale.edu';
const PHANTOM_KEY = 'netid:biologywren.halloway1';

const FIXED_PAGE_HTML = `<html><body><main>
  <h1>Wren Halloway</h1>
  <div class="profile-title">Senior Lecturer</div>
  <div class="contact"><div>Ecology and Evolutionary Biology</div><div>${CLEAN}</div></div>
</main></body></html>`;

const seed = async (
  entityKey: string,
  field: string,
  value: unknown,
  overrides: Record<string, unknown> = {},
) =>
  Observation.create({
    entityType: 'user',
    entityKey,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'official-profile-pi-backfill',
    sourceUrl: PAGE,
    confidence: 0.95,
    observedAt: new Date('2026-10-23T00:00:00Z'),
    superseded: false,
    ...overrides,
  });

const seedCorpus = async () => {
  await seed('netid:wh77', 'email', GLUED);
  await seed('netid:wh77', 'email', CLEAN, { sourceName: 'yale-directory' });
  await seed('netid:wh77', 'title', 'Senior LecturerEcology and Evolutionary BiologyAddress');
  await seed(PHANTOM_KEY, 'email', GLUED);
  await seed(PHANTOM_KEY, 'fname', 'Wren');
  await seed(PHANTOM_KEY, 'lname', 'Halloway');
  await seed(PHANTOM_KEY, 'netid', 'biologywren.halloway1');
  await seed(PHANTOM_KEY, 'profileUrls', { official: PAGE });
  await seed('wren-halloway-lab', 'inferredPiUserKey', 'biologywren.halloway1', {
    entityType: 'researchEntity',
  });
  await seed('netid:sa31', 'title', 'Professor of MedicineSection Chief', {
    sourceUrl: LOCKED_PAGE,
  });
  await seed('netid:cl05', 'title', 'Professor of Geology');
};

const liveIds = async () =>
  (
    await Observation.find({ superseded: { $ne: true } })
      .select('_id')
      .lean()
  )
    .map((row) => String(row._id))
    .sort();

const run = (dryRun: boolean, fetchHtml: (url: string) => Promise<string>) =>
  runGluedProfileTextRetirement({
    dryRun,
    skipHosts: ['medicine.example.edu'],
    pauseMs: 0,
    fetchHtml,
  });

describe('observations:retire-glued-profile-text (#5720)', () => {
  let replSet: MongoMemoryReplSet;
  const requested: string[] = [];
  const fixedPage = async (url: string) => {
    requested.push(url);
    return FIXED_PAGE_HTML;
  };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    requested.length = 0;
    await mongoose.connection.db?.collection('observations').deleteMany({});
    await seedCorpus();
  });

  it('writes nothing in a dry run', async () => {
    const before = await liveIds();
    const result = await run(true, fixedPage);
    expect(result.retiredObservations).toBe(0);
    expect(result.counts).toMatchObject({
      emailRetired: 2,
      titleRetired: 1,
      phantomSubjectObservationsRetired: 6,
      distinctObservationsToRetire: 8,
      deferredTitle: 1,
    });
    expect(await liveIds()).toEqual(before);
  });

  it('retires exactly the glued observations, and a second apply is a no-op', async () => {
    const first = await run(false, fixedPage);
    expect(first.retiredObservations).toBe(8);
    const live = await Observation.find({ superseded: { $ne: true } }).lean();
    expect(live.map((row) => `${row.entityKey}|${row.field}|${String(row.value)}`).sort()).toEqual(
      [
        'netid:cl05|title|Professor of Geology',
        'netid:sa31|title|Professor of MedicineSection Chief',
        `netid:wh77|email|${CLEAN}`,
      ].sort(),
    );
    const retired = await Observation.find({ superseded: true }).lean();
    expect(retired.every((row) => /#5720/.test(String(row.rollback?.reason)))).toBe(true);

    const second = await run(false, fixedPage);
    expect(second.retiredObservations).toBe(0);
    expect(second.counts.distinctObservationsToRetire).toBe(0);
  });

  it('never requests a host-locked page', async () => {
    await run(true, fixedPage);
    expect(requested).toEqual([PAGE]);
  });

  it('retires nothing for a page whose fetch failed', async () => {
    const before = await liveIds();
    const result = await run(false, async () => {
      throw new Error('ECONNRESET');
    });
    expect(result.counts.pagesFailed).toBe(1);
    expect(result.retiredObservations).toBe(0);
    expect(await liveIds()).toEqual(before);
  });
});
