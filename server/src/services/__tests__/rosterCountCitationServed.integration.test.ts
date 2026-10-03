import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail } from '../researchGroupService';

const SLUG = 'example-roster-count-lab';
const WEBSITE = 'https://examplelab.example.org/';
const ROSTER = `${WEBSITE}people`;
const LANE = 'lab-microsite-undergrad-llm';

const seed = async ({ countPage = ROSTER }: { countPage?: string } = {}) => {
  const db = mongoose.connection.db!;
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Example Roster Count Lab',
    kind: 'lab',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    fullDescription:
      'The lab studies how example tissues repair after injury, combining imaging, genetics and computational modelling of cell behaviour.',
    websiteUrl: WEBSITE,
    sourceUrls: [WEBSITE],
  });
  const observedAt = new Date('2026-10-01T00:00:00Z');
  const observation = (field: string, value: unknown, sourceUrl: string) => ({
    _id: new mongoose.Types.ObjectId(),
    entityType: 'researchEntity',
    entityKey: SLUG,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: LANE,
    sourceUrl,
    confidence: 0.5,
    observedAt,
    superseded: false,
  });
  const count = observation('currentUndergradCount', 2, countPage);
  const alumni = observation(
    'pastUndergradAdvisees',
    [{ programName: 'Lab roster alumni', count: 3 }],
    ROSTER,
  );
  const access = observation(
    'undergradAccessEvidence',
    { openToUndergrads: 'yes', evidenceQuote: 'Undergraduates are welcome to apply.' },
    WEBSITE,
  );
  const join = observation('joinPageUrl', ROSTER, ROSTER);
  await db.collection('observations').insertMany([count, alumni, access, join]);
  const signal = (type: string, derivationKey: string, url: string, excerpt: string, id: any) => ({
    _id: new mongoose.Types.ObjectId(),
    researchEntityId: entityId,
    type,
    derivationKey,
    archived: false,
    confidence: 'MEDIUM',
    observedAt,
    source: { url, excerpt, evidenceIds: [id] },
  });
  await db
    .collection('signals')
    .insertMany([
      signal(
        'CURRENT_UNDERGRADS',
        'signal:CURRENT_UNDERGRADS',
        countPage,
        '2 current undergraduate(s) listed',
        count._id,
      ),
      signal('PAST_UNDERGRADS', 'signal:PAST_UNDERGRADS', ROSTER, '', alumni._id),
      signal(
        'APPLICATION_FORM_EXISTS',
        'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
        ROSTER,
        'A join, opportunities, or application page was found.',
        join._id,
      ),
    ]);
};

describe("an undergraduate count is served with the lab's roster page (#4430)", () => {
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
    for (const name of ['research_entities', 'signals', 'observations']) {
      await mongoose.connection.db!.collection(name).deleteMany({});
    }
  });

  const served = async (type: string) =>
    ((await getResearchGroupDetail(SLUG))?.accessSignals ?? []).find(
      (signal: any) => signal.signalType === type,
    );

  it('links the current and past counts to the roster page they were read from', async () => {
    await seed();

    expect((await served('CURRENT_UNDERGRADS'))?.sourceUrl).toBe(ROSTER);
    expect((await served('PAST_UNDERGRADS'))?.sourceUrl).toBe(ROSTER);
  });

  it('still withholds a roster page as the link of a join-page claim', async () => {
    await seed();

    expect((await served('APPLICATION_FORM_EXISTS'))?.sourceUrl).toBeUndefined();
  });

  it('does not serve a count read from a join page', async () => {
    await seed({ countPage: `${WEBSITE}join-us` });

    expect(await served('CURRENT_UNDERGRADS')).toBeUndefined();
    expect((await served('PAST_UNDERGRADS'))?.sourceUrl).toBe(ROSTER);
  });
});
