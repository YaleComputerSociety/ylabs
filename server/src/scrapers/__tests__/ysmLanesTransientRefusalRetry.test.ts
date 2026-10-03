import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YsmAtoZScraper } from '../sources/ysmAtoZScraper';
import { YsmFacultyDirectoryScraper } from '../sources/ysmFacultyDirectoryScraper';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../utils/ssrfGuard', () => ({
  assertPublicHttpUrl: async (url: string) => new URL(url),
  ssrfSafeAgents: () => ({ httpAgent: undefined, httpsAgent: undefined }),
}));

const PROFILE_URL = 'https://medicine.yale.edu/profile/synthetic-person/';

function refusal(status = 403) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers: {} },
  });
}

function makeContext(sourceName: string) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName,
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

function directoryHtml(profileUrls: string[]): string {
  const pageData = {
    mainComponents: [
      {
        key: 'PeopleAzList',
        model: {
          items: [
            {
              id: 'S',
              category: 'S',
              items: profileUrls.map((url) => ({ url, text: 'Person, Synthetic' })),
            },
          ],
        },
      },
    ],
  };
  return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

async function settleWithTimers<T>(work: Promise<T>): Promise<PromiseSettledResult<T>> {
  const settled = work.then(
    (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

const noLabUrlEvidence = async () => new Map();
const noPause = async () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(axios.get).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ysm-atoz-index fetch under a transient 403', () => {
  it('re-sends the index request after a 403 and completes the read', async () => {
    vi.mocked(axios.get)
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce({ data: '<html><body><table></table></body></html>' });
    const { ctx, emitted } = makeContext('ysm-atoz-index');

    const outcome = await settleWithTimers(new YsmAtoZScraper().run(ctx));

    expect(outcome.status).toBe('fulfilled');
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(emitted.some((obs) => obs.entityType === 'ysmLabIndexHealth')).toBe(true);
  });

  it('fails the run with the 403 when every retry is refused, emitting no index snapshot', async () => {
    vi.mocked(axios.get).mockRejectedValue(refusal());
    const { ctx, emitted } = makeContext('ysm-atoz-index');

    const outcome = await settleWithTimers(new YsmAtoZScraper().run(ctx));

    expect(outcome.status).toBe('rejected');
    expect(String((outcome as PromiseRejectedResult).reason)).toMatch(/status code 403/);
    expect(axios.get).toHaveBeenCalledTimes(4);
    expect(emitted).toEqual([]);
  });
});

describe('ysm-faculty-directory fetch under a transient 403', () => {
  it('re-sends the directory request after a 403 and completes the read', async () => {
    vi.mocked(axios.get)
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce({ data: directoryHtml([]) });
    const { ctx } = makeContext('ysm-faculty-directory');
    const scraper = new YsmFacultyDirectoryScraper(undefined, noLabUrlEvidence, noPause);

    const outcome = await settleWithTimers(scraper.run(ctx));

    expect(outcome.status).toBe('fulfilled');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('records a profile refused on every retry as lost rather than reading it as absent', async () => {
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url === PROFILE_URL) throw refusal();
      return { data: directoryHtml([PROFILE_URL]) };
    });
    const { ctx, emitted } = makeContext('ysm-faculty-directory');
    const scraper = new YsmFacultyDirectoryScraper(undefined, noLabUrlEvidence, noPause);

    const outcome = await settleWithTimers(scraper.run(ctx));

    expect(outcome.status).toBe('fulfilled');
    const profileCalls = vi.mocked(axios.get).mock.calls.filter(([url]) => url === PROFILE_URL);
    expect(profileCalls).toHaveLength(8);
    expect((outcome as PromiseFulfilledResult<{ notes?: string }>).value.notes).toContain(
      '1 profiles refused then 0 recovered on a second pass',
    );
    expect(emitted).toEqual([]);
  });
});
