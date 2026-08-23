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

const A_TO_Z_INDEX_URL = 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/';
const LAB_MICROSITE_URL = 'https://medicine.yale.edu/lab/steele/';
const OFFICIAL_PROFILE_URL = 'https://medicine.yale.edu/profile/vaughn-steele/';

describe('materializeEntity surfaces the lead official profile as a sourceUrl (#613)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (overrides: Record<string, unknown> = {}) => {
    return ResearchEntity.create({
      slug: 'ysm-steele-fixture',
      name: 'Steele Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
      websiteUrl: LAB_MICROSITE_URL,
      sourceUrls: [A_TO_Z_INDEX_URL, LAB_MICROSITE_URL],
      ...overrides,
    });
  };

  const seedObservation = async (
    field: string,
    value: unknown,
    sourceUrl: string,
    confidence: number,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'ysm-steele-fixture',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-a-to-z-index',
      sourceUrl,
      confidence,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('promotes the profile cited to identify the lead into sourceUrls while websiteUrl stays the lab page', async () => {
    await seedEntity();
    await seedObservation('websiteUrl', LAB_MICROSITE_URL, A_TO_Z_INDEX_URL, 0.9);
    await seedObservation('inferredPiUserKey', 'vaughn-steele', OFFICIAL_PROFILE_URL, 0.86);

    const result = await materializeEntity(
      'researchEntity',
      { entityKey: 'ysm-steele-fixture' },
      {},
    );

    expect(result.skipped).toBeUndefined();

    const persisted = await ResearchEntity.findOne({ slug: 'ysm-steele-fixture' }).lean();
    const sourceUrls = (persisted?.sourceUrls ?? []) as string[];

    expect(sourceUrls).toContain(OFFICIAL_PROFILE_URL);
    expect(sourceUrls).toContain(LAB_MICROSITE_URL);
    expect(persisted?.websiteUrl).toBe(LAB_MICROSITE_URL);
    expect(persisted?.websiteUrl).not.toBe(OFFICIAL_PROFILE_URL);
  });

  it('does not duplicate the profile when it is already a sourceUrl', async () => {
    await seedEntity({ sourceUrls: [A_TO_Z_INDEX_URL, LAB_MICROSITE_URL, OFFICIAL_PROFILE_URL] });
    await seedObservation('websiteUrl', LAB_MICROSITE_URL, A_TO_Z_INDEX_URL, 0.9);
    await seedObservation('inferredPiUserKey', 'vaughn-steele', OFFICIAL_PROFILE_URL, 0.86);

    await materializeEntity('researchEntity', { entityKey: 'ysm-steele-fixture' }, {});

    const persisted = await ResearchEntity.findOne({ slug: 'ysm-steele-fixture' }).lean();
    const sourceUrls = (persisted?.sourceUrls ?? []) as string[];

    expect(sourceUrls.filter((url) => url === OFFICIAL_PROFILE_URL)).toHaveLength(1);
  });

  it('does not promote the profile when sourceUrls is manually locked', async () => {
    await seedEntity({ manuallyLockedFields: ['sourceUrls'] });
    await seedObservation('websiteUrl', LAB_MICROSITE_URL, A_TO_Z_INDEX_URL, 0.9);
    await seedObservation('inferredPiUserKey', 'vaughn-steele', OFFICIAL_PROFILE_URL, 0.86);

    await materializeEntity('researchEntity', { entityKey: 'ysm-steele-fixture' }, {});

    const persisted = await ResearchEntity.findOne({ slug: 'ysm-steele-fixture' }).lean();
    const sourceUrls = (persisted?.sourceUrls ?? []) as string[];

    expect(sourceUrls).not.toContain(OFFICIAL_PROFILE_URL);
  });
});
