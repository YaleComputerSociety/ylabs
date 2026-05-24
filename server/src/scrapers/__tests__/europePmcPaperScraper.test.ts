import { describe, expect, it, vi } from 'vitest';
import { PAPER_AUTHORSHIP_EVIDENCE_FIELD } from '../paperAuthorshipPolicy';
import {
  EuropePmcPaperScraper,
  PubMedPaperScraper,
  type EuropePmcFetcher,
} from '../sources/europePmcPaperScraper';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(sourceName: 'europe-pmc' | 'pubmed' = 'europe-pmc') {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName,
    sourceWeight: 0.9,
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
  const query: any = {};
  query.sort = vi.fn(() => query);
  query.skip = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.lean = vi.fn().mockResolvedValue(rows);
  return {
    query,
    userModel: {
      find: vi.fn(() => query) as any,
    },
  };
}

function facultyUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: '64f000000000000000000001',
    netid: 'al123',
    fname: 'Ada',
    lname: 'Lovelace',
    orcid: 'https://orcid.org/0000-0000-0000-001X',
    ...overrides,
  };
}

function doiResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'MED/123456',
    pmid: '123456',
    pmcid: 'PMC123456',
    doi: 'https://doi.org/10.1234/Example.DOI',
    title: 'A DOI-backed paper',
    journalTitle: 'Journal of Focused Tests',
    pubYear: '2024',
    firstPublicationDate: '2024-04-15',
    authorString: 'Lovelace A, Hopper G',
    source: 'MED',
    ...overrides,
  };
}

function payloadWith(results: unknown[]) {
  return {
    resultList: {
      result: results,
    },
  };
}

function paperObservations(emitted: ObservationInput[]) {
  return emitted.filter((obs) => obs.entityType === 'paper');
}

