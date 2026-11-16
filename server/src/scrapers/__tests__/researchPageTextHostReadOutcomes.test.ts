import { describe, expect, it, vi } from 'vitest';

import { ResearchPageTextScraper } from '../sources/researchPageTextScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ScraperContext } from '../types';
import { HttpStatusError } from '../utils/httpFetch';
import { HostPausedError } from '../utils/hostPause';
import { RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';

const HOME = 'https://tidepool-lab.example.org/';
const PARTNER = 'https://partner-site.example.org/kelp/';
const HOME_HOST = 'tidepool-lab.example.org';
const PARTNER_HOST = 'partner-site.example.org';

const page = `<html><body><h1>Research</h1><p>We study how kelp forests recover after marine heatwaves along the coast, and the group shares its survey data openly.</p></body></html>`;

const row: CandidateDescriptionLab = {
  _id: 'c'.repeat(24),
  slug: 'synthetic-tidepool-lab',
  name: 'Synthetic Tidepool Lab',
  websiteUrl: HOME,
  sourceUrls: [HOME, PARTNER],
  entityType: 'LAB',
};

const ctx: ScraperContext = {
  scrapeRunId: 'test-run',
  sourceId: 'test-source',
  sourceName: RESEARCH_PAGE_TEXT_SOURCE,
  sourceWeight: 0.85,
  options: { dryRun: true, useCache: false, release: false },
  emit: async () => undefined,
  log: () => undefined,
};

const pause = { host: PARTNER_HOST, until: new Date('2099-11-20T07:32:40Z') };

async function outcomesFor(fetchPage: (url: string) => Promise<unknown>) {
  const lane = new ResearchPageTextScraper({
    fetchPage: vi.fn(fetchPage) as never,
    rowFinder: async () => [row],
    storedHashLoader: async () => undefined,
    storedReadingLoader: async () => ({ hosts: new Set<string>() }),
    previousThrottledRowsLoader: async () => ({}),
    citerCountsLoader: async () => new Map(),
    sleep: async () => undefined,
  });
  const result = await lane.run(ctx);
  return (result.metrics as { hostReadOutcomes: Record<string, unknown> }).hostReadOutcomes;
}

const outcomesWhenPartner = (failure: unknown) =>
  outcomesFor(async (url) => {
    if (url === PARTNER) throw failure;
    return { url, html: page };
  });

describe('research-page-text records how each host answered (#6195)', () => {
  it('counts a host that served a page as answered', async () => {
    const outcomes = await outcomesWhenPartner(new HttpStatusError(404));
    expect(outcomes[HOME_HOST]).toEqual({ answered: 1, refused: 0, skipped: 0, failed: 0 });
  });

  it('counts a 404 as an answer, because the host is still reading us', async () => {
    const outcomes = await outcomesWhenPartner(new HttpStatusError(404));
    expect(outcomes[PARTNER_HOST]).toEqual({ answered: 1, refused: 0, skipped: 0, failed: 0 });
  });

  it.each([403, 429, 503])(
    'counts a %i that outlasted its retries as a refusal',
    async (status) => {
      const outcomes = await outcomesWhenPartner(new HttpStatusError(status));
      expect(outcomes[PARTNER_HOST]).toEqual({ answered: 0, refused: 1, skipped: 0, failed: 0 });
    },
  );

  it('counts a refusal that started a pause as a refusal', async () => {
    const outcomes = await outcomesWhenPartner(new HostPausedError(pause, true));
    expect(outcomes[PARTNER_HOST]).toMatchObject({ answered: 0, refused: 1, skipped: 0 });
  });

  it('counts a host paused before any request as skipped, neither an answer nor a refusal', async () => {
    const outcomes = await outcomesWhenPartner(new HostPausedError(pause));
    expect(outcomes[PARTNER_HOST]).toMatchObject({ answered: 0, refused: 0, skipped: 1 });
  });

  it('counts a transport failure as failed, not as a refusal', async () => {
    const timeout = Object.assign(new Error('timeout of 10000ms exceeded'), {
      code: 'ECONNABORTED',
    });
    const outcomes = await outcomesWhenPartner(timeout);
    expect(outcomes[PARTNER_HOST]).toEqual({ answered: 0, refused: 0, skipped: 0, failed: 1 });
  });

  it('does not count a page replayed from the local cache as the host answering', async () => {
    const outcomes = await outcomesFor(async (url) =>
      url === PARTNER ? { url, html: page, reused: true } : { url, html: page },
    );
    expect(outcomes[PARTNER_HOST]).toBeUndefined();
    expect(outcomes[HOME_HOST]).toMatchObject({ answered: 1 });
  });

  it('does not count a fetch that returned no page as an answer', async () => {
    const outcomes = await outcomesFor(async (url) =>
      url === PARTNER ? null : { url, html: page },
    );
    expect(outcomes[PARTNER_HOST]).toBeUndefined();
  });

  it('tallies a request that redirected to another host once, under the requested host', async () => {
    const outcomes = await outcomesFor(async (url) =>
      url === PARTNER
        ? { url: 'https://moved.example.org/kelp/', html: page }
        : { url, html: page },
    );
    expect(outcomes[PARTNER_HOST]).toMatchObject({ answered: 1 });
    expect(outcomes['moved.example.org']).toBeUndefined();
  });
});
