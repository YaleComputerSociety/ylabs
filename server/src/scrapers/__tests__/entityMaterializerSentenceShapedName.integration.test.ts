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
import {
  resetKnownPersonSurnameRosterCache,
  resetLabRowRosterCache,
} from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';
import { resetSiteSharedPageNameCache } from '../siteSharedPageName';

const SLUG = 'orrery-institute';
const SITE = 'https://orrery.example.yale.edu';
const SENTENCE_NAME = 'Thank you for your interest in the Orrery Institute (OI).';
const LISTED_NAME = 'Orrery Institute for Fictional Microbes';

const observe = (sourceName: string, field: string, value: string, confidence: number) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: SLUG,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: SITE,
    field,
    value,
    confidence,
    observedAt: new Date('2026-10-20T00:00:00Z'),
    superseded: false,
  });

const seedInstituteServedUnderSentence = async (sentenceLane: string) => {
  await ResearchEntity.create({
    slug: SLUG,
    name: SENTENCE_NAME,
    displayName: SENTENCE_NAME,
    kind: 'institute',
    entityType: 'INSTITUTE',
    websiteUrl: SITE,
    sourceUrls: [SITE],
  });
  await observe(sentenceLane, 'name', SENTENCE_NAME, 0.95);
  await observe(sentenceLane, 'displayName', SENTENCE_NAME, 0.95);
  await observe(sentenceLane, 'entityType', 'INSTITUTE', 0.95);
  await observe(sentenceLane, 'websiteUrl', SITE, 0.95);
};

const row = () => ResearchEntity.findOne({ slug: SLUG }).lean<any>();

describe('materializeEntity refuses a sentence-shaped name from any lane (#5739)', () => {
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
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
    resetLabRowRosterCache();
    resetSiteSharedPageNameCache();
  });

  it.each(['lab-site-research-read', 'dept-faculty-roster'])(
    'falls to the next admissible name when %s asserted the sentence',
    async (sentenceLane) => {
      await seedInstituteServedUnderSentence(sentenceLane);
      await observe('centers-institutes-index', 'name', LISTED_NAME, 0.8);

      await materializeEntity('researchEntity', { entityKey: SLUG });

      const stored = await row();
      expect(stored.name).toBe(LISTED_NAME);
      expect(stored.displayName).not.toBe(SENTENCE_NAME);
      expect(stored.fieldProvenance?.name?.sourceName).toBe('centers-institutes-index');
    },
  );

  it('re-derives the same name on a second pass with no lock and no refusal record', async () => {
    await seedInstituteServedUnderSentence('lab-site-research-read');
    await observe('centers-institutes-index', 'name', LISTED_NAME, 0.8);
    const observationCount = await Observation.countDocuments({});

    await materializeEntity('researchEntity', { entityKey: SLUG });
    const afterFirst = await row();
    await materializeEntity('researchEntity', { entityKey: SLUG });
    const afterSecond = await row();

    expect(afterSecond.name).toBe(LISTED_NAME);
    expect(afterSecond.name).toBe(afterFirst.name);
    expect(afterSecond.displayName).toBe(afterFirst.displayName);
    expect(afterSecond.manuallyLockedFields ?? []).toEqual([]);
    expect(Object.keys(afterSecond.fieldValueRefusals ?? {})).toEqual([]);
    expect(await Observation.countDocuments({})).toBe(observationCount);
  });

  it('withholds the row when no admissible name exists, as an unusable name', async () => {
    await seedInstituteServedUnderSentence('lab-site-research-read');

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const stored = await row();
    expect(stored.displayName).toBeUndefined();
    expect(stored.studentVisibilityTier).not.toBe('student_ready');
  });
});
