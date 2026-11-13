import { describe, expect, it } from 'vitest';

import { HostPausedError } from '../../utils/hostPause';
import type { ObservationInput, ScraperContext } from '../../types';
import {
  LabSiteLeadVerificationScraper,
  readLabSite,
  type LabSiteVerificationCandidate,
} from '../labSiteLeadVerificationScraper';

const CANDIDATE: LabSiteVerificationCandidate = {
  entityId: 'synthetic-entity',
  slug: 'synthetic-lab',
  website: 'https://lab.example.edu/',
  leads: [],
};

const LANDING_WITH_MEMBERS_LINK =
  '<html><body><h1>Synthetic Tidepool Lab</h1><a href="/people/">Our people</a></body></html>';

async function runWithSubpageError(error: unknown) {
  const emitted: ObservationInput[] = [];
  const scraper = new LabSiteLeadVerificationScraper(
    async () => [CANDIDATE],
    (website, useCache) =>
      readLabSite(website, useCache, async (url) => {
        if (url === CANDIDATE.website) {
          return { url, finalUrl: url, html: LANDING_WITH_MEMBERS_LINK, httpStatusCode: 200 };
        }
        throw error;
      }),
  );
  const context = {
    sourceName: scraper.name,
    options: {},
    emit: async (observation: ObservationInput) => {
      emitted.push(observation);
    },
    log: () => undefined,
  } as unknown as ScraperContext;
  const result = await scraper.run(context);
  return { emitted, result };
}

async function runWithFetchError(error: unknown) {
  const emitted: ObservationInput[] = [];
  const scraper = new LabSiteLeadVerificationScraper(
    async () => [CANDIDATE],
    (website, useCache) =>
      readLabSite(website, useCache, async () => {
        throw error;
      }),
  );
  const context = {
    sourceName: scraper.name,
    options: {},
    emit: async (observation: ObservationInput) => {
      emitted.push(observation);
    },
    log: () => undefined,
  } as unknown as ScraperContext;
  const result = await scraper.run(context);
  return { emitted, result };
}

describe('lab-site lead verification never records a fetch that observed nothing (#6257, #6258)', () => {
  it('keeps stored verdicts when our own host pause refused the request', async () => {
    const pause = new HostPausedError({
      host: 'lab.example.edu',
      until: new Date('2026-11-13T20:00:00Z'),
    } as ConstructorParameters<typeof HostPausedError>[0]);

    const { emitted, result } = await runWithFetchError(pause);

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('deferredNotObserved=1');
    expect(result.notes).toContain('unreachable=0');
  });

  it('keeps stored verdicts when the request timed out', async () => {
    const timeout = Object.assign(new Error('timeout of 15000ms exceeded'), {
      code: 'ECONNABORTED',
    });

    const { emitted } = await runWithFetchError(timeout);

    expect(emitted).toEqual([]);
  });

  it('still records unreachable when the host has no DNS record', async () => {
    const missing = Object.assign(new Error('getaddrinfo ENOTFOUND lab.example.edu'), {
      code: 'ENOTFOUND',
    });

    const { emitted, result } = await runWithFetchError(missing);

    expect(emitted).toHaveLength(1);
    expect((emitted[0].value as { state: string }).state).toBe('unreachable');
    expect(result.notes).toContain('deferredNotObserved=0');
  });
  it('defers the row when a members page our own pause refused might have named the lead', async () => {
    const pause = new HostPausedError({
      host: 'lab.example.edu',
      until: new Date('2026-11-13T20:00:00Z'),
    } as ConstructorParameters<typeof HostPausedError>[0]);

    const { emitted, result } = await runWithSubpageError(pause);

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('deferredNotObserved=1');
  });

  it('still judges the landing page when a members page answered 404, which is genuine absence', async () => {
    const gone = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404 },
    });

    const { emitted, result } = await runWithSubpageError(gone);

    expect(emitted).toHaveLength(1);
    expect(result.notes).toContain('deferredNotObserved=0');
  });
});
