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
import {
  researchSearchQueryEmbeddingBudgetSnapshot,
  resetResearchSearchQueryEmbeddingBudget,
} from '../researchSearchQueryEmbeddingBudget';

const embeddingResponse = (vector: number[]) => ({ data: { data: [{ embedding: vector }] } });

const originalApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mocks.post.mockReset();
  clearResearchSearchQueryEmbeddingCache();
  resetResearchSearchQueryEmbeddingBudget();
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

    expect(first).toEqual({ vector: [0.1, 0.2, 0.3], semanticLegAffordable: true });
    expect(second).toEqual({ vector: [0.1, 0.2, 0.3], semanticLegAffordable: true });
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

    expect((await pending).map((outcome) => outcome.vector)).toEqual([
      [0.4, 0.5],
      [0.4, 0.5],
      [0.4, 0.5],
    ]);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('charges the budget once for a query three callers ask for at the same time', async () => {
    let resolveEmbedding: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(
      new Promise((resolve) => {
        resolveEmbedding = resolve;
      }),
    );

    const pending = Promise.all([
      getResearchSearchQueryVector('protein folding', '203.0.113.7'),
      getResearchSearchQueryVector('protein folding', '203.0.113.7'),
      getResearchSearchQueryVector('protein folding', '203.0.113.7'),
    ]);
    resolveEmbedding(embeddingResponse([0.4, 0.5]));
    await pending;

    expect(researchSearchQueryEmbeddingBudgetSnapshot().spentInWindow).toBe(1);
  });

  it('keeps distinct queries apart', async () => {
    mocks.post
      .mockResolvedValueOnce(embeddingResponse([1]))
      .mockResolvedValueOnce(embeddingResponse([2]));

    expect((await getResearchSearchQueryVector('cancer')).vector).toEqual([1]);
    expect((await getResearchSearchQueryVector('immunology')).vector).toEqual([2]);
    expect(researchSearchQueryEmbeddingCacheSize()).toBe(2);
  });

  it('serves a casing or spacing variant of a cached query from the cache', async () => {
    mocks.post.mockResolvedValue(embeddingResponse([0.7]));

    const typed = await getResearchSearchQueryVector('Protein  Folding');
    const variant = await getResearchSearchQueryVector('protein folding');

    expect(typed.vector).toEqual([0.7]);
    expect(variant.vector).toEqual([0.7]);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    // The text sent upstream is the text the search sends as `q`, because rank
    // equivalence with Meilisearch's own embedder is only claimed for that text.
    expect(mocks.post.mock.calls[0][1].input).toBe('Protein  Folding');
  });

  it('serves the semantic leg without an upstream call when no key is configured', async () => {
    delete process.env.OPENAI_API_KEY;

    expect(await getResearchSearchQueryVector('cancer')).toEqual({
      vector: null,
      semanticLegAffordable: true,
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('returns null for a blank query and spends nothing', async () => {
    expect(await getResearchSearchQueryVector('   ')).toEqual({
      vector: null,
      semanticLegAffordable: true,
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(researchSearchQueryEmbeddingBudgetSnapshot().spentInWindow).toBe(0);
  });

  it('keeps the semantic leg affordable and caches nothing when one request fails', async () => {
    mocks.post.mockRejectedValue(new Error('gateway timeout'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await getResearchSearchQueryVector('cancer')).toEqual({
      vector: null,
      semanticLegAffordable: true,
    });
    expect(researchSearchQueryEmbeddingCacheSize()).toBe(0);

    mocks.post.mockResolvedValue(embeddingResponse([0.9]));
    expect((await getResearchSearchQueryVector('cancer')).vector).toEqual([0.9]);
    consoleError.mockRestore();
  });

  it('returns null when the response carries no usable vector', async () => {
    mocks.post.mockResolvedValue({ data: { data: [{ embedding: [] }] } });

    expect((await getResearchSearchQueryVector('cancer')).vector).toBeNull();
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

describe('the query embedding budget seen through getResearchSearchQueryVector', () => {
  it('refuses the semantic leg and makes no upstream call once one client is over its ceiling', async () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    mocks.post.mockImplementation(async (_url: string, body: { input: string }) =>
      embeddingResponse([body.input.length]),
    );
    try {
      for (let index = 0; index < 10; index += 1) {
        const allowed = await getResearchSearchQueryVector(`budget-${index}`, '203.0.113.7');
        expect(allowed.semanticLegAffordable).toBe(true);
      }
      mocks.post.mockClear();

      const refused = await getResearchSearchQueryVector('budget-over', '203.0.113.7');

      expect(refused).toEqual({ vector: null, semanticLegAffordable: false });
      expect(mocks.post).not.toHaveBeenCalled();
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE;
    }
  });

  it('still serves a cached query to a client that is over its ceiling', async () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    mocks.post.mockImplementation(async (_url: string, body: { input: string }) =>
      embeddingResponse([body.input.length]),
    );
    try {
      for (let index = 0; index < 10; index += 1) {
        await getResearchSearchQueryVector(`budget-${index}`, '203.0.113.7');
      }

      const cached = await getResearchSearchQueryVector('budget-0', '203.0.113.7');

      expect(cached.semanticLegAffordable).toBe(true);
      expect(cached.vector).toEqual([8]);
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE;
    }
  });

  it('leaves a second client its own ceiling', async () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    mocks.post.mockImplementation(async (_url: string, body: { input: string }) =>
      embeddingResponse([body.input.length]),
    );
    try {
      for (let index = 0; index < 10; index += 1) {
        await getResearchSearchQueryVector(`budget-${index}`, '203.0.113.7');
      }

      const other = await getResearchSearchQueryVector('budget-over', '198.51.100.4');

      expect(other.semanticLegAffordable).toBe(true);
      expect(other.vector).toEqual([11]);
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE;
    }
  });

  it('refuses every client once the window ceiling is reached', async () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = '60';
    mocks.post.mockImplementation(async (_url: string, body: { input: string }) =>
      embeddingResponse([body.input.length]),
    );
    try {
      for (let index = 0; index < 60; index += 1) {
        await getResearchSearchQueryVector(`window-${index}`, `203.0.113.${index}`);
      }
      mocks.post.mockClear();

      const refused = await getResearchSearchQueryVector('window-over', '198.51.100.4');

      expect(refused).toEqual({ vector: null, semanticLegAffordable: false });
      expect(mocks.post).not.toHaveBeenCalled();
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE;
    }
  });

  it('meters an in-process caller with no client key against the window ceiling only', async () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    mocks.post.mockImplementation(async (_url: string, body: { input: string }) =>
      embeddingResponse([body.input.length]),
    );
    try {
      for (let index = 0; index < 20; index += 1) {
        const outcome = await getResearchSearchQueryVector(`unkeyed-${index}`);
        expect(outcome.semanticLegAffordable).toBe(true);
      }

      expect(researchSearchQueryEmbeddingBudgetSnapshot().trackedClients).toBe(0);
      expect(researchSearchQueryEmbeddingBudgetSnapshot().spentInWindow).toBe(20);
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE;
    }
  });
});

describe('the breaker seen through getResearchSearchQueryVector', () => {
  const rejection = (status: number) =>
    Object.assign(new Error('rejected'), { response: { status } });

  it('stops calling upstream after a rejection and resumes once the cooldown passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS = '30000';
    try {
      mocks.post.mockRejectedValueOnce(rejection(429));
      expect(await getResearchSearchQueryVector('cooldown-first', '203.0.113.7')).toEqual({
        vector: null,
        semanticLegAffordable: true,
      });

      mocks.post.mockClear();
      mocks.post.mockResolvedValue(embeddingResponse([0.3]));
      vi.setSystemTime(new Date('2026-09-30T00:00:10Z'));
      expect(await getResearchSearchQueryVector('cooldown-during', '203.0.113.7')).toEqual({
        vector: null,
        semanticLegAffordable: false,
      });
      expect(mocks.post).not.toHaveBeenCalled();

      vi.setSystemTime(new Date('2026-09-30T00:00:31Z'));
      expect(await getResearchSearchQueryVector('cooldown-after', '203.0.113.7')).toEqual({
        vector: [0.3],
        semanticLegAffordable: true,
      });
      expect(mocks.post).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS;
      consoleError.mockRestore();
      consoleWarn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps calling through a single ordinary failure and stops only once they repeat', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mocks.post.mockRejectedValue(new Error('gateway timeout'));
      for (let index = 0; index < 4; index += 1) {
        expect(
          (await getResearchSearchQueryVector(`repeat-${index}`, '203.0.113.7'))
            .semanticLegAffordable,
        ).toBe(true);
      }
      expect(mocks.post).toHaveBeenCalledTimes(4);

      expect(
        (await getResearchSearchQueryVector('repeat-4', '203.0.113.7')).semanticLegAffordable,
      ).toBe(true);
      mocks.post.mockClear();

      expect(await getResearchSearchQueryVector('repeat-5', '203.0.113.7')).toEqual({
        vector: null,
        semanticLegAffordable: false,
      });
      expect(mocks.post).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it('forgets earlier failures once a call succeeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mocks.post.mockRejectedValue(new Error('gateway timeout'));
      for (let index = 0; index < 4; index += 1) {
        await getResearchSearchQueryVector(`forget-${index}`, '203.0.113.7');
      }

      mocks.post.mockResolvedValueOnce(embeddingResponse([0.5]));
      expect((await getResearchSearchQueryVector('forget-ok', '203.0.113.7')).vector).toEqual([
        0.5,
      ]);

      mocks.post.mockRejectedValue(new Error('gateway timeout'));
      for (let index = 0; index < 4; index += 1) {
        expect(
          (await getResearchSearchQueryVector(`forget-again-${index}`, '203.0.113.7'))
            .semanticLegAffordable,
        ).toBe(true);
      }
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });
});
