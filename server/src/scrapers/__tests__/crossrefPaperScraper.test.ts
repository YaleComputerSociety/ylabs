import { describe, expect, it, vi } from 'vitest';
import { CrossrefPaperScraper, type CrossrefFetcher } from '../sources/crossrefPaperScraper';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'crossref',
    sourceWeight: 0.8,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

function mockPaperModel(rows: any[]) {
  const chain = {
    sort: vi.fn(() => chain),
    skip: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    lean: vi.fn(async () => rows),
  };
  return {
    find: vi.fn(() => chain) as any,
  };
}

const crossrefPayload = {
  message: {
    DOI: '10.1000/example',
    title: ['A Crossref paper'],
    issued: { 'date-parts': [[2024, 1, 2]] },
    'container-title': ['Journal of Testable Metadata'],
    URL: 'https://doi.org/10.1000/example',
  },
};

describe('CrossrefPaperScraper', () => {
  it('rejects unsafe runtime offsets before querying papers', async () => {
    const paperModel = mockPaperModel([{ doi: '10.1000/example' }]);
    const fetcher: CrossrefFetcher = vi.fn(async () => crossrefPayload);
    const scraper = new CrossrefPaperScraper({ paperModel, fetcher });
    const { ctx } = makeContext();
    ctx.options.offset = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--offset must be a safe non-negative integer/);

    expect(paperModel.find).not.toHaveBeenCalled();
  });

  it('rejects unsafe runtime limits before querying papers', async () => {
    const paperModel = mockPaperModel([{ doi: '10.1000/example' }]);
    const fetcher: CrossrefFetcher = vi.fn(async () => crossrefPayload);
    const scraper = new CrossrefPaperScraper({ paperModel, fetcher });
    const { ctx } = makeContext();
    ctx.options.limit = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);

    expect(paperModel.find).not.toHaveBeenCalled();
  });
});
