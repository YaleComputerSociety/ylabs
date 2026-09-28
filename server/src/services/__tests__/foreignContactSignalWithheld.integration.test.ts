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

import { CONTACT_FIELDS_SIGNAL_DERIVATION_KEY } from '../../scrapers/rowKeyedContactEvidence';
import { getResearchGroupDetail } from '../researchGroupService';
import { planStudentVisibilityGate } from '../studentVisibilityGateService';

const SLUG = 'example-contact-survivor-lab';
const LOSER = 'ysm-example-contact-loser';
const CONTACT_EXCERPT = 'Official contact listed: Example Coordinator, Lab Manager.';
const INSTRUCTIONS_EXCERPT = 'Email the lab manager with a short note about your interests.';
const INDEX_URL = 'https://medicine.example.edu/labs/a-to-z/';

const seed = async (contactEvidenceKey: string) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Example Contact Survivor Lab',
    kind: 'lab',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    fullDescription:
      'The lab studies how example tissues repair after injury, combining imaging, genetics and computational modelling of cell behaviour.',
    websiteUrl: 'https://examplelab.example.edu/',
    sourceUrls: ['https://examplelab.example.edu/'],
  });
  await db.collection('research_entities').insertOne({
    _id: new mongoose.Types.ObjectId(),
    slug: LOSER,
    name: 'Example Contact Loser',
    archived: true,
    canonicalGroupId: entityId,
  });
  const evidenceId = new mongoose.Types.ObjectId();
  await db.collection('observations').insertOne({
    _id: evidenceId,
    entityType: 'researchEntity',
    entityKey: contactEvidenceKey,
    field: 'contactName',
    value: 'Example Coordinator',
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'ysm-atoz-index',
    sourceUrl: INDEX_URL,
    confidence: 0.9,
    observedAt: new Date('2026-09-01T00:00:00Z'),
    superseded: false,
  });
  await db.collection('signals').insertMany([
    {
      _id: new mongoose.Types.ObjectId(),
      researchEntityId: entityId,
      type: 'CONTACT_INSTRUCTIONS_EXIST',
      derivationKey: CONTACT_FIELDS_SIGNAL_DERIVATION_KEY,
      archived: false,
      confidence: 'HIGH',
      observedAt: new Date('2026-09-01T00:00:00Z'),
      source: { url: INDEX_URL, excerpt: CONTACT_EXCERPT, evidenceIds: [evidenceId] },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      researchEntityId: entityId,
      type: 'CONTACT_INSTRUCTIONS_EXIST',
      derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE',
      archived: false,
      confidence: 'HIGH',
      observedAt: new Date('2026-09-02T00:00:00Z'),
      source: {
        url: 'https://examplelab.example.edu/join/',
        excerpt: INSTRUCTIONS_EXCERPT,
        evidenceIds: [new mongoose.Types.ObjectId()],
      },
    },
  ]);
  return entityId;
};

describe('a contact signal whose evidence names another row is not served (#3609)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'signals', 'observations']) {
      await db.collection(name).deleteMany({});
    }
  });

  const servedExcerpts = async () =>
    ((await getResearchGroupDetail(SLUG))?.accessSignals ?? []).map(
      (signal: any) => signal.excerpt,
    );

  it.each([LOSER, 'ysm-example-unminted-key'])(
    'withholds the contact-field signal when its evidence is keyed to %s',
    async (evidenceKey) => {
      await seed(evidenceKey);

      expect(await servedExcerpts()).toEqual([INSTRUCTIONS_EXCERPT]);
    },
  );

  it('serves the contact-field signal when its evidence is keyed to the row', async () => {
    await seed(SLUG);

    expect((await servedExcerpts()).sort()).toEqual([CONTACT_EXCERPT, INSTRUCTIONS_EXCERPT].sort());
  });

  it('keeps the withheld signal stored, because it is history', async () => {
    const entityId = await seed(LOSER);
    await getResearchGroupDetail(SLUG);

    const stored = await mongoose.connection
      .db!.collection('signals')
      .countDocuments({ researchEntityId: entityId, archived: false });
    expect(stored).toBe(2);
  });

  it('does not count a foreign-keyed contact signal as a way in', async () => {
    const entityId = await seed(LOSER);
    const foreign = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: [String(entityId)],
    });

    await mongoose.connection.db!.collection('research_entities').deleteMany({});
    await mongoose.connection.db!.collection('signals').deleteMany({});
    await mongoose.connection.db!.collection('observations').deleteMany({});
    const ownId = await seed(SLUG);
    const own = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: [String(ownId)],
    });

    expect(foreign[0]?.gateInput?.accessSignalCount).toBe(1);
    expect(own[0]?.gateInput?.accessSignalCount).toBe(2);
  });
});
