import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import {
  buildResearchEntitySearchEmbedderConfig,
  buildResearchEntitySearchIndexDocument,
  buildStudentSearchTerms,
  fetchResearchEntitySearchMemberNames,
  getResearchEntitySearchIndexSettings,
  RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL,
  RESEARCH_ENTITY_SEARCH_INDEX_NAME,
  RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
  RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
  RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET,
  rebuildResearchEntitySearchIndex,
} from '../researchEntitySearchIndexService';

describe('researchEntitySearchIndexService', () => {
  it('builds Meilisearch-ready research entity documents without internal fields', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-1',
      __v: 3,
      embedding: [0.1, 0.2],
      name: 'Smith Lab',
      archived: false,
      departments: ['Psychology'],
    });

    expect(doc).toMatchObject({
      id: 'entity-1',
      name: 'Smith Lab',
      archived: false,
      departments: ['Psychology'],
    });
    expect(doc).not.toHaveProperty('__v');
    expect(doc).not.toHaveProperty('embedding');
  });

  it('strips retired legacy access fields while preserving the graded access signal', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-access',
      name: 'Access Signal Lab',
      archived: false,
      openness: 'open',
      acceptingUndergrads: true,
      acceptanceConfidence: 0.9,
      opennessSignals: ['posted-opening'],
      opennessStatusCache: 'verified-accepting',
      opennessExplanationCache: 'Has a posted opening.',
      opennessComputedAt: '2026-01-01T00:00:00.000Z',
      opennessLastSignalAt: '2026-01-01T00:00:00.000Z',
      accessAcceptanceLevel: 'verified',
      accessSummary: { status: 'posted-opening', confidence: 0.9 },
    });

    expect(doc).toMatchObject({
      id: 'entity-access',
      accessAcceptanceLevel: 'verified',
      accessSummary: { status: 'posted-opening', confidence: 0.9 },
    });
    expect(doc).not.toHaveProperty('openness');
    expect(doc).not.toHaveProperty('acceptingUndergrads');
    expect(doc).not.toHaveProperty('acceptanceConfidence');
    expect(doc).not.toHaveProperty('opennessSignals');
    expect(doc).not.toHaveProperty('opennessStatusCache');
    expect(doc).not.toHaveProperty('opennessExplanationCache');
    expect(doc).not.toHaveProperty('opennessComputedAt');
    expect(doc).not.toHaveProperty('opennessLastSignalAt');
  });

  it('adds curated student topic aliases to searchable index documents', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-ai',
      name: 'Medical Imaging Group',
      fullDescription: 'Uses artificial intelligence for diagnostic imaging.',
      researchAreas: ['Computer Vision'],
      archived: false,
    });

    expect(doc).toMatchObject({
      id: 'entity-ai',
      studentSearchTerms: expect.arrayContaining([
        'ai',
        'artificial intelligence',
        'machine learning',
        'computer vision',
      ]),
    });
    expect(buildStudentSearchTerms({ name: 'Ailong Airway Lab' })).toEqual([]);
  });

  it('filters unsafe URLs and direct contact text from public research entity index documents', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-url-safety',
      name: 'URL Safety Lab',
      fullDescription: 'Contact pi@example.edu or 203-555-1212 for research roles.',
      shortDescription: 'Email pi@example.edu for details.',
      websiteUrl: 'javascript:alert(document.cookie)',
      website: 'https://safe.example.edu/lab',
      sourceUrls: [
        'mailto:pi@example.edu',
        'https://safe.example.edu/source',
        'javascript:alert(document.cookie)',
      ],
      archived: false,
    });

    expect(doc).toMatchObject({
      id: 'entity-url-safety',
      fullDescription: 'Contact [email redacted] or [phone redacted] for research roles.',
      shortDescription: 'Email [email redacted] for details.',
      websiteUrl: 'https://safe.example.edu/lab',
      sourceUrls: ['https://safe.example.edu/source'],
    });
    expect(JSON.stringify(doc)).not.toContain('javascript:');
    expect(JSON.stringify(doc)).not.toContain('mailto:');
    expect(JSON.stringify(doc)).not.toContain('pi@example.edu');
    expect(JSON.stringify(doc)).not.toContain('203-555-1212');
  });

  it('exposes clone-safe settings used by the live Research browse filters', () => {
    const settings = getResearchEntitySearchIndexSettings();

    settings.filterableAttributes.push('mutated');

    expect(RESEARCH_ENTITY_SEARCH_INDEX_NAME).toBe('researchentities');
    expect(RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY).toBe('id');
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).toEqual(
      expect.arrayContaining([
        'archived',
        'kind',
        'school',
        'departments',
        'researchAreas',
        'accessAcceptanceLevel',
        'studentVisibilityTier',
      ]),
    );
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).not.toContain(
      'acceptingUndergrads',
    );
    const searchable = getResearchEntitySearchIndexSettings().searchableAttributes;
    expect(searchable).toEqual(expect.arrayContaining(['leadProfessorNames', 'professorNames']));
    expect(searchable).toEqual(expect.arrayContaining(['shortDescription', 'fullDescription']));
    expect(searchable).not.toContain('keywords');
    expect(searchable).not.toContain('summary');
    expect(searchable).not.toContain('description');
    expect(searchable.indexOf('researchAreas')).toBeLessThan(
      searchable.indexOf('shortDescription'),
    );
    expect(searchable.indexOf('shortDescription')).toBeLessThan(
      searchable.indexOf('fullDescription'),
    );
    expect(getResearchEntitySearchIndexSettings().rankingRules).toEqual([
      'words',
      'proximity',
      'attribute',
      'exactness',
      'typo',
      'sort',
    ]);
    expect(getResearchEntitySearchIndexSettings().typoTolerance).toMatchObject({
      minWordSizeForTypos: {
        oneTypo: 5,
        twoTypos: 9,
      },
      disableOnWords: expect.arrayContaining(['ai', 'ml', 'nlp', 'cv']),
    });
    expect(getResearchEntitySearchIndexSettings().synonyms).toMatchObject({
      ai: expect.arrayContaining(['artificial intelligence', 'machine learning']),
      cv: expect.arrayContaining(['computer vision']),
      'computer vision': expect.arrayContaining(['computational vision']),
      'computational vision': expect.arrayContaining(['computer vision']),
    });
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).not.toContain('mutated');
    expect(getResearchEntitySearchIndexSettings().sortableAttributes).toEqual(
      expect.arrayContaining(['lastObservedAt', 'name', 'createdAt', 'updatedAt']),
    );
  });

  it('raises the pagination ceiling above the Meili default so the full directory is reachable', () => {
    const settings = getResearchEntitySearchIndexSettings();

    expect(settings.pagination.maxTotalHits).toBe(RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS);
    expect(settings.pagination.maxTotalHits).toBeGreaterThan(1000);

    settings.pagination.maxTotalHits = 1;
    expect(getResearchEntitySearchIndexSettings().pagination.maxTotalHits).toBe(
      RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
    );
  });

  it('raises the facet-value ceiling above the Meili default so every department stays selectable', () => {
    const settings = getResearchEntitySearchIndexSettings();

    expect(settings.faceting.maxValuesPerFacet).toBe(RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET);
    expect(settings.faceting.maxValuesPerFacet).toBeGreaterThan(100);

    settings.faceting.maxValuesPerFacet = 1;
    expect(getResearchEntitySearchIndexSettings().faceting.maxValuesPerFacet).toBe(
      RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET,
    );
  });

  it('rebuilds the index in pages and applies settings before documents', async () => {
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async (settings: unknown) => {
        calls.push({ kind: 'settings', payload: settings });
      },
      deleteAllDocuments: async () => {
        calls.push({ kind: 'clear' });
      },
      addDocuments: async (documents: unknown, options: unknown) => {
        calls.push({ kind: 'documents', payload: { documents, options } });
      },
    };
    const fetchPage = async (page: number) =>
      page === 1
        ? [
            { _id: 'entity-1', name: 'Smith Lab', archived: false },
            { _id: 'entity-2', name: 'Tobin Center', archived: false },
          ]
        : [];

    const result = await rebuildResearchEntitySearchIndex({
      pageSize: 2,
      clearExisting: true,
      getIndex: async () => fakeIndex,
      fetchPage,
    });

    expect(result).toEqual({
      indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
      pageSize: 2,
      fetchedDocumentCount: 2,
      indexedDocumentCount: 2,
      pageCount: 1,
      clearedExisting: true,
    });
    expect(calls.map((call) => call.kind)).toEqual(['settings', 'clear', 'documents']);
    expect(calls[2].payload).toMatchObject({
      options: { primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY },
    });
  });

  it('configures the OpenAI text-embedding-3-small embedder for the research index', () => {
    const config = buildResearchEntitySearchEmbedderConfig('sk-test') as any;
    expect(config.default).toMatchObject({
      source: 'openAi',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
    });
    expect(config.default.documentTemplate).toContain('{{doc.professorNames}}');
    expect(config.default.documentTemplate).toContain('{{doc.researchAreas}}');
    expect(config.default.documentTemplate).toContain('{{doc.shortDescription}}');
    expect(RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL).toBe('text-embedding-3-small');
  });

  it('applies the embedder during rebuild only when OPENAI_API_KEY is present', async () => {
    const embedderCalls: any[] = [];
    const fakeIndex = {
      updateSettings: async () => {},
      updateEmbedders: async (embedders: unknown) => {
        embedderCalls.push(embedders);
      },
      deleteAllDocuments: async () => {},
      addDocuments: async () => {},
    };
    const fetchPage = async (page: number) =>
      page === 1 ? [{ _id: 'e1', name: 'Sample Lab', archived: false }] : [];
    const run = () =>
      rebuildResearchEntitySearchIndex({
        pageSize: 5,
        getIndex: async () => fakeIndex as any,
        fetchPage,
        fetchMemberNames: async () => new Map(),
      });

    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    await run();
    expect(embedderCalls).toHaveLength(1);
    expect(embedderCalls[0].default.model).toBe('text-embedding-3-small');

    embedderCalls.length = 0;
    delete process.env.OPENAI_API_KEY;
    await run();
    expect(embedderCalls).toHaveLength(0);

    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
  });

  it('enriches rebuilt research entity documents with searchable professor names', async () => {
    const entityId = '6a0567977c6d4fba869fc03d';
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async (settings: unknown) => {
        calls.push({ kind: 'settings', payload: settings });
      },
      addDocuments: async (documents: unknown, options: unknown) => {
        calls.push({ kind: 'documents', payload: { documents, options } });
      },
    };

    await rebuildResearchEntitySearchIndex({
      pageSize: 2,
      getIndex: async () => fakeIndex,
      fetchPage: async (page: number) =>
        page === 1
          ? [
              {
                _id: entityId,
                slug: 'ysm-ynn',
                name: 'Yale Clinical Neuroscience Neuroanalytics',
                archived: false,
              },
            ]
          : [],
      fetchMemberNames: async (entityIds: unknown[]) => {
        expect(entityIds).toEqual([entityId]);
        return new Map([
          [
            entityId,
            {
              leadProfessorNames: ['Dennis Spencer'],
              professorNames: ['Dennis Spencer', 'Example Core Faculty'],
            },
          ],
        ]);
      },
    } as any);

    const documentsCall = calls.find((call) => call.kind === 'documents');
    expect(documentsCall?.payload).toMatchObject({
      documents: [
        {
          id: entityId,
          slug: 'ysm-ynn',
          leadProfessorNames: ['Dennis Spencer'],
          professorNames: ['Dennis Spencer', 'Example Core Faculty'],
        },
      ],
      options: { primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY },
    });
  });

  it('rejects unsafe rebuild page sizes before configuring the index', async () => {
    let getIndexCalls = 0;

    await expect(
      rebuildResearchEntitySearchIndex({
        pageSize: 9007199254740992,
        getIndex: async () => {
          getIndexCalls += 1;
          throw new Error('unexpected index setup');
        },
        fetchPage: async () => [],
      }),
    ).rejects.toThrow('--page-size must be a safe positive integer');

    expect(getIndexCalls).toBe(0);
  });
});

