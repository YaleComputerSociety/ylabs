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
      _id: { toString: () => 'entity-1' },
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
});