describe('EuropePmcPaperScraper shared ORCID implementation', () => {
  it('finds only faculty users with ORCIDs and fetches by normalized ORCID', async () => {
    const { userModel } = mockUserModel([
      facultyUser(),
      facultyUser({
        _id: '64f000000000000000000002',
        netid: 'missing1',
        fname: 'No',
        lname: 'Identifier',
        orcid: '',
      }),
    ]);
    const fetcher: EuropePmcFetcher = vi.fn(async () => payloadWith([]));
    const scraper = new EuropePmcPaperScraper({ userModel, fetcher, pageSize: 25 });
    const { ctx } = makeContext();

    await scraper.run(ctx);

    expect(userModel.find).toHaveBeenCalledWith(
      {
        userType: { $in: ['professor', 'faculty'] },
        orcid: { $exists: true, $ne: null, $nin: [''] },
      },
      { _id: 1, netid: 1, fname: 1, lname: 1, orcid: 1 },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('0000-0000-0000-001X', 25);
  });

  it('emits DOI-backed legacy paper observations and skips no-DOI records', async () => {
    const { userModel } = mockUserModel([facultyUser()]);
    const fetcher: EuropePmcFetcher = vi.fn(async () =>
      payloadWith([
        doiResult(),
        {
          id: 'MED/no-doi',
          pmid: '999999',
          title: 'No DOI paper',
          journalTitle: 'Journal of Skipped Records',
          pubYear: '2023',
        },
      ]),
    );
    const scraper = new EuropePmcPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    const paperObs = paperObservations(emitted);
    expect(result.entitiesObserved).toBe(1);
    expect(paperObs.length).toBeGreaterThan(0);
    expect(new Set(paperObs.map((obs) => obs.entityKey))).toEqual(
      new Set(['doi:10.1234/example.doi']),
    );
    expect(paperObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'paper',
          entityKey: 'doi:10.1234/example.doi',
          field: 'title',
          value: 'A DOI-backed paper',
        }),
        expect.objectContaining({
          entityType: 'paper',
          entityKey: 'doi:10.1234/example.doi',
          field: 'doi',
          value: '10.1234/example.doi',
        }),
      ]),
    );
    expect(paperObs.some((obs) => obs.value === 'No DOI paper')).toBe(false);
    expect(emitted.some((obs) => obs.entityType === 'scholarlyLink')).toBe(false);
  });

  it('derives year from firstPublicationDate when Europe PMC pubYear disagrees', async () => {
    const { userModel } = mockUserModel([facultyUser()]);
    const fetcher: EuropePmcFetcher = vi.fn(async () =>
      payloadWith([
        doiResult({
          pubYear: '2026',
          firstPublicationDate: '2025-09-02',
        }),
      ]),
    );
    const scraper = new EuropePmcPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const paperObs = paperObservations(emitted);
    expect(paperObs.find((obs) => obs.field === 'publishedAt')?.value).toEqual(
      new Date('2025-09-02'),
    );
    expect(paperObs.find((obs) => obs.field === 'year')?.value).toBe(2025);
  });

  it('keeps Europe PMC and PubMed syncedAt fields and authorship metadata separate', async () => {
    const europeModel = mockUserModel([facultyUser()]).userModel;
    const pubmedModel = mockUserModel([facultyUser()]).userModel;
    const europeFetcher: EuropePmcFetcher = vi.fn(async () => payloadWith([doiResult()]));
    const pubmedFetcher: EuropePmcFetcher = vi.fn(async () => payloadWith([doiResult()]));
    const europeScraper = new EuropePmcPaperScraper({
      userModel: europeModel,
      fetcher: europeFetcher,
    });
    const pubmedScraper = new PubMedPaperScraper({
      userModel: pubmedModel,
      fetcher: pubmedFetcher,
    });
    const europe = makeContext('europe-pmc');
    const pubmed = makeContext('pubmed');

    await europeScraper.run(europe.ctx);
    await pubmedScraper.run(pubmed.ctx);

    expect(europe.emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'user',
          field: 'europePmcWorksSyncedAt',
        }),
        expect.objectContaining({
          entityType: 'paper',
          field: 'sources',
          value: ['europe-pmc'],
        }),
      ]),
    );
    expect(europe.emitted.some((obs) => obs.field === 'pubmedWorksSyncedAt')).toBe(false);
    expect(europe.emitted.find((obs) => obs.field === PAPER_AUTHORSHIP_EVIDENCE_FIELD)?.value)
      .toMatchObject({
        sourceName: 'europe-pmc',
        method: 'europepmc-orcid',
        externalAuthorIds: { orcid: '0000-0000-0000-001X' },
      });

    expect(pubmed.emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'user',
          field: 'pubmedWorksSyncedAt',
        }),
        expect.objectContaining({
          entityType: 'paper',
          field: 'sources',
          value: ['pubmed'],
        }),
      ]),
    );
    expect(pubmed.emitted.some((obs) => obs.field === 'europePmcWorksSyncedAt')).toBe(false);
    expect(pubmed.emitted.find((obs) => obs.field === PAPER_AUTHORSHIP_EVIDENCE_FIELD)?.value)
      .toMatchObject({
        sourceName: 'pubmed',
        method: 'pubmed-orcid',
        externalAuthorIds: { orcid: '0000-0000-0000-001X' },
      });
  });

  it('filters PubMed runs to MED records before labeling observations as PubMed', async () => {
    const { userModel } = mockUserModel([facultyUser()]);
    const fetcher: EuropePmcFetcher = vi.fn(async () =>
      payloadWith([
        doiResult({
          doi: '10.1234/pubmed',
          title: 'PubMed article',
          source: 'MED',
        }),
        doiResult({
          doi: '10.1234/nonpubmed',
          title: 'Non-PubMed Europe PMC record',
          source: 'AGR',
        }),
      ]),
    );
    const scraper = new PubMedPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext('pubmed');

    const result = await scraper.run(ctx);

    const paperObs = paperObservations(emitted);
    expect(result.entitiesObserved).toBe(1);
    expect(new Set(paperObs.map((obs) => obs.entityKey))).toEqual(new Set(['doi:10.1234/pubmed']));
    expect(paperObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'sources',
          value: ['pubmed'],
        }),
      ]),
    );
    expect(paperObs.some((obs) => obs.value === 'Non-PubMed Europe PMC record')).toBe(false);
  });

  it('emits shared DOI metadata once while preserving each ORCID-backed authorship evidence row', async () => {
    const { userModel } = mockUserModel([
      facultyUser(),
      facultyUser({
        _id: '64f000000000000000000002',
        netid: 'grace1',
        fname: 'Grace',
        lname: 'Hopper',
        orcid: '0000-0002-0000-0002',
      }),
    ]);
    const fetcher: EuropePmcFetcher = vi.fn(async () => payloadWith([doiResult()]));
    const scraper = new EuropePmcPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    const paperObs = paperObservations(emitted);
    expect(result.entitiesObserved).toBe(1);
    expect(paperObs.filter((obs) => obs.field === 'title')).toHaveLength(1);
    expect(paperObs.filter((obs) => obs.field === 'sources')).toHaveLength(1);
    const authorshipEvidence = paperObs.filter(
      (obs) => obs.field === PAPER_AUTHORSHIP_EVIDENCE_FIELD,
    );
    expect(authorshipEvidence).toHaveLength(2);
    expect(authorshipEvidence.map((obs) => (obs.value as any).userId).sort()).toEqual([
      '64f000000000000000000001',
      '64f000000000000000000002',
    ]);
  });

  it('does not emit access artifacts from paper discovery results', async () => {
    const { userModel } = mockUserModel([facultyUser()]);
    const fetcher: EuropePmcFetcher = vi.fn(async () => payloadWith([doiResult()]));
    const scraper = new EuropePmcPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    expect(emitted.filter((obs) => !['paper', 'user'].includes(obs.entityType))).toEqual([]);
    expect(
      emitted.filter((obs) =>
        [
          'acceptingUndergrads',
          'accessSignals',
          'accessSummary',
          'contactRoutes',
          'entryPathways',
          'postedOpportunities',
          'undergradAccessEvidence',
        ].includes(obs.field),
      ),
    ).toEqual([]);
  });
});
