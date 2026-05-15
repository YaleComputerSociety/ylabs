import { describe, expect, it, vi } from 'vitest';
import {
  ArxivPreprintScraper,
  arxivEntryToObservations,
  buildAuthorSearchQuery,
  normalizeArxivId,
  parseArxivFeed,
  shouldProcessFaculty,
  type ArxivFetcher,
} from '../sources/arxivPreprintScraper';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'arxiv',
    sourceWeight: 0.85,
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
    log: () => {},
  };
  return { ctx, emitted };
}

function buildThenableLeanQuery(rows: any[]) {
  const obj: any = {
    then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
      Promise.resolve(rows).then(resolve, reject),
    limit: (n: number) => buildThenableLeanQuery(rows.slice(0, n)),
  };
  return obj;
}

function mockUserModel(rows: any[]) {
  return {
    find: vi.fn(() => ({
      lean: () => buildThenableLeanQuery(rows),
      limit: (n: number) => ({ lean: () => buildThenableLeanQuery(rows.slice(0, n)) }),
    })) as any,
  };
}

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
  xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.01234v2</id>
    <updated>2024-02-03T00:00:00Z</updated>
    <published>2024-01-02T00:00:00Z</published>
    <title>
      A Fast Yale Preprint
    </title>
    <summary>
      A concise summary of the work.
    </summary>
    <author><name>Amy F Arnsten</name></author>
    <author><name>Other Author</name></author>
    <category term="cs.AI" />
    <category term="stat.ML" />
    <link href="http://arxiv.org/abs/2401.01234v2" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/2401.01234v2" rel="related" type="application/pdf" />
    <arxiv:doi>10.1000/example</arxiv:doi>
    <arxiv:journal_ref>Journal of Examples 1</arxiv:journal_ref>
  </entry>
