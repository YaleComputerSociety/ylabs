import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  recordResearchSearchQueryEmbeddingFailure,
  recordResearchSearchQueryEmbeddingSuccess,
  researchSearchQueryEmbeddingBudgetLimits,
  researchSearchQueryEmbeddingBudgetSnapshot,
  reserveResearchSearchQueryEmbedding,
  resetResearchSearchQueryEmbeddingBudget,
} from '../researchSearchQueryEmbeddingBudget';

const CLIENT = '203.0.113.7';
const START = 1_800_000_000_000;

beforeEach(() => {
  resetResearchSearchQueryEmbeddingBudget();
});

afterEach(() => {
  delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE;
  delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE;
  delete process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS;
  resetResearchSearchQueryEmbeddingBudget();
});

describe('the configured limits', () => {
  it('carries defaults that bound a window without reaching ordinary traffic', () => {
    expect(researchSearchQueryEmbeddingBudgetLimits()).toEqual({
      maxPerWindow: 600,
      maxPerClientPerWindow: 120,
      cooldownMs: 60_000,
      windowMs: 60_000,
    });
  });

  it('takes an override', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = '900';
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '300';
    process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS = '120000';

    expect(researchSearchQueryEmbeddingBudgetLimits()).toMatchObject({
      maxPerWindow: 900,
      maxPerClientPerWindow: 300,
      cooldownMs: 120_000,
    });
  });

  it('floors an override that would switch the semantic leg off for everyone', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = '1';
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '1';
    process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS = '1';

    expect(researchSearchQueryEmbeddingBudgetLimits()).toMatchObject({
      maxPerWindow: 60,
      maxPerClientPerWindow: 10,
      cooldownMs: 1_000,
    });
  });

  it('falls back to the default for an unparseable override', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = 'lots';

    expect(researchSearchQueryEmbeddingBudgetLimits().maxPerWindow).toBe(600);
  });
});

describe('reserving a call', () => {
  it('names the bound that refused it', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    for (let index = 0; index < 10; index += 1) {
      expect(reserveResearchSearchQueryEmbedding(CLIENT, START)).toBe('allowed');
    }

    expect(reserveResearchSearchQueryEmbedding(CLIENT, START)).toBe('client-ceiling');
  });

  it('refuses a client the window ceiling has already exhausted', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = '60';
    for (let index = 0; index < 60; index += 1) {
      reserveResearchSearchQueryEmbedding(`203.0.113.${index}`, START);
    }

    expect(reserveResearchSearchQueryEmbedding('198.51.100.4', START)).toBe('window-ceiling');
  });

  it('restores both ceilings when the window rolls', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = '60';
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    for (let index = 0; index < 60; index += 1) {
      reserveResearchSearchQueryEmbedding(CLIENT, START);
    }
    expect(reserveResearchSearchQueryEmbedding(CLIENT, START)).toBe('client-ceiling');

    expect(reserveResearchSearchQueryEmbedding(CLIENT, START + 60_000)).toBe('allowed');
    expect(researchSearchQueryEmbeddingBudgetSnapshot(START + 60_000).spentInWindow).toBe(1);
  });

  it('exempts an in-process caller from both ceilings and charges it nothing', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = '60';
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    for (let index = 0; index < 80; index += 1) {
      expect(reserveResearchSearchQueryEmbedding(undefined, START)).toBe('allowed');
    }

    expect(researchSearchQueryEmbeddingBudgetSnapshot(START)).toMatchObject({
      trackedClients: 0,
      spentInWindow: 0,
    });
  });

  it('treats a blank client key as an in-process caller rather than as one bucket', () => {
    expect(reserveResearchSearchQueryEmbedding('', START)).toBe('allowed');

    expect(researchSearchQueryEmbeddingBudgetSnapshot(START).trackedClients).toBe(0);
  });

  it('cannot track more clients than the window ceiling allows calls', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE = '60';
    for (let index = 0; index < 500; index += 1) {
      reserveResearchSearchQueryEmbedding(`203.0.113.${index}`, START);
    }

    expect(researchSearchQueryEmbeddingBudgetSnapshot(START).trackedClients).toBe(60);
  });
});

describe('the breaker', () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it('opens on an upstream rejection and closes when the cooldown passes', () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS = '30000';

    recordResearchSearchQueryEmbeddingFailure('upstream-rejected', START);

    expect(reserveResearchSearchQueryEmbedding(CLIENT, START + 1)).toBe('cooling-down');
    expect(reserveResearchSearchQueryEmbedding(CLIENT, START + 29_999)).toBe('cooling-down');
    expect(reserveResearchSearchQueryEmbedding(CLIENT, START + 30_000)).toBe('allowed');
  });

  it('opens only once ordinary failures repeat', () => {
    for (let index = 0; index < 4; index += 1) {
      recordResearchSearchQueryEmbeddingFailure('error', START);
    }
    expect(reserveResearchSearchQueryEmbedding(CLIENT, START)).toBe('allowed');

    recordResearchSearchQueryEmbeddingFailure('error', START);

    expect(reserveResearchSearchQueryEmbedding(CLIENT, START)).toBe('cooling-down');
  });

  it('forgets earlier failures after a success', () => {
    for (let index = 0; index < 4; index += 1) {
      recordResearchSearchQueryEmbeddingFailure('error', START);
    }
    recordResearchSearchQueryEmbeddingSuccess();

    for (let index = 0; index < 4; index += 1) {
      recordResearchSearchQueryEmbeddingFailure('error', START);
    }

    expect(reserveResearchSearchQueryEmbedding(CLIENT, START)).toBe('allowed');
  });

  it('does not spend a call while it is open', () => {
    recordResearchSearchQueryEmbeddingFailure('upstream-rejected', START);

    reserveResearchSearchQueryEmbedding(CLIENT, START + 1);

    expect(researchSearchQueryEmbeddingBudgetSnapshot(START + 1).spentInWindow).toBe(0);
  });
});
