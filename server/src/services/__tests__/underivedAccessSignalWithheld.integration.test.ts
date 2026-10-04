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
const PAST_EXCERPT = 'Two undergraduate alumni are listed on the lab roster.';

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
        'PAST_UNDERGRADS',
        'signal:PAST_UNDERGRADS',
        PAST_EXCERPT,
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

    expect(await servedExcerpts()).toEqual([COUNT_EXCERPT, JOIN_EXCERPT, PAST_EXCERPT].sort());
  });

  it('serves signals whose evidence sits on a row merged into this one', async () => {
    await seed({ evidenceKey: LOSER });

    expect(await servedExcerpts()).toEqual([COUNT_EXCERPT, JOIN_EXCERPT, PAST_EXCERPT].sort());
  });

  it('withholds the current-undergraduate signal once a later read counts zero', async () => {
    await seed({ undergradCount: 0 });

    expect(await servedExcerpts()).toEqual([JOIN_EXCERPT, PAST_EXCERPT].sort());
  });

  it('withholds a current-undergraduate signal held only by the retired cache backfill', async () => {
    await seed({ countSourceName: 'research-entity-cache-backfill' });

    expect(await servedExcerpts()).toEqual([JOIN_EXCERPT, PAST_EXCERPT].sort());
  });

  it('withholds the join-page signal when its only join page is a study-recruitment page', async () => {
    await seed({ joinPageUrl: `${WEBSITE}participate/` });

    expect(await servedExcerpts()).toEqual([COUNT_EXCERPT, PAST_EXCERPT].sort());
  });

  it('withholds the join-page signal once its evidence is superseded', async () => {
    await seed();
    await mongoose.connection
      .db!.collection('observations')
      .updateMany({ field: 'joinPageUrl' }, { $set: { superseded: true } });

    expect(await servedExcerpts()).toEqual([COUNT_EXCERPT, PAST_EXCERPT].sort());
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

describe("a department's own undergraduate research page on its faculty rows (#4430)", () => {
  let replSet: MongoMemoryReplSet;
  const FACULTY_SLUG = 'example-psychology-categories-lab';
  const PROGRAMME = 'https://psychology.yale.edu/undergraduate/research-opportunities';
  const TRAINING =
    'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/';

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

  const seedFaculty = async (departments: string[], joinPageUrl: string) => {
    const db = mongoose.connection.db!;
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: FACULTY_SLUG,
      name: 'Example Access Survivor Lab',
      kind: 'lab',
      entityType: 'LAB',
      schemaVersion: 1,
      archived: false,
      departments,
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      fullDescription:
        'The lab studies how example tissues repair after injury, combining imaging, genetics and computational modelling of cell behaviour.',
      websiteUrl: WEBSITE,
      sourceUrls: [WEBSITE],
    });
    const at = new Date('2026-09-01T00:00:00Z');
    const base = {
      entityType: 'researchEntity',
      entityKey: FACULTY_SLUG,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-undergrad-llm',
      sourceUrl: joinPageUrl,
      confidence: 0.5,
      observedAt: at,
      superseded: false,
    };
    const joinId = new mongoose.Types.ObjectId();
    await db.collection('observations').insertMany([
      {
        ...base,
        _id: new mongoose.Types.ObjectId(),
        field: 'undergradAccessEvidence',
        value: { openToUndergrads: 'yes', evidenceQuote: 'Undergraduates join research labs.' },
      },
      { ...base, _id: joinId, field: 'joinPageUrl', value: joinPageUrl },
    ]);
    await db.collection('signals').insertOne({
      researchEntityId: entityId,
      type: 'APPLICATION_FORM_EXISTS',
      derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
      archived: false,
      confidence: 'MEDIUM',
      observedAt: at,
      source: { url: joinPageUrl, excerpt: JOIN_EXCERPT, evidenceIds: [joinId] },
    });
  };

  const servedJoin = async () => {
    const detail = await getResearchGroupDetail(FACULTY_SLUG);
    expect(detail).not.toBeNull();
    return (detail?.accessSignals ?? []).find(
      (signal: any) => signal.signalType === 'APPLICATION_FORM_EXISTS',
    );
  };

  it("serves the department's page, with its link, on that department's person row", async () => {
    await seedFaculty(['Psychology'], PROGRAMME);

    expect((await servedJoin())?.sourceUrl).toBe(PROGRAMME);
  });

  it('withholds it on a person row of another department', async () => {
    await seedFaculty(['Philosophy'], PROGRAMME);

    expect(await servedJoin()).toBeUndefined();
  });

  it("withholds a center's training page on a person row", async () => {
    await seedFaculty(['Internal Medicine'], TRAINING);

    expect(await servedJoin()).toBeUndefined();
  });
});
