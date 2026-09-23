import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => 0),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: meiliMocks.syncEntities,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { appendObservations } from '../observationStore';
import { materializeEntity } from '../entityMaterializer';
import { getResearchGroupDetail } from '../../services/researchGroupService';

const SLUG = 'glued-boundary-fixture-lab';
const SOURCE_URL = 'https://example.edu/lab/glued-boundary-fixture/';

const GLUED_BOUNDARY = /([A-Za-z]{2,})\.([A-Z][a-z])/;

const GLUED_FULL =
  'These tumours are the most common solid cancers of childhood and account for 10% of all cancers in adults.To prevent the production of harmful autoantibodies, the group maps how developing B cells are silenced, using mouse models and single-cell sequencing.';
const SEPARATED_FULL =
  'These tumours are the most common solid cancers of childhood and account for 10% of all cancers in adults. To prevent the production of harmful autoantibodies, the group maps how developing B cells are silenced, using mouse models and single-cell sequencing.';

const scrapeRun = (field: string, value: unknown) =>
  appendObservations(
    [
      {
        entityType: 'researchEntity',
        entityKey: SLUG,
        field,
        value,
        sourceUrl: SOURCE_URL,
        observedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    ],
    {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName: 'lab-microsite-description',
      sourceWeight: 0.9,
      dryRun: false,
    },
  );

describe('a boundary the source separated never reaches the student detail surface glued (#3096)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Tolerance and Tumour Immunology Laboratory',
      kind: 'lab',
      entityType: 'LAB',
      departments: ['Immunobiology'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      websiteUrl: SOURCE_URL,
      sourceUrls: [SOURCE_URL],
      archived: false,
    });
  });

  it('serves the body with the separator the source had', async () => {
    expect(GLUED_BOUNDARY.test(GLUED_FULL)).toBe(true);

    await scrapeRun('fullDescription', GLUED_FULL);
    await materializeEntity('researchEntity', { entityKey: SLUG });

    const detail = await getResearchGroupDetail(SLUG);
    const served = detail?.researchEntity as Record<string, unknown> | undefined;

    expect(served?.fullDescription).toBe(SEPARATED_FULL);
    expect(GLUED_BOUNDARY.test(String(served?.fullDescription))).toBe(false);
  }, 30000);

  it('stores the observation itself separated, so a rescrape or reindex cannot reintroduce it', async () => {
    await scrapeRun('fullDescription', GLUED_FULL);

    const stored = await Observation.find({ field: 'fullDescription', superseded: false })
      .select('value')
      .lean<Array<{ value: string }>>();

    expect(stored.map((row) => row.value)).toEqual([SEPARATED_FULL]);
  }, 30000);
});
