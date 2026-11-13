import { describe, expect, it, vi } from 'vitest';

import { DevWriteLeaseHeldError } from '../../db/devWriteLease';
import { ResearchPageTextScraper } from '../sources/researchPageTextScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';
import { HttpStatusError } from '../utils/httpFetch';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';
import { HostPausedError } from '../utils/hostPause';
import { HostSlotWaitTimeoutError } from '../utils/hostConcurrencyLimiter';
import { HostBudgetUnavailableError } from '../utils/machineHostBudget';
import { SsrfBlockedError } from '../../utils/ssrfGuard';
import { excludedHostRedirectError } from '../../utils/excludedHosts';

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

function run(
  partnerFailure: unknown,
  storedReadingHosts: string[],
  previousKept: Record<string, string[]> = {},
) {
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
    storedHashLoader: async () => (storedReadingHosts.length ? 'stored-hash' : undefined),
    storedReadingLoader: async () => ({ hosts: new Set(storedReadingHosts) }),
    previousThrottledRowsLoader: async () => previousKept,
    citerCountsLoader: async () => new Map(),
  });
  return lane.run(ctx).then((result) => ({ result, emitted }));
}

const BOTH_HOSTS = ['tidepool-lab.example.org', 'partner-site.example.org'];

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
    ['a rate-based WAF refusal that outlasted its retries', new HttpStatusError(403)],
    ['a server error that outlasted its retries', new HttpStatusError(503)],
    [
      'a timeout',
      Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }),
    ],
    ['a host lease another run holds', leaseHeld()],
    [
      'an SSRF guard refusal of a private address',
      new SsrfBlockedError('blocked', 'private-address'),
    ],
    [
      'a host budget that could not be read',
      new HostBudgetUnavailableError('partner-site.example.org', '/tmp/x', new Error('EACCES')),
    ],
    [
      'a host slot wait that timed out',
      new HostSlotWaitTimeoutError('partner-site.example.org', 1000),
    ],
    ['a redirect into an excluded host', excludedHostRedirectError()],
  ])('keeps the stored reading after %s and counts the row', async (_label, failure) => {
    const { result, emitted } = await run(failure, BOTH_HOSTS);

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 kept after a transient fetch failure');
  });

  it('still stores the shorter reading when the page is gone', async () => {
    const { result, emitted } = await run(new HttpStatusError(404), BOTH_HOSTS);

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
    expect(result.notes).toContain('0 kept after a transient fetch failure');
  });

  it('stores what it read for a row with no earlier reading to keep', async () => {
    const { emitted } = await run(new HttpStatusError(429), []);

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
  });

  it('stores the new reading when the failing page never fed the stored one, so a row cannot freeze', async () => {
    const { result, emitted } = await run(new HttpStatusError(403), ['tidepool-lab.example.org']);

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
    expect(result.notes).toContain('0 kept after a transient fetch failure');
  });

  it('keeps the stored reading when a cited page is throttled after redirecting to a host the reading drew on', async () => {
    const redirectedHost = 'research-hub.example.org';
    const { result, emitted } = await run(
      new HttpStatusError(403, `https://${redirectedHost}/kelp/`),
      ['tidepool-lab.example.org', redirectedHost],
    );

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 kept after a transient fetch failure');
  });

  it('defers a row whose cited host is paused past the run, and says when it resumes', async () => {
    const resumesAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const paused = new HostPausedError({ host: 'partner-site.example.org', until: resumesAt });

    const { result, emitted } = await run(paused, BOTH_HOSTS);

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 deferred to a later run');
    expect(result.notes).toContain(
      `Deferred, by host: partner-site.example.org 1 rows, resumes at ${resumesAt.toISOString()}.`,
    );
    expect(result.metrics?.deferredRowsByHost).toEqual({
      'partner-site.example.org': { rows: 1, resumesAt: resumesAt.toISOString() },
    });
  });

  it('reads a deferred row again within the run once a short pause ends', async () => {
    const waits: number[] = [];
    let partnerCalls = 0;
    const emitted: ObservationInput[] = [];
    const lane = new ResearchPageTextScraper({
      fetchPage: vi.fn(async (url: string) => {
        if (url === PARTNER && (partnerCalls += 1) === 1) {
          throw new HostPausedError({
            host: 'partner-site.example.org',
            until: new Date(Date.now() + 30_000),
          });
        }
        return pages[url] ? { url, html: pages[url] } : null;
      }),
      rowFinder: async () => [row],
      storedHashLoader: async () => 'stored-hash',
      storedReadingLoader: async () => ({ hosts: new Set(BOTH_HOSTS) }),
      previousThrottledRowsLoader: async () => ({}),
      citerCountsLoader: async () => new Map(),
      sleep: async (ms) => {
        waits.push(ms);
        await new Promise((resolve) => setTimeout(resolve, 0));
        vi.setSystemTime(new Date(Date.now() + ms));
      },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const result = await lane.run({
        scrapeRunId: 'test-run',
        sourceId: 'test-source',
        sourceName: RESEARCH_PAGE_TEXT_SOURCE,
        sourceWeight: 0.85,
        options: { dryRun: false, useCache: false, release: false },
        emit: async (obs) => {
          emitted.push(...(Array.isArray(obs) ? obs : [obs]));
        },
        log: () => undefined,
      });

      expect(waits).toHaveLength(1);
      expect(waits[0]).toBeLessThanOrEqual(30_000);
      expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME, PARTNER]);
      expect(result.notes).toContain('0 deferred to a later run');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the throttled rows by host, and how many were also throttled last run', async () => {
    const { result } = await run(new HttpStatusError(403), BOTH_HOSTS, {
      'partner-site.example.org': [row._id as string, 'another-row-id'],
    });

    expect(result.notes).toContain(
      'Throttled rows, by host: partner-site.example.org 1 (1 also throttled last run).',
    );
    expect(result.metrics?.throttledRowsByHost).toEqual({
      'partner-site.example.org': [row._id],
    });
  });

  it('does not count a timeout as a throttle in the by-host report', async () => {
    const timeout = Object.assign(new Error('timeout of 10000ms exceeded'), {
      code: 'ECONNABORTED',
    });

    const { result, emitted } = await run(timeout, BOTH_HOSTS);

    expect(emitted).toEqual([]);
    expect(result.notes).not.toContain('Throttled rows, by host');
    expect(result.metrics?.throttledRowsByHost).toEqual({});
  });
});
