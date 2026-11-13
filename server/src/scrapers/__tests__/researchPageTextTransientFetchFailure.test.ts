import { describe, expect, it, vi } from 'vitest';

import { DevWriteLeaseHeldError } from '../../db/devWriteLease';
import { ResearchPageTextScraper } from '../sources/researchPageTextScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';
import { HttpStatusError } from '../utils/httpFetch';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';

const HOME = 'https://tidepool-lab.example.org/';
const PARTNER = 'https://partner-site.example.org/kelp/';

const body = (topic: string) =>
  `<html><body><h1>Research</h1><p>We study ${topic} along the coast, and the group shares its survey data openly with the community and its partners.</p></body></html>`;

const pages: Record<string, string> = {
  [HOME]: body('how kelp forests recover after marine heatwaves'),
  [PARTNER]: body('sea urchin grazing on shallow reefs'),
};

const row: CandidateDescriptionLab = {
  _id: 'b'.repeat(24),
  slug: 'synthetic-tidepool-lab',
  name: 'Synthetic Tidepool Lab',
  websiteUrl: HOME,
  sourceUrls: [HOME, PARTNER],
  entityType: 'LAB',
};

function run(partnerFailure: unknown, storedHash: string | undefined) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: RESEARCH_PAGE_TEXT_SOURCE,
    sourceWeight: 0.85,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => undefined,
  };
  const lane = new ResearchPageTextScraper({
    fetchPage: vi.fn(async (url: string) => {
      if (url === PARTNER) throw partnerFailure;
      return pages[url] ? { url, html: pages[url] } : null;
    }),
    rowFinder: async () => [row],
    storedHashLoader: async () => storedHash,
    citerCountsLoader: async () => new Map(),
  });
  return lane.run(ctx).then((result) => ({ result, emitted }));
}

const pageText = (emitted: ObservationInput[]) =>
  emitted.find((observation) => observation.field === RESEARCH_PAGE_TEXT_FIELD)?.value as
    Array<{ url: string }> | undefined;

const leaseHeld = () =>
  new DevWriteLeaseHeldError(
    'host:partner-site.example.org',
    { _id: 'development:host:partner-site.example.org', sourceName: 'host', ownerId: 'other-run' },
    new Date(),
  );

describe('research-page-text when a cited page fails transiently', () => {
  it.each([
    ['a throttle that outlasted its retries', new HttpStatusError(429)],
    ['a server error that outlasted its retries', new HttpStatusError(503)],
    [
      'a timeout',
      Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }),
    ],
    ['a host lease another run holds', leaseHeld()],
  ])('keeps the stored reading after %s and counts the row', async (_label, failure) => {
    const { result, emitted } = await run(failure, 'stored-hash');

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 kept after a transient fetch failure');
  });

  it('still stores the shorter reading when the page is gone', async () => {
    const { result, emitted } = await run(new HttpStatusError(404), 'stored-hash');

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
    expect(result.notes).toContain('0 kept after a transient fetch failure');
  });

  it('stores what it read for a row with no earlier reading to keep', async () => {
    const { emitted } = await run(new HttpStatusError(429), undefined);

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
  });
});
