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
    bodyText: ['prosthetic hand design, particle detectors and coastal ecology'],
    served: true,
  })),
);

const searchedTexts = (): string[] => mocks.search.mock.calls.map(([text]) => String(text));

describe('a sentence-shaped search reports the topic it searched, and can be run as typed (#6223)', () => {
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

  it('searches the topic and reports the query as typed beside it', async () => {
    const result = await searchResearchGroupsViaMeili('design a better prosthetic hand', {}, 1, 18);

    expect(searchedTexts().length).toBeGreaterThan(0);
    expect(searchedTexts().every((text) => !/\bdesign\b|\bbetter\b/.test(text))).toBe(true);
    expect(searchedTexts()).toContain('prosthetic hand');
    expect(result.topicRewrite).toEqual({
      originalQuery: 'design a better prosthetic hand',
      topicQuery: 'prosthetic hand',
    });
  });

  it('searches the sentence as typed when the caller asks for it', async () => {
    const result = await searchResearchGroupsViaMeili(
      'design a better prosthetic hand',
      {},
      1,
      18,
      {},
      { extractSentenceTopic: false },
    );

    expect(searchedTexts()).not.toContain('prosthetic hand');
    expect(searchedTexts().some((text) => /\bdesign\b/.test(text))).toBe(true);
    expect(result.topicRewrite).toBeUndefined();
  });

  it('leaves short topic queries and questions untouched', async () => {
    const short = await searchResearchGroupsViaMeili('particle detectors', {}, 1, 18);
    const question = await searchResearchGroupsViaMeili('why do glaciers melt so fast', {}, 1, 18);

    expect(short.topicRewrite).toBeUndefined();
    expect(question.topicRewrite).toBeUndefined();
  });
});
