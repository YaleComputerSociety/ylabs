import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { resetKnownPersonSurnameRosterCache } from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'fixture-legacy-website-row';
const PATIENT_CARE_PAGE = 'https://medicine.example.edu/fixturecenter/patient/programs/fixture/';
const PROFILE_PAGE = 'https://medicine.yale.edu/profile/fixture-quillsby-person/';

const storedWebsite = async () =>
  (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ website?: string }>())?.website;

describe('materializeEntity clears a legacy website the detail payload withholds (#5376)', () => {
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
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
  });

  const seedObservation = (field: string, value: unknown) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: PROFILE_PAGE,
      confidence: 0.7,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      field,
      value,
    });

  const seedRow = async (website: string) => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Fixture Quillsby Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      website,
      sourceUrls: [PROFILE_PAGE],
      archived: false,
    });
    await seedObservation('slug', ENTITY_KEY);
    await seedObservation('name', 'Fixture Quillsby Faculty Research');
    await seedObservation('entityType', 'FACULTY_RESEARCH_AREA');
    await seedObservation('website', website);
  };

  it('clears a stored patient-care page that a live observation still asserts, and holds', async () => {
    await seedRow(PATIENT_CARE_PAGE);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expect(await storedWebsite()).toBe('');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expect(await storedWebsite()).toBe('');
  });

  it('keeps a profile page, which the detail page reads as the lead profile link', async () => {
    await seedRow(PROFILE_PAGE);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect(await storedWebsite()).toBe(PROFILE_PAGE);
  });
});
