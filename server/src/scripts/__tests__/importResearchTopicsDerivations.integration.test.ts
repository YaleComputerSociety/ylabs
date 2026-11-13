import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modelCalls = vi.hoisted(() => ({ chat: vi.fn(), embedding: vi.fn() }));

vi.mock('../../utils/modelClient', async () => {
  const actual =
    await vi.importActual<typeof import('../../utils/modelClient')>('../../utils/modelClient');
  return {
    ...actual,
    postChatCompletion: modelCalls.chat.mockImplementation(() => {
      throw new Error('the OpenAI client must not be called');
    }),
    postEmbedding: modelCalls.embedding.mockImplementation(() => {
      throw new Error('the OpenAI client must not be called');
    }),
  };
});

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
import { materializeEntity } from '../../scrapers/entityMaterializer';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../../scrapers/researchAreaCanonicalization';
import { CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS } from '../../scrapers/researchPageTopicsDerivation';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
} from '../../scrapers/utils/researchPageText';
import { loadStoredPageTextRowsBySlug } from '../deriveResearchTopics';
import { mongoImportStore } from '../importResearchTopicsDerivations';
import {
  buildResearchTopicsExport,
  importedTopicsWriterId,
  importResearchTopicReadings,
  parseImportedTopicReadings,
} from '../importResearchTopicsDerivationsCore';

const SLUG = 'tidepool-lab-fixture';
const HOME = 'https://tidepool-lab.example.org/';
const pages = [
  { url: HOME, text: 'We study how coastal kelp forests recover after marine heatwaves.' },
];

type PersistedEntity = {
  researchAreas?: string[];
  fieldProvenance?: Record<string, Record<string, unknown>>;
};

describe('research-topics:import-derivations against the cache and the materializer', () => {
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

  beforeEach(async () => {
    modelCalls.chat.mockClear();
    modelCalls.embedding.mockClear();
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
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: RESEARCH_PAGE_TEXT_FIELD,
      value: pages,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: RESEARCH_PAGE_TEXT_SOURCE,
      sourceUrl: HOME,
      confidence: 0.85,
      observedAt: new Date(),
      superseded: false,
    });
  });

  const exportAndImport = async (topics: unknown[], field: unknown = null) => {
    const rows = await loadStoredPageTextRowsBySlug([SLUG]);
    const exported = buildResearchTopicsExport(rows, [SLUG]);
    const [row] = exported.rows;
    return importResearchTopicReadings({
      mode: 'import',
      apply: true,
      readings: parseImportedTopicReadings({
        writer: importedTopicsWriterId(exported.promptHash),
        promptHash: exported.promptHash,
        rows: [
          { slug: SLUG, inputHash: row.inputHash, rawOutput: JSON.stringify({ topics, field }) },
        ],
      }),
      rows,
      store: mongoImportStore,
    });
  };

  const persisted = () => ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>();

  it('a resolve serves the imported reading with no model call', async () => {
    const report = await exportAndImport(
      [
        { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
        { topic: 'Marine heatwaves', quote: 'recover after marine heatwaves', url: HOME },
      ],
      { topic: 'Marine ecology', quote: 'We study how coastal kelp', url: HOME },
    );
    expect(report.stored).toBe(1);
    expect(await ResearchTopicsDerivation.findOne({}).lean()).toMatchObject({
      writer: importedTopicsWriterId(CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS.promptHash),
      model: CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS.model,
    });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(['Kelp forests', 'Marine heatwaves', 'Marine ecology']);
    expect(row?.fieldProvenance?.researchAreas?.sourceName).toBe(
      RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
    );
    expect(modelCalls.chat).not.toHaveBeenCalled();
    expect(modelCalls.embedding).not.toHaveBeenCalled();
  });

  it('a resolve drops an imported topic whose quote is not on the page', async () => {
    await exportAndImport(
      [
        { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
        { topic: 'Marine heatwaves', quote: 'recover after marine heatwaves', url: HOME },
        { topic: 'Coastal kelp', quote: 'coastal kelp nurseries on deep reefs', url: HOME },
      ],
      { topic: 'Marine ecology', quote: 'We study how coastal kelp', url: HOME },
    );

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await persisted();
    expect(row?.researchAreas).toEqual(['Kelp forests', 'Marine heatwaves', 'Marine ecology']);
    expect(row?.researchAreas).not.toContain('Coastal kelp');
    expect(modelCalls.chat).not.toHaveBeenCalled();
  });

  it('a second import never replaces the stored reading', async () => {
    await exportAndImport([
      { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
    ]);
    const first = await ResearchTopicsDerivation.findOne({}).lean();

    const again = await exportAndImport([
      { topic: 'Marine heatwaves', quote: 'recover after marine heatwaves', url: HOME },
    ]);

    expect(again.alreadyCached).toBe(1);
    expect(again.stored).toBe(0);
    expect(await ResearchTopicsDerivation.countDocuments({})).toBe(1);
    expect(await ResearchTopicsDerivation.findOne({}).lean()).toEqual(first);
  });

  it('the store itself refuses to replace a reading that appeared after the check', async () => {
    await exportAndImport([
      { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
    ]);
    const first = await ResearchTopicsDerivation.findOne({}).lean();
    const inserted = await mongoImportStore.insertIfAbsent({
      inputHash: String(first?.inputHash),
      ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
      writer: 'another-writer',
      extractedTopics: [],
      derivedAt: new Date(),
    });
    expect(inserted).toBe(false);
    expect(await ResearchTopicsDerivation.findOne({}).lean()).toEqual(first);
  });
});
