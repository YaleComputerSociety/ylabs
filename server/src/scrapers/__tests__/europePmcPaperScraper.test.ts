import { describe, expect, it, vi } from 'vitest';
import {
  EuropePmcPaperScraper,
  PubMedPaperScraper,
  type EuropePmcFetcher,
} from '../sources/europePmcPaperScraper';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(sourceName: 'europe-pmc' | 'pubmed') {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName,
    sourceWeight: 0.95,
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

function mockUserModel(rows: any[]) {
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

const facultyUser = {
  _id: '64f000000000000000000001',
  netid: 'aa1',
  fname: 'Amy',
  lname: 'Arnsten',
  orcid: '0000-0001-2345-6789',
};

const payload = {
  resultList: {
    result: [
      {
        id: '37223279',
        source: 'MED',
        pmid: '37223279',
        doi: '10.1000/pubmed',
        title: 'A PubMed indexed ORCID paper',
        journalTitle: 'Journal of Bounded Chunks',
        pubYear: '2024',
        firstPublicationDate: '2024-01-02',
        authorString: 'Arnsten A, Example B',
      },
      {
        id: 'PPR123',
        source: 'PPR',
        doi: '10.1000/preprint',
        title: 'A Europe PMC preprint',
        journalTitle: 'Preprint Server',
        pubYear: '2024',
        authorString: 'Arnsten A',
      },
    ],
  },
};

describe('EuropePmcPaperScraper', () => {
  it('rejects unsafe runtime offsets before querying faculty', async () => {
    const userModel = mockUserModel([facultyUser]);
    const scraper = new EuropePmcPaperScraper({
      userModel,
      fetcher: vi.fn(async () => payload),
    });
    const { ctx } = makeContext('europe-pmc');
    ctx.options.offset = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--offset must be a safe non-negative integer/);

    expect(userModel.find).not.toHaveBeenCalled();
  });

  it('rejects unsafe runtime limits before querying faculty', async () => {
    const userModel = mockUserModel([facultyUser]);
    const scraper = new EuropePmcPaperScraper({
      userModel,
      fetcher: vi.fn(async () => payload),
    });
    const { ctx } = makeContext('europe-pmc');
    ctx.options.limit = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);

    expect(userModel.find).not.toHaveBeenCalled();
  });

  it('uses ORCID-backed Europe PMC discovery for accepted Yale users', async () => {
    const fetcher: EuropePmcFetcher = vi.fn(async () => payload);
    const scraper = new EuropePmcPaperScraper({
      userModel: mockUserModel([facultyUser]),
      fetcher,
    });
    const { ctx, emitted } = makeContext('europe-pmc');

    await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith('AUTHORID:"0000-0001-2345-6789"', 100);
    expect(emitted.filter((obs) => obs.field === 'paperAuthorshipEvidence')).toHaveLength(2);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        field: 'paperAuthorshipEvidence',
        value: expect.objectContaining({
          sourceName: 'europe-pmc',
          method: 'europepmc-orcid',
        }),
      }),
    );
  });
});

describe('PubMedPaperScraper', () => {
  it('restricts PubMed chunks to MED/PubMed records before emitting PubMed evidence', async () => {
    const fetcher: EuropePmcFetcher = vi.fn(async () => payload);
    const scraper = new PubMedPaperScraper({
      userModel: mockUserModel([facultyUser]),
      fetcher,
    });
    const { ctx, emitted } = makeContext('pubmed');

    await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith('AUTHORID:"0000-0001-2345-6789" AND SRC:MED', 100);
    const evidence = emitted.filter((obs) => obs.field === 'paperAuthorshipEvidence');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      entityKey: 'doi:10.1000/pubmed',
      value: {
        sourceName: 'pubmed',
        method: 'pubmed-orcid',
      },
    });
  });
});