</feed>`;

describe('normalizeArxivId', () => {
  it('strips arXiv URLs, prefixes, and version suffixes', () => {
    expect(normalizeArxivId('http://arxiv.org/abs/2401.01234v2')).toBe('2401.01234');
    expect(normalizeArxivId('arXiv:hep-th/9901001v1')).toBe('hep-th/9901001');
    expect(normalizeArxivId('  2401.01234  ')).toBe('2401.01234');
  });

  it('returns null for empty inputs', () => {
    expect(normalizeArxivId('')).toBeNull();
    expect(normalizeArxivId(undefined)).toBeNull();
  });
});

describe('buildAuthorSearchQuery', () => {
  it('builds a quoted arXiv author query', () => {
    expect(buildAuthorSearchQuery('Amy', 'Arnsten')).toBe('au:"Amy Arnsten"');
  });
});

describe('shouldProcessFaculty', () => {
  it('matches --only filters by netid, last name, or full name', () => {
    const fac = { netid: 'bs276', fname: 'Brian', lname: 'Scassellati' };
    expect(shouldProcessFaculty(fac, ['bs276'])).toBe(true);
    expect(shouldProcessFaculty(fac, ['scassellati'])).toBe(true);
    expect(shouldProcessFaculty(fac, ['brian scassellati'])).toBe(true);
    expect(shouldProcessFaculty(fac, ['someone else'])).toBe(false);
  });
});

describe('parseArxivFeed', () => {
  it('parses Atom entries into preprint metadata', () => {
    const entries = parseArxivFeed(SAMPLE_FEED);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      arxivId: '2401.01234',
      versionedArxivId: '2401.01234v2',
      title: 'A Fast Yale Preprint',
      authors: ['Amy F Arnsten', 'Other Author'],
      categories: ['cs.AI', 'stat.ML'],
      doi: '10.1000/example',
      journalRef: 'Journal of Examples 1',
      absUrl: 'https://arxiv.org/abs/2401.01234',
      pdfUrl: 'http://arxiv.org/pdf/2401.01234v2',
    });
    expect(entries[0].publishedAt?.toISOString()).toBe('2024-01-02T00:00:00.000Z');
    expect(entries[0].updatedAt?.toISOString()).toBe('2024-02-03T00:00:00.000Z');
  });
});

describe('arxivEntryToObservations', () => {
  it('emits Paper observations with preprint fields', () => {
    const [entry] = parseArxivFeed(SAMPLE_FEED);
    const obs = arxivEntryToObservations(entry);
    expect(obs.every((o) => o.entityType === 'paper')).toBe(true);
    expect(obs.every((o) => o.entityKey === '2401.01234')).toBe(true);
    expect(obs.find((o) => o.field === 'arxivId')?.value).toBe('2401.01234');
    expect(obs.find((o) => o.field === 'publicationStage')?.value).toBe('PREPRINT');
    expect(obs.find((o) => o.field === 'preprintServer')?.value).toBe('arxiv');
    expect(obs.find((o) => o.field === 'sources')?.value).toEqual(['arxiv']);
  });

  it('does not attach Yale authors from arXiv name-only matches', () => {
    const [entry] = parseArxivFeed(SAMPLE_FEED);
    const obs = arxivEntryToObservations(entry);

    expect(obs.some((o) => o.field === 'yaleAuthorIds')).toBe(false);
    expect(obs.some((o) => o.field === 'yaleAuthorNetIds')).toBe(false);
  });
});

describe('ArxivPreprintScraper.run', () => {
  it('emits paper metadata only when returned authors exactly match the Yale faculty name', async () => {
    const fetcher: ArxivFetcher = vi.fn(async () => SAMPLE_FEED);
    const userModel = mockUserModel([
      {
        _id: 'u-amy',
        netid: 'aa1',
        fname: 'Amy',
        lname: 'Arnsten',
      },
    ]);

    const scraper = new ArxivPreprintScraper({
      userModel,
      fetcher,
      requestDelayMs: 0,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        search_query: 'au:"Amy Arnsten"',
        sortBy: 'lastUpdatedDate',
        sortOrder: 'descending',
      }),
    );
    expect(emitted.some((o) => o.field === 'title' && o.value === 'A Fast Yale Preprint')).toBe(
      true,
    );
    expect(emitted.some((o) => o.field === 'yaleAuthorIds')).toBe(false);
    expect(emitted.some((o) => o.field === 'yaleAuthorNetIds')).toBe(false);
    expect(result.entitiesObserved).toBe(1);
  });

  it('filters out non-matching author names from ambiguous arXiv results', async () => {
    const feed = SAMPLE_FEED.replace('Amy F Arnsten', 'Amelia Arnsten');
    const fetcher: ArxivFetcher = vi.fn(async () => feed);
    const userModel = mockUserModel([
      {
        _id: 'u-amy',
        netid: 'aa1',
        fname: 'Amy',
        lname: 'Arnsten',
      },
    ]);

    const scraper = new ArxivPreprintScraper({
      userModel,
      fetcher,
      requestDelayMs: 0,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(result.entitiesObserved).toBe(0);
  });

  it('retries once when arXiv rate-limits a request', async () => {
    let calls = 0;
    const fetcher: ArxivFetcher = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        const err: any = new Error('Request failed with status code 429');
        err.response = { status: 429 };
        throw err;
      }
      return SAMPLE_FEED;
    });
    const userModel = mockUserModel([
      {
        _id: 'u-amy',
        netid: 'aa1',
        fname: 'Amy',
        lname: 'Arnsten',
      },
    ]);
    const sleep = vi.fn(async () => {});

    const scraper = new ArxivPreprintScraper({
      userModel,
      fetcher,
      sleep,
      requestDelayMs: 0,
      rateLimitRetryMs: 1,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1);
    expect(emitted.length).toBeGreaterThan(0);
    expect(result.fetchMetrics?.summary.succeeded).toBe(1);
    expect(result.fetchMetrics?.summary.failed).toBe(0);
  });

  it('honors --only before issuing arXiv requests', async () => {
    const fetcher: ArxivFetcher = vi.fn(async () => SAMPLE_FEED);
    const userModel = mockUserModel([
      {
        _id: 'u-amy',
        netid: 'aa1',
        fname: 'Amy',
        lname: 'Arnsten',
      },
      {
        _id: 'u-brian',
        netid: 'bs276',
        fname: 'Brian',
        lname: 'Scassellati',
      },
    ]);

    const scraper = new ArxivPreprintScraper({
      userModel,
      fetcher,
      requestDelayMs: 0,
    });
    const { ctx } = makeContext({ only: ['aa1'] });
    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ search_query: 'au:"Amy Arnsten"' }));
    expect(result.notes).toContain('Faculty processed: 1');
  });
});
