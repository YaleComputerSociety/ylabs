import { describe, expect, it, vi } from 'vitest';
import {
  OrcidWorksScraper,
  orcidWorkSummaryToObservations,
  parseOrcidWorks,
  type OrcidWorksFetcher,
} from '../sources/orcidWorksScraper';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'orcid',
    sourceWeight: 0.95,
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

function mockUserModel(rows: any[]) {
  return {
    find: vi.fn(() => ({
      sort: () => ({
        lean: async () => rows,
        limit: () => ({
          lean: async () => rows,
        }),
      }),
      limit: () => ({
        lean: async () => rows,
      }),
      lean: async () => rows,
    })) as any,
  };
}

const ORCID_WORKS_PAYLOAD = {
  group: [
    {
      'work-summary': [
        {
          'put-code': 123,
          title: { title: { value: 'A trusted ORCID work' } },
          'journal-title': { value: 'Journal of Careful Links' },
          type: 'journal-article',
          url: { value: 'https://example.edu/work' },
          'publication-date': { year: { value: '2024' } },
          'external-ids': {
            'external-id': [
              {
                'external-id-type': 'doi',
                'external-id-value': '10.1234/ABC',
              },
              {
                'external-id-type': 'arxiv',
                'external-id-value': '2401.01234',
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('parseOrcidWorks', () => {
  it('extracts normalized DOI and arXiv identifiers from ORCID grouped works', () => {
    expect(parseOrcidWorks(ORCID_WORKS_PAYLOAD)).toEqual([
      expect.objectContaining({
        putCode: '123',
        title: 'A trusted ORCID work',
        doi: '10.1234/abc',
        arxivId: '2401.01234',
        year: 2024,
      }),
    ]);
  });
});

describe('orcidWorkSummaryToObservations', () => {
  it('emits identity-backed paper authorship evidence for the ORCID owner', () => {
    const [work] = parseOrcidWorks(ORCID_WORKS_PAYLOAD);
    const observations = orcidWorkSummaryToObservations(work, {
      userId: '64f000000000000000000001',
      netid: 'aa1',
      displayName: 'Amy Arnsten',
      orcid: '0000-0001-2345-6789',
    });

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'paper',
          entityKey: '2401.01234',
          field: 'paperAuthorshipEvidence',
          value: expect.objectContaining({
            userId: '64f000000000000000000001',
            netid: 'aa1',
            sourceName: 'orcid',
            method: 'orcid-record',
            externalAuthorIds: expect.objectContaining({
              orcid: '0000-0001-2345-6789',
            }),
          }),
        }),
        expect.objectContaining({
          field: 'sources',
          value: ['orcid'],
        }),
      ]),
    );
  });
});

describe('OrcidWorksScraper.run', () => {
  it('fetches accepted ORCID users and emits paper observations', async () => {
    const fetcher: OrcidWorksFetcher = vi.fn(async () => ORCID_WORKS_PAYLOAD);
    const userModel = mockUserModel([
      {
        _id: '64f000000000000000000001',
        netid: 'aa1',
        fname: 'Amy',
        lname: 'Arnsten',
        orcid: '0000-0001-2345-6789',
      },
    ]);
    const scraper = new OrcidWorksScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith('0000-0001-2345-6789');
    expect(emitted.some((obs) => obs.field === 'paperAuthorshipEvidence')).toBe(true);
    expect(result.entitiesObserved).toBe(1);
  });
});
