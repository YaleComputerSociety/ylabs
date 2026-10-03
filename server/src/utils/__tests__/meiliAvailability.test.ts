import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MEILISEARCH_UNAVAILABLE_COOLDOWN_MS,
  MeilisearchKnownUnavailableError,
  isMeiliUnreachableError,
  resetMeiliAvailability,
  withMeiliAvailability,
  withMeiliAvailabilityGuard,
} from '../meiliAvailability';

const timedOut = () =>
  Object.assign(new Error('Request has failed'), {
    name: 'MeilisearchRequestError',
    cause: Object.assign(new Error('request timed out after 5000ms'), {
      name: 'MeilisearchRequestTimeOutError',
    }),
  });

const apiRefusal = () =>
  Object.assign(new Error('The provided API key is invalid.'), { name: 'MeilisearchApiError' });

describe('Meilisearch availability breaker', () => {
  beforeEach(() => {
    resetMeiliAvailability();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-03T12:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies timeouts and connection failures as unreachable, and API answers as reachable', () => {
    expect(isMeiliUnreachableError(timedOut())).toBe(true);
    expect(
      isMeiliUnreachableError(
        Object.assign(new Error('fetch failed'), { name: 'MeilisearchRequestError' }),
      ),
    ).toBe(true);
    expect(isMeiliUnreachableError(apiRefusal())).toBe(false);
    expect(isMeiliUnreachableError(new Error('unrelated'))).toBe(false);
  });

  it('fails later calls fast after a timeout, then lets a call through once the cooldown passes', async () => {
    const call = vi.fn().mockRejectedValueOnce(timedOut()).mockResolvedValue('answered');

    await expect(withMeiliAvailability(call)).rejects.toThrow(/timed out|failed/);
    await expect(withMeiliAvailability(call)).rejects.toBeInstanceOf(
      MeilisearchKnownUnavailableError,
    );
    await expect(withMeiliAvailability(call)).rejects.toBeInstanceOf(
      MeilisearchKnownUnavailableError,
    );
    expect(call).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + MEILISEARCH_UNAVAILABLE_COOLDOWN_MS + 1);
    await expect(withMeiliAvailability(call)).resolves.toBe('answered');
    await expect(withMeiliAvailability(call)).resolves.toBe('answered');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('keeps calling after an API error, because Meilisearch answered', async () => {
    const call = vi.fn().mockRejectedValueOnce(apiRefusal()).mockResolvedValue('answered');

    await expect(withMeiliAvailability(call)).rejects.toThrow(/API key/);
    await expect(withMeiliAvailability(call)).resolves.toBe('answered');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('guards every method of an index and leaves it non-thenable', async () => {
    const index = { search: vi.fn().mockRejectedValue(timedOut()), getEmbedders: vi.fn() };
    const guarded = withMeiliAvailabilityGuard(index);

    expect((guarded as any).then).toBeUndefined();
    await expect(guarded.search('q')).rejects.toThrow();
    await expect(guarded.getEmbedders()).rejects.toBeInstanceOf(MeilisearchKnownUnavailableError);
    expect(index.getEmbedders).not.toHaveBeenCalled();
  });
});

describe('the embedder check while Meilisearch fails', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-03T12:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('remembers a failed check briefly and asks again once it expires', async () => {
    const {
      RESEARCH_ENTITY_SEARCH_EMBEDDER_UNKNOWN_CACHE_TTL_MS,
      invalidateResearchEntitySearchEmbedderCache,
      readResearchEntitySearchEmbedderState,
    } = await import('../../services/researchEntitySearchIndexService');
    invalidateResearchEntitySearchEmbedderCache();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const index = {
      getEmbedders: vi
        .fn()
        .mockRejectedValueOnce(apiRefusal())
        .mockResolvedValue({ default: { source: 'openAi' } }),
    };

    expect(await readResearchEntitySearchEmbedderState(index)).toBe('unknown');
    expect(await readResearchEntitySearchEmbedderState(index)).toBe('unknown');
    expect(await readResearchEntitySearchEmbedderState(index)).toBe('unknown');
    expect(index.getEmbedders).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + RESEARCH_ENTITY_SEARCH_EMBEDDER_UNKNOWN_CACHE_TTL_MS + 1);
    expect(await readResearchEntitySearchEmbedderState(index)).toBe('configured');
    expect(index.getEmbedders).toHaveBeenCalledTimes(2);
    invalidateResearchEntitySearchEmbedderCache();
  });
});
