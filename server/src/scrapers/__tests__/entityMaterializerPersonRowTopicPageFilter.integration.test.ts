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
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ResearchTopicsDerivation } from '../../models/researchTopicsDerivation';
import { RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME } from '../../models/fieldProvenanceBacking';
import { materializeEntity } from '../entityMaterializer';
import {
  CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
  researchPageTextHash,
  researchTopicsDerivationInputHash,
} from '../researchPageTopicsDerivation';
import { PAGE_QUOTED_TOPICS_FILTER_CONTRACT } from '../utils/pageQuotedResearchTopics';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../researchAreaCanonicalization';

const SLUG = 'fixture-person-research-row';
const LANDING = 'https://fixture-dept.yale.edu/research';
const LEAD_PAGE = 'https://fixture-dept.yale.edu/labs/coastal-group';
const landingPage = {
  url: LANDING,
  text: 'The department advances research in astrophysics, number theory and materials science.',
};
const leadPage = {
  url: LEAD_PAGE,
  text: 'Professor Quillfeather studies how coastal kelp forests recover after marine heatwaves.',
};

type PersistedEntity = {
  researchAreas?: string[];
  fieldProvenance?: Record<string, Record<string, unknown>>;
};

describe('materializeEntity reads only lead-naming pages for a person row topics (#6110)', () => {
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
      createResearchAreaCanonicalizer(buildResearchAreaResolverIndex([{ name: 'Neuroscience' }])),
    );
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'research_entities',
      'researchers',
      'role_assignments',
      'research_topics_derivations',
    ]) {
      await db.collection(name).deleteMany({});
    }
    const entity = await ResearchEntity.create({
      slug: SLUG,
      name: 'Avery Quillfeather Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    const lead = await Researcher.create({ displayName: 'Avery Quillfeather' });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
  });

  const seedPageText = (value: unknown) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: RESEARCH_PAGE_TEXT_FIELD,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: RESEARCH_PAGE_TEXT_SOURCE,
      sourceUrl: LEAD_PAGE,
      confidence: 0.85,
      observedAt: new Date(),
      superseded: false,
    });

  const persisted = () => ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>();

  it('serves the reading keyed on the lead-naming page alone', async () => {
    await seedPageText([landingPage, leadPage]);
    await ResearchTopicsDerivation.create({
      inputHash: researchTopicsDerivationInputHash([leadPage]),
      ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
      extractedTopics: [
        { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: LEAD_PAGE },
        { topic: 'Astrophysics', quote: 'research in astrophysics', url: LANDING },
      ],
      extractedField: null,
    });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(['Kelp forests']);
    expect(row?.fieldProvenance?.researchAreas).toMatchObject({
      sourceName: RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
      derivationTextHash: researchPageTextHash([leadPage]),
    });
  });

  it('keeps the stored topics when no page names the lead, rather than emptying them', async () => {
    const storedTopics = ['Astrophysics', 'Number theory'];
    await ResearchEntity.updateOne(
      { slug: SLUG },
      {
        $set: {
          researchAreas: storedTopics,
          'fieldProvenance.researchAreas': {
            sourceName: RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
            sourceUrl: LANDING,
            confidence: 0.85,
            derivationInputHash: researchTopicsDerivationInputHash([landingPage]),
            derivationTextHash: researchPageTextHash([landingPage]),
            derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
          },
        },
      },
    );
    await seedPageText([landingPage]);

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(storedTopics);
    expect(row?.fieldProvenance?.researchAreas?.sourceName).toBe(
      RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
    );
  });
});
