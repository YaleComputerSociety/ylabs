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

const SLUG = 'invisible-format-fixture-lab';
const SOURCE_URL = 'https://example.edu/lab/invisible-format-fixture/';

const INVISIBLE_FORMAT_CHARACTERS = /[\u00ad\u200b\u2060\ufeff]/;

const DIRTY_FULL =
  'The lab studies neu\u00adral cir\u00adcuits underlying memory formation, combining two-photon imaging in behaving mice, electro\u200bphysiology, and computational modelling to map how hippo\u00adcampal ensembles encode and retrieve episodes across learning.';
const CLEAN_FULL =
  'The lab studies neural circuits underlying memory formation, combining two-photon imaging in behaving mice, electrophysiology, and computational modelling to map how hippocampal ensembles encode and retrieve episodes across learning.';
const DIRTY_CARD =
  'Studies neu\u00adral cir\u00adcuits underlying memory using two-photon imaging and computational modelling.';
const DIRTY_AREAS = ['Neu\u200broscience', 'Com\u00adputational Biology'];
const CLEAN_AREAS = ['Neuroscience', 'Computational Biology'];

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

describe('scraped invisible format characters never reach the student detail surface (#2874)', () => {
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
      name: 'Memory Circuits Laboratory',
      kind: 'lab',
      entityType: 'LAB',
      departments: ['Psychology'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      websiteUrl: SOURCE_URL,
      sourceUrls: [SOURCE_URL],
      archived: false,
    });
  });

  it('serves the description, card, and chips as readable text a keyword search can still match', async () => {
    expect(INVISIBLE_FORMAT_CHARACTERS.test(DIRTY_FULL)).toBe(true);
    expect(/neural circuits/i.test(DIRTY_FULL)).toBe(false);

    await scrapeRun('fullDescription', DIRTY_FULL);
    await scrapeRun('researchAreas', DIRTY_AREAS);
    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { synthesizeCardDescription: async () => DIRTY_CARD },
    );

    const detail = await getResearchGroupDetail(SLUG);
    const served = detail?.researchEntity as Record<string, unknown> | undefined;

    expect(served?.fullDescription).toBe(CLEAN_FULL);
    expect(INVISIBLE_FORMAT_CHARACTERS.test(String(served?.shortDescription))).toBe(false);
    expect(served?.researchAreas).toEqual(CLEAN_AREAS);
    expect(/neural circuits/i.test(String(served?.fullDescription))).toBe(true);
    expect(INVISIBLE_FORMAT_CHARACTERS.test(JSON.stringify(detail))).toBe(false);
  }, 30000);

  it('stores the observation itself clean, so a rescrape or reindex cannot reintroduce it', async () => {
    await scrapeRun('fullDescription', DIRTY_FULL);

    const stored = await Observation.find({ field: 'fullDescription', superseded: false })
      .select('value')
      .lean<Array<{ value: string }>>();

    expect(stored.map((row) => row.value)).toEqual([CLEAN_FULL]);
  }, 30000);
});
