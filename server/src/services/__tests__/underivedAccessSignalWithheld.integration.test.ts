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
import { planStudentVisibilityGate } from '../studentVisibilityGateService';

const SLUG = 'example-access-survivor-lab';
const LOSER = 'example-access-merged-loser';
const WEBSITE = 'https://examplelab.example.edu/';
const JOIN_EXCERPT = 'A join, opportunities, or application page was found.';
const COUNT_EXCERPT = '2 current undergraduate(s) listed';
const INSTRUCTIONS_EXCERPT = 'Email the lab manager with a short note about your interests.';

interface SeedOptions {
  evidenceKey?: string;
  joinPageUrl?: string;
  undergradCount?: number;
  countSourceName?: string;
}

const observation = (entityKey: string, field: string, value: unknown, sourceName: string) => ({
  _id: new mongoose.Types.ObjectId(),
  entityType: 'researchEntity',
  entityKey,
  field,
  value,
  sourceId: new mongoose.Types.ObjectId(),
  sourceName,
  sourceUrl: WEBSITE,
  confidence: 0.5,
  observedAt: new Date('2026-09-01T00:00:00Z'),
  superseded: false,
});

const seed = async ({
  evidenceKey = SLUG,
  joinPageUrl = `${WEBSITE}join`,
  undergradCount = 2,
  countSourceName = 'lab-microsite-undergrad-llm',
}: SeedOptions = {}) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Example Access Survivor Lab',
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
  await db.collection('research_entities').insertOne({
    _id: new mongoose.Types.ObjectId(),
    slug: LOSER,
    name: 'Example Access Merged Loser',
    archived: true,
    canonicalGroupId: entityId,
  });
  const access = observation(
    evidenceKey,
    'undergradAccessEvidence',
    { openToUndergrads: 'yes', evidenceQuote: 'Undergraduates are welcome to apply.' },
    'lab-microsite-undergrad-llm',
  );
  const join = observation(evidenceKey, 'joinPageUrl', joinPageUrl, 'lab-microsite-undergrad-llm');
  const count = observation(evidenceKey, 'currentUndergradCount', undergradCount, countSourceName);
  await db.collection('observations').insertMany([access, join, count]);
  const signal = (type: string, derivationKey: string, excerpt: string, evidenceId: unknown) => ({
    _id: new mongoose.Types.ObjectId(),
    researchEntityId: entityId,
    type,
    derivationKey,
    archived: false,
    confidence: 'MEDIUM',
    observedAt: new Date('2026-09-01T00:00:00Z'),
    source: { url: WEBSITE, excerpt, evidenceIds: [evidenceId] },
  });
  await db
    .collection('signals')
    .insertMany([
      signal(
        'APPLICATION_FORM_EXISTS',
        'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
        JOIN_EXCERPT,
        join._id,
      ),
      signal('CURRENT_UNDERGRADS', 'signal:CURRENT_UNDERGRADS', COUNT_EXCERPT, count._id),
      signal(
        'CONTACT_INSTRUCTIONS_EXIST',
        'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE',
        INSTRUCTIONS_EXCERPT,
        new mongoose.Types.ObjectId(),
      ),
    ]);
  return entityId;
};

describe('an access signal the row evidence no longer derives is not served (#4430)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'signals', 'observations']) {
      await db.collection(name).deleteMany({});
    }
  });

  const servedExcerpts = async () =>
    ((await getResearchGroupDetail(SLUG))?.accessSignals ?? [])
      .map((signal: any) => signal.excerpt)
      .sort();

  it('serves both signals while the row evidence still derives them', async () => {
    await seed();

    expect(await servedExcerpts()).toEqual(
      [COUNT_EXCERPT, JOIN_EXCERPT, INSTRUCTIONS_EXCERPT].sort(),
    );
  });

  it('serves signals whose evidence sits on a row merged into this one', async () => {
    await seed({ evidenceKey: LOSER });

    expect(await servedExcerpts()).toEqual(
      [COUNT_EXCERPT, JOIN_EXCERPT, INSTRUCTIONS_EXCERPT].sort(),
    );
  });

  it('withholds the current-undergraduate signal once a later read counts zero', async () => {
    await seed({ undergradCount: 0 });

    expect(await servedExcerpts()).toEqual([JOIN_EXCERPT, INSTRUCTIONS_EXCERPT].sort());
  });

  it('withholds a current-undergraduate signal held only by the retired cache backfill', async () => {
    await seed({ countSourceName: 'research-entity-cache-backfill' });

    expect(await servedExcerpts()).toEqual([JOIN_EXCERPT, INSTRUCTIONS_EXCERPT].sort());
  });

  it('withholds the join-page signal when its only join page is a study-recruitment page', async () => {
    await seed({ joinPageUrl: `${WEBSITE}participate/` });

    expect(await servedExcerpts()).toEqual([COUNT_EXCERPT, INSTRUCTIONS_EXCERPT].sort());
  });

  it('withholds the join-page signal once its evidence is superseded', async () => {
    await seed();
    await mongoose.connection
      .db!.collection('observations')
      .updateMany({ field: 'joinPageUrl' }, { $set: { superseded: true } });

    expect(await servedExcerpts()).toEqual([COUNT_EXCERPT, INSTRUCTIONS_EXCERPT].sort());
  });

  it('keeps the withheld signals stored, because they are history', async () => {
    const entityId = await seed({ undergradCount: 0, joinPageUrl: `${WEBSITE}participate/` });
    await getResearchGroupDetail(SLUG);

    const stored = await mongoose.connection
      .db!.collection('signals')
      .countDocuments({ researchEntityId: entityId, archived: false });
    expect(stored).toBe(3);
  });

  it('does not count an underived access signal as a way in', async () => {
    const withdrawnId = await seed({ undergradCount: 0, joinPageUrl: `${WEBSITE}participate/` });
    const withdrawn = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: [String(withdrawnId)],
    });

    for (const name of ['research_entities', 'signals', 'observations']) {
      await mongoose.connection.db!.collection(name).deleteMany({});
    }
    const derivedId = await seed();
    const derived = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: [String(derivedId)],
    });

    expect(withdrawn[0]?.gateInput?.accessSignalCount).toBe(1);
    expect(derived[0]?.gateInput?.accessSignalCount).toBe(3);
  });
});
