import { describe, expect, it } from 'vitest';
import {
  applyProfileResearchAreasForIndexDocument,
  buildResearchEntitySearchIndexDocument,
  getResearchEntitySearchIndexSettings,
  getResearchEntitySemanticIndexReadiness,
  RESEARCH_ENTITY_SEARCH_INDEX_NAME,
  RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
  rebuildResearchEntitySearchIndex,
} from '../researchEntitySearchIndexService';

describe('researchEntitySearchIndexService', () => {
  it('builds Meilisearch-ready research entity documents without internal fields', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: { toString: () => 'entity-1' },
      __v: 3,
      embedding: [0.1, 0.2],
      name: 'Example Lab',
      archived: false,
      departments: ['Psychology'],
    });

    expect(doc).toMatchObject({
      id: 'entity-1',
      name: 'Example Lab',
      archived: false,
      departments: ['Psychology'],
    });
    expect(doc).not.toHaveProperty('_id');
    expect(doc).not.toHaveProperty('__v');
    expect(doc).not.toHaveProperty('embedding');
  });

  it('does not build index documents for archived research entities', () => {
    expect(
      buildResearchEntitySearchIndexDocument({
        _id: 'archived-entity',
        name: 'Archived Lab',
        archived: true,
      }),
    ).toBeNull();
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
        'openness',
        'acceptingUndergrads',
        'acceptanceConfidence',
        'offersIndependentStudy',
        'currentUndergradCount',
      ]),
    );
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).not.toContain(
      'mutated',
    );
    expect(getResearchEntitySearchIndexSettings().sortableAttributes).toEqual(
      expect.arrayContaining(['lastObservedAt', 'name', 'createdAt', 'updatedAt']),
    );
  });

  it('builds semantic fields for exploratory research search', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-1',
      name: 'Digital Humanities Lab',
      fullDescription: 'Supports computational text analysis and archive-centered projects.',
      departments: ['English', 'History'],
      researchAreas: ['digital humanities'],
      keywords: ['archives', 'text analysis'],
      entityType: 'center',
      sourceUrls: ['https://example.edu'],
    });

    expect(document).toMatchObject({
      id: 'entity-1',
      methodSignals: expect.arrayContaining([
        'computational text analysis',
        'archival research',
      ]),
      conceptSignals: expect.arrayContaining([
        'digital humanities',
        'archives and collections',
      ]),
      descriptionQuality: 'described',
    });
    expect(document?.semanticText).toContain('Digital Humanities Lab');
    expect(document?.semanticText).toContain('computational text analysis');
  });

  it('does not infer archival research from generic collection wording alone', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-collections-noise',
      name: 'Robotics Data Collection Lab',
      fullDescription:
        'Develops robot learning systems for sensor collection, dataset construction, and field deployment.',
      departments: ['Computer Science'],
      researchAreas: ['robotics'],
      keywords: ['data collection'],
    });

    expect(document?.methodSignals).not.toContain('archival research');
    expect(document?.conceptSignals).not.toContain('archives and collections');
  });

  it('infers archival research from source-backed archival evidence phrases', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-archival-evidence',
      name: 'Special Collections Research Home',
      fullDescription:
        'Supports undergraduate projects using special collections, rare books, manuscripts, and primary sources.',
      departments: ['History'],
      researchAreas: ['book history'],
      keywords: [],
    });

    expect(document?.methodSignals).toContain('archival research');
    expect(document?.conceptSignals).toContain('archives and collections');
  });

  it('keeps trusted library and museum collection contexts discoverable', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-library-collections',
      name: 'Museum Collections Research Home',
      fullDescription:
        'Supports curatorial research with library collections and museum collections.',
      departments: ['History of Art'],
      researchAreas: ['material culture'],
      keywords: [],
    });

    expect(document?.methodSignals).toContain('archival research');
    expect(document?.conceptSignals).toContain('archives and collections');
  });

  it('prioritizes full descriptions in semantic text while retaining concise summaries', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-description-depth',
      name: 'Depth Lab',
      shortDescription: 'Studies decision-making.',
      fullDescription:
        'The lab investigates decision-making under uncertainty using behavioral experiments, computational modeling, and longitudinal studies of learning.',
      departments: ['Psychology'],
      researchAreas: [],
      keywords: [],
    });

    const semanticText = String(document?.semanticText || '');
    expect(semanticText).toContain('computational modeling');
    expect(semanticText.indexOf('computational modeling')).toBeLessThan(
      semanticText.indexOf('Studies decision-making'),
    );
    expect(document?.shortDescription).toBe('Studies decision-making.');
  });

  it('keeps finance source text searchable without deriving one-off finance signals', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-finance',
      name: 'Financial Economics Research',
      fullDescription: 'Research on option pricing, derivatives, and mathematical finance.',
      departments: ['Economics'],
      researchAreas: [],
      keywords: [],
    });

    expect(document).toMatchObject({
      methodSignals: [],
      conceptSignals: [],
    });
    const semanticText = String(document?.semanticText || '').toLowerCase();
    expect(semanticText).toContain('option pricing');
    expect(semanticText).toContain('financial economics');
    expect(semanticText).toContain('mathematical finance');
  });

  it('uses PI-profile fallback research areas for semantic discovery without entity tags', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-profile-fallback',
      name: 'Example Research Lab',
      archived: false,
      researchAreas: [],
      profileResearchAreas: ['Nanoparticle-Based Drug Delivery'],
      researchAreaSource: 'PI_PROFILE_FALLBACK',
    });

    expect(document?.researchAreas).toEqual([]);
    expect(document?.profileResearchAreas).toEqual(['Nanoparticle-Based Drug Delivery']);
    expect(document?.semanticText).toContain('Nanoparticle-Based Drug Delivery');
  });

  it('derives PI-profile fallback fields for index documents before indexing', () => {
    const document = applyProfileResearchAreasForIndexDocument(
      {
        _id: 'entity-profile-fallback',
        name: 'Example Research Lab',
        researchAreas: ['Nanoparticle-Based Drug Delivery'],
      },
      [
        'Nanoparticle-Based Drug Delivery',
        'RNA Interference and Gene Delivery',
      ],
    );

    expect(document).toMatchObject({
      researchAreas: [],
      profileResearchAreas: [
        'Nanoparticle-Based Drug Delivery',
        'RNA Interference and Gene Delivery',
      ],
      researchAreaSource: 'PI_PROFILE_FALLBACK',
    });
  });

  it('filters polluted scraped research-area labels out of indexed documents', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-polluted-areas',
      name: 'Example Lab',
      archived: false,
      researchAreas: [
        'Synthetic ORCID profile token',
        'Fixture Lab Icon Streamline Icon: https://fixture.invalid/iconView Lab Website',
        'FixtureChrome View Lab Website',
        'Synthetic Signaling40 ResearchersView Related Publication',
        'FixtureChrome ResearchersView Count',
        'FixtureChrome View Related Publication',
        'Synthetic Signaling',
      ],
    });

    expect(document?.researchAreas).toEqual(['Synthetic Signaling']);
    expect(document?.semanticText).toContain('Synthetic Signaling');
    expect(document?.semanticText).not.toContain('ORCID');
    expect(document?.semanticText).not.toContain('View Related Publication');
  });

  it('does not index research-area placeholder text as a real description', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-placeholder-description',
      name: 'Example Physics Lab',
      archived: false,
      description: 'Research areas include Nuclear Physics and Particle Physics.',
      shortDescription: 'Research areas include Nuclear Physics and Particle Physics.',
      fullDescription: 'Research areas include Nuclear Physics and Particle Physics.',
      researchAreas: ['Nuclear Physics', 'Particle Physics'],
    });

    expect(document?.description).toBe('');
    expect(document?.shortDescription).toBe('');
    expect(document?.fullDescription).toBe('');
    expect(document?.descriptionQuality).toBe('sparse');
    expect(document?.semanticText).not.toContain('Research areas include');
    expect(document?.semanticText).toContain('Nuclear Physics');
  });

  it('does not index faculty appointment text as a real description', () => {
    const document = buildResearchEntitySearchIndexDocument({
      _id: 'entity-appointment-description',
      name: 'Example Laboratory',
      archived: false,
      shortDescription:
        'Department Chair and Synthetic Named Professor of Example Epidemiology and of Example Visual Science; Affiliated Faculty, Fixture Research Center...',
      fullDescription:
        'The example laboratory investigates molecular mechanisms of environmentally-induced diseases, focusing on liver disease, cancer, and neurodegenerative disorders.',
    });

    expect(document?.shortDescription).toBe('');
    expect(document?.fullDescription).toContain('molecular mechanisms');
    expect(document?.semanticText).not.toContain('Synthetic Named Professor');
    expect(document?.semanticText).toContain('molecular mechanisms');
  });

  it('includes semantic fields in searchable attributes', () => {
    const settings = getResearchEntitySearchIndexSettings();

    expect(settings.searchableAttributes).toEqual(
      expect.arrayContaining([
        'semanticText',
        'methodSignals',
        'conceptSignals',
        'searchTitle',
      ]),
    );
  });

  it('omits embedder settings when semantic search is not configured', () => {
    const settings = getResearchEntitySearchIndexSettings({
      semanticSearchEnabled: false,
    });

    expect(settings).not.toHaveProperty('embedders');
  });

  it('adds embedder settings when semantic search is configured', () => {
    const settings = getResearchEntitySearchIndexSettings({
      semanticSearchEnabled: true,
      openAiApiKey: 'test-key',
      embeddingModel: 'text-embedding-3-small',
    });

    expect(settings.embedders).toMatchObject({
      default: {
        source: 'openAi',
        apiKey: 'test-key',
        model: 'text-embedding-3-small',
        documentTemplate: '{{doc.semanticText}}',
      },
    });
  });

  it('creates missing indexes, applies settings before documents, and waits for tasks', async () => {
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async (settings: unknown) => {
        calls.push({ kind: 'settings', payload: settings });
        return { taskUid: 3 };
      },
      deleteAllDocuments: async () => {
        calls.push({ kind: 'clear' });
        return { taskUid: 1 };
      },
      addDocuments: async (documents: unknown, options: unknown) => {
        calls.push({ kind: 'documents', payload: { documents, options } });
        return { taskUid: 2 };
      },
      getStats: async () => {
        calls.push({ kind: 'stats' });
        return { numberOfDocuments: 2, isIndexing: false };
      },
    };
    const fetchPage = async (page: number) =>
      page === 1
        ? [
            { _id: 'entity-1', name: 'Example Lab', archived: false },
            { _id: 'entity-2', name: 'Example Center', archived: false },
          ]
        : [];

    const result = await rebuildResearchEntitySearchIndex({
      pageSize: 2,
      clearExisting: true,
      ensureIndex: async (indexName, primaryKey) => {
        calls.push({ kind: 'ensure', payload: { indexName, primaryKey } });
        return fakeIndex;
      },
      fetchPage,
      waitForTaskResponse: async (response: unknown) => {
        const taskUid = (response as { taskUid?: number }).taskUid;
        calls.push({ kind: 'wait', payload: taskUid });
      },
    });

    expect(result).toEqual({
      indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
      pageSize: 2,
      fetchedDocumentCount: 2,
      indexedDocumentCount: 2,
      pageCount: 1,
      clearedExisting: true,
      strategy: 'direct',
      resolvedIndexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
      meiliDocumentCount: 2,
      meiliIsIndexing: false,
    });
    expect(calls.map((call) => call.kind)).toEqual([
      'ensure',
      'settings',
      'wait',
      'clear',
      'wait',
      'documents',
      'wait',
      'stats',
    ]);
    expect(calls[0].payload).toEqual({
      indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
      primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
    });
    expect(calls[5].payload).toMatchObject({
      options: { primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY },
    });
    expect(calls.filter((call) => call.kind === 'wait').map((call) => call.payload)).toEqual([
      3,
      1,
      2,
    ]);
  });

  it('can rebuild through a temporary index and atomically swap into the live index', async () => {
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async () => {
        calls.push({ kind: 'settings' });
        return { taskUid: 11 };
      },
      addDocuments: async () => {
        calls.push({ kind: 'documents' });
        return { taskUid: 12 };
      },
      getStats: async () => ({ numberOfDocuments: 1, isIndexing: false }),
    };

    const result = await rebuildResearchEntitySearchIndex({
      strategy: 'swap',
      pageSize: 10,
      clearExisting: true,
      resolveIndexName: (name) => `beta_${name}`,
      createIndex: async (indexName, primaryKey) => {
        calls.push({ kind: 'create', payload: { indexName, primaryKey } });
        return fakeIndex;
      },
      ensureIndex: async (indexName, primaryKey) => {
        calls.push({ kind: 'ensure', payload: { indexName, primaryKey } });
        return fakeIndex;
      },
      swapIndexes: async (sourceIndexName, targetIndexName) => {
        calls.push({ kind: 'swap', payload: { sourceIndexName, targetIndexName } });
      },
      deleteIndex: async (indexName) => {
        calls.push({ kind: 'delete', payload: indexName });
      },
      fetchPage: async (page) =>
        page === 1 ? [{ _id: 'entity-1', name: 'Example Lab', archived: false }] : [],
      waitForTaskResponse: async (response: unknown) => {
        calls.push({ kind: 'wait', payload: (response as { taskUid?: number }).taskUid });
      },
      tempIndexName: 'beta_researchentities_rebuild_test',
    });

    expect(result).toMatchObject({
      indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
      resolvedIndexName: 'beta_researchentities',
      strategy: 'swap',
      indexedDocumentCount: 1,
      clearedExisting: true,
    });
    expect(calls.map((call) => call.kind)).toEqual([
      'create',
      'settings',
      'wait',
      'documents',
      'wait',
      'ensure',
      'swap',
      'delete',
      'ensure',
    ]);
    expect(calls[0].payload).toEqual({
      indexName: 'beta_researchentities_rebuild_test',
      primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
    });
    expect(calls[6].payload).toEqual({
      sourceIndexName: 'beta_researchentities_rebuild_test',
      targetIndexName: 'beta_researchentities',
    });
  });

  it('reports semantic readiness from embedded document stats', async () => {
    const readiness = await getResearchEntitySemanticIndexReadiness({
      getStats: async () => ({
        numberOfDocuments: 2797,
        numberOfEmbeddedDocuments: 2797,
      }),
    });

    expect(readiness).toEqual({
      status: 'ready',
      embeddedDocumentCount: 2797,
      documentCount: 2797,
      message: 'ResearchEntity Meilisearch index has embedded documents.',
    });
  });

  it('blocks semantic readiness when the index has no embedded documents', async () => {
    const readiness = await getResearchEntitySemanticIndexReadiness({
      getStats: async () => ({
        numberOfDocuments: 2797,
        numberOfEmbeddedDocuments: 0,
      }),
    });

    expect(readiness).toMatchObject({
      status: 'blocked',
      embeddedDocumentCount: 0,
      documentCount: 2797,
    });
  });
});
