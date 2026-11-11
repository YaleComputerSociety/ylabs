import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getResearchSearchQueryVector: vi.fn(),
  search: vi.fn(),
  getEmbedders: vi.fn(),
}));

vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
}));

vi.mock('../../models/directoryRemoval', () => ({
  DirectoryRemoval: {
    find: () => ({ select: () => ({ lean: async () => [] }) }),
  },
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: mocks.getEmbedders,
  })),
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import { buildSearchSpellingVocabulary } from '../searchQuerySpellingCorrection';
import { setResearchSearchSpellingVocabularyForTests } from '../researchSearchSpellingVocabulary';

const vocabulary = buildSearchSpellingVocabulary(
  Array.from({ length: 20 }, () => ({
    nameText: ['Example Lab'],
    bodyText: ['natural language processing, immunology and coastal ecology'],
    served: true,
  })),
);

const searchedTexts = (): string[] => mocks.search.mock.calls.map(([text]) => String(text));
const PHRASE = 'natural language processing';
const searchedOnlyWithin = (phrase: string): boolean =>
  searchedTexts().every((text) => phrase.split(' ').includes(text.trim()) || text === phrase);

describe('a search rewritten from an acronym says so, and can be run literally (#5169)', () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.search.mockResolvedValue({
      hits: [],
      estimatedTotalHits: 0,
      totalHits: 0,
      facetDistribution: {},
      processingTimeMs: 1,
    });
    mocks.getEmbedders.mockReset();
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.getResearchSearchQueryVector.mockReset();
    mocks.getResearchSearchQueryVector.mockResolvedValue({
      vector: [0.1, 0.2],
      semanticLegAffordable: true,
    });
    invalidateResearchEntitySearchEmbedderCache();
    setResearchSearchSpellingVocabularyForTests(vocabulary);
  });

  afterEach(() => setResearchSearchSpellingVocabularyForTests(null));

  it('reports the acronym as typed and the phrase it searched', async () => {
    const result = await searchResearchGroupsViaMeili('NLP', {}, 1, 18);

    expect(searchedTexts().length).toBeGreaterThan(0);
    expect(searchedTexts()).toContain(PHRASE);
    expect(searchedOnlyWithin(PHRASE)).toBe(true);
    expect(result.acronymRewrite).toEqual({
      originalQuery: 'NLP',
      rewrittenQuery: PHRASE,
    });
    expect(result.queryCorrection).toBeUndefined();
  });

  it('searches the acronym itself when the caller asks for it literally', async () => {
    const result = await searchResearchGroupsViaMeili(
      'NLP',
      {},
      1,
      18,
      {},
      { rewriteAcronym: false },
    );

    expect(searchedTexts().length).toBeGreaterThan(0);
    expect(searchedTexts().every((text) => text.toLowerCase().split(' ').includes('nlp'))).toBe(
      true,
    );
    expect(searchedTexts()).not.toContain(PHRASE);
    expect(mocks.getResearchSearchQueryVector).not.toHaveBeenCalledWith(PHRASE, undefined);
    expect(result.acronymRewrite).toBeUndefined();
  });

  it('reports no rewrite for a query that was searched as typed', async () => {
    const topic = await searchResearchGroupsViaMeili('coastal ecology', {}, 1, 18);
    const carriedAcronym = await searchResearchGroupsViaMeili('rna', {}, 1, 18);
    const acronymInsideAPhrase = await searchResearchGroupsViaMeili('nlp history', {}, 1, 18);

    expect(topic.acronymRewrite).toBeUndefined();
    expect(carriedAcronym.acronymRewrite).toBeUndefined();
    expect(acronymInsideAPhrase.acronymRewrite).toBeUndefined();
  });

  it('keeps a spelling correction report separate from the acronym report', async () => {
    const result = await searchResearchGroupsViaMeili('imunology', {}, 1, 18);

    expect(result.queryCorrection).toEqual({
      originalQuery: 'imunology',
      correctedQuery: 'immunology',
    });
    expect(result.acronymRewrite).toBeUndefined();
  });
});

const CENTER_TITLE = 'Quiet Harbor Moss Institute';
const centerVocabulary = buildSearchSpellingVocabulary([
  ...Array.from({ length: 20 }, () => ({
    nameText: ['Example Lab'],
    bodyText: ['coastal ecology and the qhma estuary survey'],
    served: true,
  })),
  {
    nameText: [CENTER_TITLE],
    bodyText: ['coastal ecology'],
    served: true,
    titles: [CENTER_TITLE, CENTER_TITLE],
    entityType: 'INSTITUTE',
  },
]);

describe('a served center initialism is searched as the center title (#5169)', () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.search.mockResolvedValue({
      hits: [],
      estimatedTotalHits: 0,
      totalHits: 0,
      facetDistribution: {},
      processingTimeMs: 1,
    });
    mocks.getEmbedders.mockReset();
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.getResearchSearchQueryVector.mockReset();
    mocks.getResearchSearchQueryVector.mockResolvedValue({
      vector: [0.1, 0.2],
      semanticLegAffordable: true,
    });
    invalidateResearchEntitySearchEmbedderCache();
    setResearchSearchSpellingVocabularyForTests(centerVocabulary);
  });

  afterEach(() => setResearchSearchSpellingVocabularyForTests(null));

  it('reports the initialism as typed and the title it searched, uncorrected', async () => {
    const result = await searchResearchGroupsViaMeili('QHMI', {}, 1, 18);

    expect(searchedTexts()).toContain(CENTER_TITLE.toLowerCase());
    expect(searchedTexts().some((text) => text.toLowerCase().includes('qhm'))).toBe(false);
    expect(result.acronymRewrite).toEqual({ originalQuery: 'QHMI', rewrittenQuery: CENTER_TITLE });
    expect(result.queryCorrection).toBeUndefined();
  });

  it('searches the initialism itself, still uncorrected, when asked for it literally', async () => {
    const result = await searchResearchGroupsViaMeili(
      'qhmi',
      {},
      1,
      18,
      {},
      { rewriteAcronym: false },
    );

    expect(searchedTexts().length).toBeGreaterThan(0);
    expect(searchedTexts().every((text) => text.split(' ').includes('qhmi'))).toBe(true);
    expect(result.acronymRewrite).toBeUndefined();
    expect(result.queryCorrection).toBeUndefined();
  });

  it('leaves the initialism inside a longer query to normal search', async () => {
    const result = await searchResearchGroupsViaMeili('qhmi coastal ecology', {}, 1, 18);

    expect(searchedTexts()).not.toContain(CENTER_TITLE.toLowerCase());
    expect(result.acronymRewrite).toBeUndefined();
  });
});
