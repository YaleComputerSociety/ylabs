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
import { ResearchTopicsDerivation } from '../../models/researchTopicsDerivation';
import { materializeEntity } from '../entityMaterializer';
import {
  CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
  researchTopicsDerivationInputHash,
} from '../researchPageTopicsDerivation';
import { DESCRIPTION_LANE_SOURCE_NAME } from '../utils/researchAreasGroundedInDescription';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../researchAreaCanonicalization';

const SLUG = 'kelp-recovery-lab-fixture';
const HOME = 'https://kelp-recovery-lab.example.org/';
const pages = [{ url: HOME, text: 'Welcome. Our news, people and contact details.' }];
const servedDescription = [
  'The group studies how coastal kelp forests recover after marine heatwaves, using field surveys.',
  'Lab life: journal club; field trips; outreach days',
].join('\n');

type PersistedEntity = { researchAreas?: string[] };

describe('an empty page-topic reading keeps only lane topics the served description states (#6360)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
    resetResearchAreaCanonicalizerCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    setResearchAreaCanonicalizerForTesting(
      createResearchAreaCanonicalizer(buildResearchAreaResolverIndex([{ name: 'Field Surveys' }])),
    );
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'research_entities',
      'role_assignments',
      'research_topics_derivations',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Kelp Recovery Lab Fixture',
      kind: 'lab',
      entityType: 'LAB',
      shortDescription: servedDescription,
      websiteUrl: HOME,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
  });

  const seedObservation = (field: string, value: unknown, sourceName: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: HOME,
      confidence: 0.95,
      observedAt: new Date(),
      superseded: false,
    });

  const seedLaneTopics = () =>
    seedObservation(
      'researchAreas',
      ['Kelp Forests', 'Marine Heatwaves', 'Journal Club'],
      DESCRIPTION_LANE_SOURCE_NAME,
    );

  const seedPageText = () =>
    seedObservation(RESEARCH_PAGE_TEXT_FIELD, pages, RESEARCH_PAGE_TEXT_SOURCE);

  const seedEmptyReading = async () => {
    await seedPageText();
    await ResearchTopicsDerivation.create({
      inputHash: researchTopicsDerivationInputHash(pages),
      ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
      extractedTopics: [],
      extractedField: null,
    });
  };

  const servedTopics = async () =>
    (await ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>())?.researchAreas ?? [];

  it('keeps a lane topic the description states in a sentence and drops one stated only in a list', async () => {
    await seedEmptyReading();
    await seedLaneTopics();
    await seedObservation('researchAreas', ['Oceanography'], 'ysm-mesh-keyword');

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await servedTopics()).toEqual(['Kelp Forests', 'Marine Heatwaves']);
  });

  it('is a no-op on a second resolve', async () => {
    await seedEmptyReading();
    await seedLaneTopics();
    await materializeEntity('researchEntity', { entityKey: SLUG });
    const first = await servedTopics();

    const again = await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(again.fieldsWritten).toBe(0);
    expect(await servedTopics()).toEqual(first);
  });

  it('clears a stored list no grounded topic backs, without deriving chips from the prose', async () => {
    await ResearchEntity.updateOne({ slug: SLUG }, { $set: { researchAreas: ['Outreach Days'] } });
    await seedEmptyReading();
    await seedObservation('researchAreas', ['Outreach Days'], 'ysm-mesh-keyword');

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await servedTopics()).toEqual([]);
    const again = await materializeEntity('researchEntity', { entityKey: SLUG });
    expect(again.fieldsWritten).toBe(0);
  });

  it('leaves the fallback unchanged while the page text has no reading yet', async () => {
    await seedPageText();
    await seedLaneTopics();

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await servedTopics()).toEqual(['Kelp Forests', 'Marine Heatwaves', 'Journal Club']);
  });
});
