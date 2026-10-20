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

const SLUG = 'tidepool-lab-fixture';
const HOME = 'https://tidepool-lab.example.org/';
const pages = [
  { url: HOME, text: 'We study how coastal kelp forests recover after marine heatwaves.' },
];
const derivedTopics = ['Kelp forests', 'Marine heatwaves', 'Marine ecology'];
const meshTopics = ['Ecosystem', 'Climate Change'];

type PersistedEntity = {
  researchAreas?: string[];
  fieldProvenance?: Record<string, Record<string, unknown>>;
  researchPageText?: unknown;
};

describe('materializeEntity applies a cached research page topics derivation (#5396)', () => {
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
      'role_assignments',
      'research_topics_derivations',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Tidepool Lab Fixture',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
  });

  const seedObservation = (
    field: string,
    value: unknown,
    sourceName: string,
    overrides: Record<string, unknown> = {},
  ) =>
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
      ...overrides,
    });

  const seedPageText = (value: unknown) =>
    seedObservation(RESEARCH_PAGE_TEXT_FIELD, value, RESEARCH_PAGE_TEXT_SOURCE, {
      confidence: 0.85,
    });

  const seedMesh = () => seedObservation('researchAreas', meshTopics, 'ysm-mesh-keyword');

  const seedDerivation = (forPages: typeof pages) =>
    ResearchTopicsDerivation.create({
      inputHash: researchTopicsDerivationInputHash(forPages),
      ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
      extractedTopics: [
        { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
        { topic: 'Marine heatwaves', quote: 'recover after marine heatwaves', url: HOME },
        { topic: 'Coral bleaching', quote: 'coral bleaching events', url: HOME },
      ],
      extractedField: { topic: 'Marine ecology', quote: 'We study how coastal kelp', url: HOME },
    });

  const storeDerivedList = (textHash: string) =>
    ResearchEntity.updateOne(
      { slug: SLUG },
      {
        $set: {
          researchAreas: derivedTopics,
          'fieldProvenance.researchAreas': {
            sourceName: RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
            sourceUrl: HOME,
            confidence: 0.85,
            derivationTextHash: textHash,
            derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
          },
        },
      },
    );

  const seedUnrelatedEvidence = () =>
    seedObservation(
      'fullDescription',
      'The group works at the intersection of ecology and neuroscience.',
      'department-directory',
    );

  const persisted = () => ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>();

  it('serves the derived list over a MeSH list and labels it, writing no observation', async () => {
    await seedPageText(pages);
    await seedMesh();
    await seedDerivation(pages);
    const observationsBefore = await Observation.countDocuments({});

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(derivedTopics);
    expect(row?.fieldProvenance?.researchAreas).toMatchObject({
      sourceName: RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
      sourceUrl: HOME,
      derivationTextHash: researchPageTextHash(pages),
      derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
    });
    expect(row?.fieldProvenance?.researchAreas?.observationId).toBeUndefined();
    expect(row?.researchPageText).toBeUndefined();
    expect(await Observation.countDocuments({})).toBe(observationsBefore);
    expect(
      await Observation.countDocuments({ sourceName: RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME }),
    ).toBe(0);
  });

  it('ignores a cached reading of text the row no longer carries', async () => {
    await seedPageText([
      { url: HOME, text: 'We now study seagrass meadows and blue carbon storage.' },
    ]);
    await seedMesh();
    await seedDerivation(pages);

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(meshTopics);
    expect(row?.fieldProvenance?.researchAreas?.sourceName).toBe('ysm-mesh-keyword');
  });

  it('withdraws the derived list once the page text it read is cleared', async () => {
    const first = await seedPageText(pages);
    await seedDerivation(pages);
    await materializeEntity('researchEntity', { entityKey: SLUG });
    expect((await persisted())?.researchAreas).toEqual(derivedTopics);

    await Observation.updateOne({ _id: first._id }, { $set: { superseded: true } });
    await seedPageText([]);
    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas ?? []).toEqual([]);
    expect(row?.fieldProvenance?.researchAreas).toBeUndefined();
  });

  it('keeps a stored derived list unchanged when the row has no page-text reading', async () => {
    await storeDerivedList(researchPageTextHash(pages));
    await seedUnrelatedEvidence();

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(derivedTopics);
    expect(row?.fieldProvenance?.researchAreas?.sourceName).toBe(
      RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
    );
  });

  it('keeps a stored derived list unchanged when its text stands but the current prompt has no reading', async () => {
    await storeDerivedList(researchPageTextHash(pages));
    await seedPageText(pages);
    await seedUnrelatedEvidence();
    await ResearchTopicsDerivation.create({
      inputHash: researchTopicsDerivationInputHash(pages, {
        ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
        promptHash: 'an-earlier-prompt',
      }),
      ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
      promptHash: 'an-earlier-prompt',
      extractedTopics: [],
      extractedField: null,
    });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(derivedTopics);
    expect(row?.fieldProvenance?.researchAreas).toMatchObject({
      sourceName: RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
      derivationTextHash: researchPageTextHash(pages),
    });
  });

  it('withdraws a stored derived list once the current reading of its text admits no topic', async () => {
    await storeDerivedList(researchPageTextHash(pages));
    await seedPageText(pages);
    await seedUnrelatedEvidence();
    await ResearchTopicsDerivation.create({
      inputHash: researchTopicsDerivationInputHash(pages),
      ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
      extractedTopics: [{ topic: 'Coral bleaching', quote: 'coral bleaching events', url: HOME }],
      extractedField: null,
    });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas ?? []).not.toContain(derivedTopics[0]);
    expect(row?.fieldProvenance?.researchAreas?.sourceName).not.toBe(
      RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
    );
  });

  it('is a no-op on a second pass over the same evidence', async () => {
    await seedPageText(pages);
    await seedDerivation(pages);
    await materializeEntity('researchEntity', { entityKey: SLUG });
    const again = await materializeEntity('researchEntity', { entityKey: SLUG });
    expect(again.fieldsWritten).toBe(0);
  });
});
