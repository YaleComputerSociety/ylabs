import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CenterAffiliationLLMExtractor } from '../sources/centerAffiliationLLMExtractor';
import { CenterDirectorLLMExtractor } from '../sources/centerDirectorLLMExtractor';
import { ResearchAreaSourceExtractor } from '../sources/researchAreaSourceExtractor';
import type { ResearchAreaCanonicalizer } from '../researchAreaCanonicalization';
import type { ScraperContext } from '../types';

const METADATA_URL = 'http://169.254.169.254/latest/meta-data/';
const PRIVATE_ADDRESS_REFUSAL = 'URL resolves to a private or non-public address';

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'test-source',
    sourceWeight: 0.6,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async () => {},
    log: (message) => {
      logs.push(message);
    },
  };
  return { ctx, logs };
}

describe('LLM center and research-area lanes refuse a private page URL before any request', () => {
  let networkCalls: ReturnType<typeof vi.fn<() => Promise<never>>>;

  beforeEach(() => {
    networkCalls = vi.fn(async (): Promise<never> => {
      throw new Error('network request attempted');
    });
    vi.spyOn(axios, 'get').mockImplementation(networkCalls);
    vi.spyOn(axios, 'request').mockImplementation(networkCalls);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('center affiliation lane', async () => {
    const callLLM = vi.fn();
    const scraper = new CenterAffiliationLLMExtractor({
      callLLM,
      centerFinder: async () => [
        { _id: 'c1', slug: 'center-fixture', name: 'Fixture Center', websiteUrl: METADATA_URL },
      ],
      liveClaimFinder: async () => [],
      apiKey: 'test-key',
    });
    const { ctx, logs } = makeContext();

    const result = await scraper.run(ctx);

    expect(networkCalls).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(0);
    expect(logs.some((line) => line.includes(PRIVATE_ADDRESS_REFUSAL))).toBe(true);
  });

  it('center director lane', async () => {
    const callLLM = vi.fn();
    const scraper = new CenterDirectorLLMExtractor({ callLLM, apiKey: 'test-key' });
    const logs: string[] = [];

    const result = await scraper.extractDirectorForCenter(
      { _id: 'c1', slug: 'center-fixture', name: 'Fixture Center', websiteUrl: METADATA_URL },
      (message) => logs.push(message),
    );

    expect(result).toBeNull();
    expect(networkCalls).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes(PRIVATE_ADDRESS_REFUSAL))).toBe(true);
  });

  it('research-area source lane', async () => {
    const extractor = new ResearchAreaSourceExtractor({
      canonicalizerLoader: async () => ({}) as ResearchAreaCanonicalizer,
      entityFinder: async () => [
        {
          _id: 'e1',
          slug: 'faculty-fixture',
          name: 'Fixture Faculty',
          websiteUrl: METADATA_URL,
          sourceUrls: [],
        },
      ],
    });
    const { ctx, logs } = makeContext({ ignoreWorkPlanner: true });

    const result = await extractor.run(ctx);

    expect(networkCalls).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(0);
    expect(logs.some((line) => line.includes(PRIVATE_ADDRESS_REFUSAL))).toBe(true);
  });
});
