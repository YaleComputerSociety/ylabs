import { describe, expect, it } from 'vitest';
import {
  buildResearchEntitySearchEmbedderConfig,
  buildResearchEntitySearchIndexDocument,
  compareResearchEntitySearchIndexToCode,
  getResearchEntitySearchIndexSettings,
  reconcileResearchEntitySearchIndex,
  researchEntitySearchEmbedderDrift,
  researchEntitySearchIndexSettingsDrift,
} from '../researchEntitySearchIndexService';

const row = (hexSuffix: string, name: string) => ({
  _id: `64b000000000000000000${hexSuffix}`,
  name,
  slug: `synthetic-${hexSuffix}`,
  researchAreas: ['synthetic topic'],
  studentVisibilityTier: 'student_ready',
});

const servedDocument = (source: ReturnType<typeof row>) =>
  JSON.parse(JSON.stringify(buildResearchEntitySearchIndexDocument(source)));

function fakeIndex(initial: Record<string, any>[], options: { embedder?: boolean } = {}) {
  const stored = new Map(initial.map((doc) => [String(doc.id), doc]));
  const added: Record<string, any>[][] = [];
  const deleted: string[][] = [];
  let taskUid = 0;
  return {
    stored,
    added,
    deleted,
    tasks: { waitForTask: async () => ({ status: 'succeeded' }) },
    getEmbedders: async () => (options.embedder === false ? {} : { default: { source: 'openAi' } }),
    getDocuments: async ({ limit, offset }: { limit: number; offset: number }) => ({
      results: [...stored.values()].slice(offset, offset + limit),
      total: stored.size,
    }),
    addDocuments: async (docs: Record<string, any>[]) => {
      added.push(docs);
      for (const doc of docs) stored.set(String(doc.id), JSON.parse(JSON.stringify(doc)));
      return { taskUid: (taskUid += 1) };
    },
    deleteDocuments: async (ids: string[]) => {
      deleted.push(ids);
      for (const id of ids) stored.delete(id);
      return { taskUid: (taskUid += 1) };
    },
  };
}

const run = (index: ReturnType<typeof fakeIndex>, rows: any[], apply: boolean) =>
  reconcileResearchEntitySearchIndex({
    apply,
    maxDeleteFraction: 0.5,
    getIndex: async () => index as any,
    fetchPage: async (page) => (page === 1 ? rows : []),
    fetchMemberNames: async () => new Map(),
    warmVocabulary: async () => undefined,
  });

describe('reconcileResearchEntitySearchIndex', () => {
  const unchanged = row('001', 'Synthetic Unchanged Lab');
  const edited = row('002', 'Synthetic Edited Lab');
  const added = row('003', 'Synthetic New Lab');
  const orphan = row('004', 'Synthetic Retired Lab');
  const rows = [unchanged, { ...edited, name: 'Synthetic Edited Lab Renamed' }, added];
  const indexedBefore = () => [
    servedDocument(unchanged),
    servedDocument(edited),
    servedDocument(orphan),
  ];

  it('writes only the documents that differ and deletes the ones with no live row', async () => {
    const index = fakeIndex(indexedBefore());

    const result = await run(index, rows, true);

    expect(result).toMatchObject({
      applied: true,
      corpusDocumentCount: 3,
      indexedDocumentCountBefore: 3,
      unchangedDocumentCount: 1,
      upsertedDocumentCount: 2,
      addedDocumentCount: 1,
      updatedDocumentCount: 1,
      deletedDocumentCount: 1,
    });
    expect(
      index.added
        .flat()
        .map((doc) => doc.slug)
        .sort(),
    ).toEqual(['synthetic-002', 'synthetic-003']);
    expect(index.deleted).toEqual([[String(orphan._id)]]);
  });

  it('finds nothing to write on a second run', async () => {
    const index = fakeIndex(indexedBefore());
    await run(index, rows, true);

    const second = await run(index, rows, true);

    expect(second).toMatchObject({ upsertedDocumentCount: 0, deletedDocumentCount: 0 });
    expect(index.added).toHaveLength(1);
    expect(index.deleted).toHaveLength(1);
  });

  it('reports the plan without writing on a dry run', async () => {
    const index = fakeIndex(indexedBefore());

    const result = await run(index, rows, false);

    expect(result).toMatchObject({
      applied: false,
      upsertedDocumentCount: 2,
      deletedDocumentCount: 1,
    });
    expect(index.added).toEqual([]);
    expect(index.deleted).toEqual([]);
  });

  it('treats key order as no difference', async () => {
    const reordered = Object.fromEntries(Object.entries(servedDocument(unchanged)).reverse());
    const index = fakeIndex([reordered]);

    const result = await run(index, [unchanged], false);

    expect(result.upsertedDocumentCount).toBe(0);
  });

  it('refuses an index with no stored embedder', async () => {
    const index = fakeIndex(indexedBefore(), { embedder: false });

    await expect(run(index, rows, true)).rejects.toThrow(/no stored embedder/);
    expect(index.added).toEqual([]);
  });

  it('refuses when the corpus yields no documents', async () => {
    const index = fakeIndex(indexedBefore());

    await expect(run(index, [], true)).rejects.toThrow(/corpus yields no index documents/);
    expect(index.deleted).toEqual([]);
  });

  it('refuses a delete above the limit, which signals a wrong Mongo target', async () => {
    const index = fakeIndex(indexedBefore());

    await expect(run(index, [added], true)).rejects.toThrow(/would delete 3 of 3/);
    expect(index.added).toEqual([]);
    expect(index.deleted).toEqual([]);
  });
});

