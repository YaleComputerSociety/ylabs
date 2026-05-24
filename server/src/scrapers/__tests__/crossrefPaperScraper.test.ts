import { describe, expect, it, vi } from 'vitest';
import { CrossrefPaperScraper, type CrossrefFetcher } from '../sources/crossrefPaperScraper';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'crossref',
    sourceWeight: 0.9,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: (message) => {
      logs.push(message);
    },
  };
  return { ctx, emitted, logs };
}

function mockLinkModel(rows: any[]) {
  return {
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(rows),
    })) as any,
  };
}

describe('CrossrefPaperScraper compact scholarly-link hydration', () => {
  it('hydrates DOI-backed compact scholarly links without changing original discovery source', async () => {
    const linkId = '64f000000000000000000111';
    const linkModel = mockLinkModel([
      {
        _id: linkId,
        userId: '64f000000000000000000001',
        title: 'OpenAlex title',
        url: 'https://openalex.org/W123',
        destinationKind: 'OPENALEX',
        displaySource: 'OpenAlex record',
        discoveredVia: 'OPENALEX',
        externalIds: { doi: '10.1000/ABC' },
      },
    ]);
    const fetcher: CrossrefFetcher = vi.fn(async () => ({
      message: {
        DOI: '10.1000/abc',
        title: ['Crossref title'],
        published: { 'date-parts': [[2024, 5, 1]] },
        'container-title': ['Journal of Compact Links'],
        URL: 'https://doi.org/10.1000/abc',
        type: 'journal-article',
        link: [
          {
            URL: 'https://publisher.example.org/article.pdf',
            'content-type': 'application/pdf',
          },
        ],
      },
    }));
    const scraper = new CrossrefPaperScraper({ paperModel: linkModel, fetcher });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith('10.1000/abc');
    expect(result.entitiesObserved).toBe(1);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'scholarlyLink',
          entityId: linkId,
          entityKey: 'doi:10.1000/abc',
          field: 'title',
          value: 'Crossref title',
        }),
        expect.objectContaining({
          field: 'url',
          value: 'https://doi.org/10.1000/abc',
        }),
        expect.objectContaining({
          field: 'destinationKind',
          value: 'DOI',
        }),
        expect.objectContaining({
          field: 'discoveredVia',
          value: 'OPENALEX',
        }),
        expect.objectContaining({
          field: 'crossrefHydratedAt',
        }),
        expect.objectContaining({
          field: 'freeFullTextUrl',
          value: 'https://publisher.example.org/article.pdf',
        }),
      ]),
    );
    expect(emitted.some((obs) => obs.entityType === 'paper')).toBe(false);
  });

  it('skips Crossref correction and table-of-contents records', async () => {
    const linkModel = mockLinkModel([
      {
        _id: '64f000000000000000000112',
        title: 'Original title',
        url: 'https://doi.org/10.1000/correction',
        destinationKind: 'DOI',
        displaySource: 'DOI',
        discoveredVia: 'ORCID',
        externalIds: { doi: '10.1000/correction' },
      },
    ]);
    const fetcher: CrossrefFetcher = vi.fn(async () => ({
      message: {
        DOI: '10.1000/correction',
        title: ['Correction: Table of contents'],
        URL: 'https://doi.org/10.1000/correction',
        type: 'correction',
      },
    }));
    const scraper = new CrossrefPaperScraper({ paperModel: linkModel, fetcher });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('skips arXiv DOI links because Crossref does not hydrate 10.48550/arxiv records', async () => {
    const linkModel = mockLinkModel([
      {
        _id: '64f000000000000000000113',
        title: 'arXiv preprint',
        url: 'https://doi.org/10.48550/arxiv.2604.01023',
        discoveredVia: 'OPENALEX',
        externalIds: { doi: '10.48550/arxiv.2604.01023' },
      },
      {
        _id: '64f000000000000000000114',
        title: 'Journal article',
        url: 'https://doi.org/10.1000/article',
        discoveredVia: 'ORCID',
        externalIds: { doi: '10.1000/article' },
      },
    ]);
    const fetcher: CrossrefFetcher = vi.fn(async () => ({
      message: {
        DOI: '10.1000/article',
        title: ['Journal article'],
        URL: 'https://doi.org/10.1000/article',
        type: 'journal-article',
      },
    }));
    const scraper = new CrossrefPaperScraper({ paperModel: linkModel, fetcher });
    const { ctx } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('10.1000/article');
    expect(result.notes).toContain('(0 failures)');
  });

  it('escapes DOI values when building --only URL filters', async () => {
    const linkModel = mockLinkModel([]);
    const fetcher: CrossrefFetcher = vi.fn();
    const scraper = new CrossrefPaperScraper({ paperModel: linkModel, fetcher });
    const { ctx } = makeContext({ only: ['10.1000/example'] });

    await scraper.run(ctx);

    const filter = linkModel.find.mock.calls[0][0];
    const urlClause = filter.$or.find((clause: any) => clause.url instanceof RegExp);
    expect(urlClause.url.test('https://doi.org/10.1000/example')).toBe(true);
    expect(urlClause.url.test('https://doi.org/10x1000/example')).toBe(false);
  });

  it('retries 429 responses with bounded Retry-After backoff', async () => {
    const linkModel = mockLinkModel([
      {
        _id: '64f000000000000000000115',
        title: 'Needs Crossref',
        url: 'https://doi.org/10.1000/rate-limited',
        discoveredVia: 'OPENALEX',
        externalIds: { doi: '10.1000/rate-limited' },
      },
    ]);
    const fetcher: CrossrefFetcher = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 429'), {
          response: { status: 429, headers: { 'retry-after': '7' } },
        }),
      )
      .mockResolvedValueOnce({
        message: {
          DOI: '10.1000/rate-limited',
          title: ['Recovered article'],
          URL: 'https://doi.org/10.1000/rate-limited',
          type: 'journal-article',
        },
      });
    const sleep = vi.fn(async () => {});
    const scraper = new CrossrefPaperScraper({
      paperModel: linkModel,
      fetcher,
      sleep,
      maxRateLimitRetries: 1,
      rateLimitRetryMs: 1,
      maxRetryAfterMs: 5,
    });
    const { ctx, emitted, logs } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
    expect(logs.some((line) => /Crossref rate-limited 10\.1000\/rate-limited/.test(line))).toBe(
      true,
    );
    expect(result.entitiesObserved).toBe(1);
    expect(result.notes).toContain('(0 failures)');
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'scholarlyLink',
          field: 'title',
          value: 'Recovered article',
        }),
      ]),
    );
  });

  it('does not retry permanent 404 responses', async () => {
    const linkModel = mockLinkModel([
      {
        _id: '64f000000000000000000116',
        title: 'Missing Crossref DOI',
        url: 'https://doi.org/10.1000/missing',
        discoveredVia: 'ORCID',
        externalIds: { doi: '10.1000/missing' },
      },
    ]);
    const fetcher: CrossrefFetcher = vi.fn(async () => {
      const err: any = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    });
    const sleep = vi.fn(async () => {});
    const scraper = new CrossrefPaperScraper({
      paperModel: linkModel,
      fetcher,
      sleep,
      maxRateLimitRetries: 2,
      rateLimitRetryMs: 1,
      requestDelayMs: 0,
    });
    const { ctx, emitted, logs } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toContain('(1 failures)');
    expect(emitted).toEqual([]);
    expect(logs.some((line) => /Crossref fetch failed for 10\.1000\/missing/.test(line))).toBe(
      true,
    );
  });
});
