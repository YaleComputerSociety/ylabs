import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getResearchSearchQueryVector: vi.fn(),
  search: vi.fn(),
  getEmbedders: vi.fn(),
}));

vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
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
    bodyText: ['immunology and organic chemistry, ergo'],
    served: true,
  })),
);

const searchedTexts = (): string[] => mocks.search.mock.calls.map(([text]) => String(text));

describe('a misspelled query word is searched as the corpus word it was meant to be (#4536)', () => {
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

  it('sends the corrected word to every search and to the query embedding', async () => {
    await searchResearchGroupsViaMeili('imunology', {}, 1, 18);

    expect(searchedTexts().length).toBeGreaterThan(0);
    expect(searchedTexts().every((text) => text === 'immunology')).toBe(true);
    expect(mocks.getResearchSearchQueryVector).toHaveBeenCalledWith('immunology', undefined);
  });

  it('reports what was typed and what was searched', async () => {
    const result = await searchResearchGroupsViaMeili('imunology', {}, 1, 18);

    expect(result.queryCorrection).toEqual({
      originalQuery: 'imunology',
      correctedQuery: 'immunology',
    });
  });

  it('searches the words as typed when the caller asks for the original spelling', async () => {
    const result = await searchResearchGroupsViaMeili(
      'imunology',
      {},
      1,
      18,
      {},
      {
        correctSpelling: false,
      },
    );

    expect(searchedTexts().every((text) => text === 'imunology')).toBe(true);
    expect(result.queryCorrection).toBeUndefined();
  });

  it('reports no correction for a correctly spelled query', async () => {
    const result = await searchResearchGroupsViaMeili('immunology', {}, 1, 18);

    expect(result.queryCorrection).toBeUndefined();
  });

  it('leaves a shorthand the alias layer expands untouched, though a corpus word is one edit away', async () => {
    const result = await searchResearchGroupsViaMeili('orgo', {}, 1, 18);

    expect(result.queryCorrection).toBeUndefined();
    expect(searchedTexts().some((text) => text.includes('ergo'))).toBe(false);
  });

  it('searches as typed when no vocabulary has loaded yet', async () => {
    setResearchSearchSpellingVocabularyForTests(null);

    const result = await searchResearchGroupsViaMeili('imunology', {}, 1, 18);

    expect(searchedTexts().every((text) => text === 'imunology')).toBe(true);
    expect(result.queryCorrection).toBeUndefined();
  });
});
