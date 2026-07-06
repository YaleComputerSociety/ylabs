import { describe, expect, it } from 'vitest';
import {
  buildResearchEntitySearchIndexDocument,
  getResearchEntitySearchIndexSettings,
  RESEARCH_ENTITY_SEARCH_INDEX_NAME,
  RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
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

    expect(doc).toEqual({
      id: 'entity-1',
      name: 'Smith Lab',
      archived: false,
      departments: ['Psychology'],
    });
  });

  it('filters unsafe URLs and direct contact text from public research entity index documents', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-url-safety',
      name: 'URL Safety Lab',
      description: 'Contact pi@example.edu or 203-555-1212 for research roles.',
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
      description: 'Contact [email redacted] or [phone redacted] for research roles.',
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
        'openness',
        'acceptingUndergrads',
        'acceptanceConfidence',
        'offersIndependentStudy',
        'currentUndergradCount',
      ]),
    );
    expect(getResearchEntitySearchIndexSettings().searchableAttributes).toEqual(
      expect.arrayContaining(['leadProfessorNames', 'professorNames']),
    );
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).not.toContain(
      'mutated',
    );
    expect(getResearchEntitySearchIndexSettings().sortableAttributes).toEqual(
      expect.arrayContaining(['lastObservedAt', 'name', 'createdAt', 'updatedAt']),
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
