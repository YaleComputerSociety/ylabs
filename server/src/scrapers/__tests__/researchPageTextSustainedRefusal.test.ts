import { describe, expect, it, vi } from 'vitest';

import { ResearchPageTextScraper } from '../sources/researchPageTextScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';
import { HttpStatusError } from '../utils/httpFetch';
import { RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';
import type { RunHostReadOutcomes } from '../utils/sustainedHostRefusal';

const HOME = 'https://tidepool-lab.example.org/';
const PARTNER = 'https://partner-site.example.org/kelp/';
const PARTNER_HOST = 'partner-site.example.org';
const DAY = 24 * 60 * 60 * 1000;

const page = `<html><body><h1>Research</h1><p>We study how kelp forests recover after marine heatwaves along the coast, and the group shares its survey data openly.</p></body></html>`;

const row: CandidateDescriptionLab = {
  _id: 'd'.repeat(24),
  slug: 'synthetic-tidepool-lab',
  name: 'Synthetic Tidepool Lab',
  websiteUrl: HOME,
  sourceUrls: [HOME, PARTNER],
  entityType: 'LAB',
};

const earlier = (daysAgo: number, refused: number, answered = 0): RunHostReadOutcomes => ({
  startedAt: new Date(Date.now() - daysAgo * DAY),
  hostReadOutcomes: { [PARTNER_HOST]: { answered, refused, skipped: 0, failed: 0 } },
});

async function runWithHistory(history: RunHostReadOutcomes[]) {
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
      if (url === PARTNER) throw new HttpStatusError(403);
      return { url, html: page };
    }),
    rowFinder: async () => [row],
    storedHashLoader: async () => 'stored-hash',
    storedReadingLoader: async () => ({
      hosts: new Set(['tidepool-lab.example.org', PARTNER_HOST]),
    }),
    previousThrottledRowsLoader: async () => ({}),
    recentHostReadOutcomesLoader: async () => history,
    citerCountsLoader: async () => new Map(),
    sleep: async () => undefined,
  });
  const result = await lane.run(ctx);
  return { result, emitted };
}

describe('research-page-text flags a host refusing for a sustained period (#6195)', () => {
  it('flags the host, counts its unconfirmed rows, and still keeps every reading', async () => {
    const { result, emitted } = await runWithHistory([earlier(8, 1), earlier(15, 2)]);
    const flagged = (result.metrics as { sustainedRefusalHosts?: Record<string, any> })
      .sustainedRefusalHosts?.[PARTNER_HOST];

    expect(flagged).toMatchObject({ runs: 3, rowsUnconfirmed: 1 });
    expect(result.notes).toContain(`Refusing for a sustained period: ${PARTNER_HOST} since`);
    expect(emitted).toEqual([]);
  });

  it('does not flag a host that answered on an earlier run in the window', async () => {
    const { result } = await runWithHistory([earlier(8, 0, 1), earlier(15, 2)]);

    expect(
      (result.metrics as { sustainedRefusalHosts?: unknown }).sustainedRefusalHosts,
    ).toBeUndefined();
    expect(result.notes).not.toContain('Refusing for a sustained period');
  });
});
