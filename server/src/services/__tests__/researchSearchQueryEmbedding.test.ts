import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: mocks.post },
}));

import {
  clearResearchSearchQueryEmbeddingCache,
  getResearchSearchQueryVector,
  researchSearchQueryEmbeddingCacheSize,
} from '../researchSearchQueryEmbedding';

const embeddingResponse = (vector: number[]) => ({ data: { data: [{ embedding: vector }] } });

const originalApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mocks.post.mockReset();
  clearResearchSearchQueryEmbeddingCache();
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe('getResearchSearchQueryVector', () => {
  it('embeds a query once and serves every repeat from the cache', async () => {
    mocks.post.mockResolvedValue(embeddingResponse([0.1, 0.2, 0.3]));

    const first = await getResearchSearchQueryVector('machine learning');
    const second = await getResearchSearchQueryVector('machine learning');

    expect(first).toEqual([0.1, 0.2, 0.3]);
    expect(second).toEqual([0.1, 0.2, 0.3]);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0][1]).toEqual({
      model: 'text-embedding-3-small',
      input: 'machine learning',
    });
  });

  it('collapses concurrent requests for the same query into one embedding call', async () => {
    let resolveEmbedding: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(
      new Promise((resolve) => {
        resolveEmbedding = resolve;
      }),
    );

    const pending = Promise.all([
      getResearchSearchQueryVector('protein folding'),
      getResearchSearchQueryVector('protein folding'),
      getResearchSearchQueryVector('protein folding'),
    ]);
    resolveEmbedding(embeddingResponse([0.4, 0.5]));

    expect(await pending).toEqual([
      [0.4, 0.5],
      [0.4, 0.5],
      [0.4, 0.5],
    ]);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct queries apart', async () => {
    mocks.post
      .mockResolvedValueOnce(embeddingResponse([1]))
      .mockResolvedValueOnce(embeddingResponse([2]));

    expect(await getResearchSearchQueryVector('cancer')).toEqual([1]);
    expect(await getResearchSearchQueryVector('immunology')).toEqual([2]);
    expect(researchSearchQueryEmbeddingCacheSize()).toBe(2);
  });

  it('returns null without calling OpenAI when no key is configured', async () => {
    delete process.env.OPENAI_API_KEY;

    expect(await getResearchSearchQueryVector('cancer')).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('returns null for a blank query', async () => {
    expect(await getResearchSearchQueryVector('')).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('returns null and caches nothing when the embedding request fails', async () => {
    mocks.post.mockRejectedValue(new Error('gateway timeout'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await getResearchSearchQueryVector('cancer')).toBeNull();
    expect(researchSearchQueryEmbeddingCacheSize()).toBe(0);

    mocks.post.mockResolvedValue(embeddingResponse([0.9]));
    expect(await getResearchSearchQueryVector('cancer')).toEqual([0.9]);
    consoleError.mockRestore();
  });

  it('returns null when the response carries no usable vector', async () => {
    mocks.post.mockResolvedValue({ data: { data: [{ embedding: [] }] } });

    expect(await getResearchSearchQueryVector('cancer')).toBeNull();
  });

  it('bounds the cache by evicting the least recently used query', async () => {
    mocks.post.mockImplementation(async (_url: string, body: { input: string }) =>
      embeddingResponse([body.input.length]),
    );

    for (let index = 0; index < 500; index += 1) {
      await getResearchSearchQueryVector(`query-${index}`);
    }
    expect(researchSearchQueryEmbeddingCacheSize()).toBe(500);

    await getResearchSearchQueryVector('query-0');
    await getResearchSearchQueryVector('one-more-query');
    expect(researchSearchQueryEmbeddingCacheSize()).toBe(500);

    mocks.post.mockClear();
    await getResearchSearchQueryVector('query-0');
    expect(mocks.post).not.toHaveBeenCalled();
    await getResearchSearchQueryVector('query-1');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
