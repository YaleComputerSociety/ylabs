import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const SLUG = 'synthetic-topic-fixture';
const DIRECTOR_PROFILE_URL = 'https://medicine.yale.edu/profile/marlow-riverstone/';
const DIRECTOR_TOPICS = ['Neoplasms', 'Biliary Tract'];
const ROW_OWN_TOPICS = ['Tumor Immunology'];

describe('materializeEntity keeps a person profile topic list off an organization row (#4032)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedRow = async (entityType: string, kind: string) =>
    ResearchEntity.create({
      slug: SLUG,
      name: 'Riverstone Synthetic Center',
      kind,
      entityType,
      studentVisibilityTier: 'operator_review',
      archived: false,
      researchAreas: DIRECTOR_TOPICS,
    });

  const creditStoredTopicsTo = async (observation: { _id: unknown; sourceId?: unknown }) =>
    ResearchEntity.collection.updateOne(
      { slug: SLUG },
      {
        $set: {
          'fieldProvenance.researchAreas': {
            sourceId: observation.sourceId,
            sourceName: 'ysm-mesh-keyword',
            sourceUrl: DIRECTOR_PROFILE_URL,
            observationId: observation._id,
            confidence: 0.7,
          },
        },
      },
    );

  const seedTopics = async (
    entityId: mongoose.Types.ObjectId,
    sourceName: string,
    value: string[],
    sourceUrl: string,
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityId: String(entityId),
      entityKey: SLUG,
      field: 'researchAreas',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence: 0.7,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      superseded: false,
    });

  const storedTopics = async () =>
    ((await ResearchEntity.findOne({ slug: SLUG }).lean()) as { researchAreas?: string[] } | null)
      ?.researchAreas ?? [];

  it.each([
    ['CENTER', 'center'],
    ['INITIATIVE', 'initiative'],
    ['CORE_FACILITY', 'core_facility'],
  ])('drops the director profile topics from a %s row', async (entityType, kind) => {
    const row = await seedRow(entityType, kind);
    await creditStoredTopicsTo(
      await seedTopics(row._id, 'ysm-mesh-keyword', DIRECTOR_TOPICS, DIRECTOR_PROFILE_URL),
    );
    await seedTopics(row._id, 'ysm-faculty-directory', DIRECTOR_TOPICS, DIRECTOR_PROFILE_URL);

    await materializeEntity('researchEntity', { entityId: String(row._id), entityKey: SLUG }, {});

    const topics = await storedTopics();
    for (const topic of DIRECTOR_TOPICS) expect(topics).not.toContain(topic);
  });

  it("lets the organization row's own evidence supply its topics", async () => {
    const row = await seedRow('CENTER', 'center');
    await creditStoredTopicsTo(
      await seedTopics(row._id, 'ysm-mesh-keyword', DIRECTOR_TOPICS, DIRECTOR_PROFILE_URL),
    );
    await seedTopics(
      row._id,
      'lab-microsite-description-llm',
      ROW_OWN_TOPICS,
      'https://riverstone-center.example.edu/',
    );

    await materializeEntity('researchEntity', { entityId: String(row._id), entityKey: SLUG }, {});

    expect(await storedTopics()).toEqual(ROW_OWN_TOPICS);
  });

  it("keeps the profile topics on a person's own lab row", async () => {
    const row = await seedRow('LAB', 'lab');
    await creditStoredTopicsTo(
      await seedTopics(row._id, 'ysm-mesh-keyword', DIRECTOR_TOPICS, DIRECTOR_PROFILE_URL),
    );

    await materializeEntity('researchEntity', { entityId: String(row._id), entityKey: SLUG }, {});

    expect(await storedTopics()).toEqual(DIRECTOR_TOPICS);
  });
});