describe('fetchResearchEntitySearchMemberNames canonical roster projection', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['accounts', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedMember = async (
    entityId: mongoose.Types.ObjectId,
    displayName: string,
    role: string,
    state = 'CURRENT',
  ) => {
    const person = await Researcher.create({
      displayName,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role,
      state,
      confidence: 0.9,
    });
  };

  it('derives professor and lead names from the canonical roster and excludes non-professor and historical rows', async () => {
    const entityId = new mongoose.Types.ObjectId();
    await seedMember(entityId, 'Lead Professor', 'PI');
    await seedMember(entityId, 'Core Faculty Member', 'CORE_FACULTY');
    await seedMember(entityId, 'Lab Staff', 'STAFF');
    await seedMember(entityId, 'Former Professor', 'PI', 'HISTORICAL');

    const byEntityId = await fetchResearchEntitySearchMemberNames([entityId]);
    const fields = byEntityId.get(entityId.toString());

    expect(fields?.leadProfessorNames).toEqual(['Lead Professor']);
    expect(fields?.professorNames).toEqual(['Lead Professor', 'Core Faculty Member']);
  });
});

describe('rebuildResearchEntitySearchIndex archived exclusion', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
  });

  const collectIndexedIds = async () => {
    const indexedIds: string[] = [];
    const fakeIndex = {
      updateSettings: async () => {},
      deleteAllDocuments: async () => {},
      addDocuments: async (documents: Array<{ id: string }>) => {
        for (const document of documents) indexedIds.push(document.id);
      },
    };
    await rebuildResearchEntitySearchIndex({
      pageSize: 50,
      clearExisting: true,
      getIndex: async () => fakeIndex as any,
      fetchMemberNames: async () => new Map(),
    });
    return indexedIds;
  };

  it('excludes dedupe-archived entities from the rebuilt index payload', async () => {
    const active = await ResearchEntity.create({ slug: 'active-lab', name: 'Active Lab' });
    const explicitlyLive = await ResearchEntity.create({
      slug: 'live-lab',
      name: 'Live Lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: 'archived-shell',
      name: 'Archived Shell',
      archived: true,
    });

    const indexedIds = await collectIndexedIds();

    expect(indexedIds).toEqual(
      expect.arrayContaining([active._id.toString(), explicitlyLive._id.toString()]),
    );
    expect(indexedIds).toHaveLength(2);
  });
});