describe('reconcile failure part-way', () => {
  it('reports how much of the write landed when a batch fails', async () => {
    const rows = ['011', '012', '013'].map((suffix) => row(suffix, `Synthetic Lab ${suffix}`));
    const index = fakeIndex([]);
    let calls = 0;
    const failing = {
      ...index,
      addDocuments: async (docs: Record<string, any>[]) => {
        calls += 1;
        if (calls === 2) throw new Error('synthetic task failure');
        return index.addDocuments(docs);
      },
    };

    await expect(
      reconcileResearchEntitySearchIndex({
        apply: true,
        pageSize: 1,
        maxDeleteFraction: 0.5,
        getIndex: async () => failing as any,
        fetchPage: async (page) => (page === 1 ? rows : []),
        fetchMemberNames: async () => new Map(),
        warmVocabulary: async () => undefined,
      }),
    ).rejects.toThrow(/stopped part-way: the live index holds 1 of 3 upserts/);
  });
});

const liveSettingsAsMeiliReturnsThem = () => {
  const expected = getResearchEntitySearchIndexSettings();
  return {
    ...expected,
    filterableAttributes: [...expected.filterableAttributes].sort().reverse(),
    sortableAttributes: [...expected.sortableAttributes].sort(),
    stopWords: [],
    distinctAttribute: null,
    faceting: { ...expected.faceting, sortFacetValuesBy: { '*': 'alpha' } },
  };
};

describe('research entity search index drift', () => {
  it('finds no drift when Meilisearch returns the same settings in its own order', () => {
    expect(researchEntitySearchIndexSettingsDrift(liveSettingsAsMeiliReturnsThem())).toEqual([]);
  });

  it('names each setting that differs', () => {
    const live = liveSettingsAsMeiliReturnsThem();
    live.filterableAttributes = live.filterableAttributes.slice(1);
    live.rankingRules = [...live.rankingRules].reverse();
    live.pagination = { maxTotalHits: 1000 };
    expect(researchEntitySearchIndexSettingsDrift(live)).toEqual([
      'settings:rankingRules',
      'settings:filterableAttributes',
      'settings:pagination.maxTotalHits',
    ]);
  });

  it('compares the embedder by source, model and template, never by the redacted key', () => {
    const configured = buildResearchEntitySearchEmbedderConfig('XXX-redacted');
    expect(researchEntitySearchEmbedderDrift(configured)).toEqual([]);
    expect(researchEntitySearchEmbedderDrift({})).toEqual(['embedder:missing']);
    expect(
      researchEntitySearchEmbedderDrift({
        default: { ...configured.default, documentTemplate: 'Name: {{doc.name}}' },
      }),
    ).toEqual(['embedder:documentTemplate']);
  });

  it('reports a missing live index without reading its settings', async () => {
    const comparison = await compareResearchEntitySearchIndexToCode({
      getClient: async () => ({
        getRawIndex: async () => {
          throw Object.assign(new Error('missing'), { code: 'index_not_found' });
        },
      }),
      getIndex: async () => {
        throw new Error('should not read a missing index');
      },
    });
    expect(comparison).toMatchObject({ indexExists: false, drift: ['index:missing'] });
  });

  it('combines settings and embedder drift for a live index', async () => {
    const comparison = await compareResearchEntitySearchIndexToCode({
      getClient: async () => ({ getRawIndex: async () => ({}) }),
      getIndex: async () =>
        ({
          getSettings: async () => liveSettingsAsMeiliReturnsThem(),
          getEmbedders: async () => ({}),
        }) as any,
    });
    expect(comparison).toMatchObject({ indexExists: true, drift: ['embedder:missing'] });
  });
});
