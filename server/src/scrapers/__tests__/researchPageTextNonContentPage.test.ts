import { describe, expect, it, vi } from 'vitest';

import { ResearchPageTextScraper } from '../sources/researchPageTextScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';

const HOME = 'https://tidepool-lab.example.org/';
const PARTNER = 'https://partner-site.example.org/kelp/';

const research = (topic: string) =>
  `<html><body><h1>Research</h1><p>We study ${topic} along the coast, and the group shares its survey data openly with the community and its partners.</p></body></html>`;

const SIGN_IN_PAGE =
  '<html><body><h1>Central Authentication Service</h1><p>Make sure your session is secure. Before entering your NetID and password, verify the address of this page.</p></body></html>';

const BOT_CHALLENGE_PAGE =
  '<html><head><script>var x = 1;</script></head><body><h1>Security Check</h1><p>Your browser is being verified. Consulting the crowd... Powered by CrowdSec</p></body></html>';

const row: CandidateDescriptionLab = {
  _id: 'c'.repeat(24),
  slug: 'synthetic-tidepool-lab',
  name: 'Synthetic Tidepool Lab',
  websiteUrl: HOME,
  sourceUrls: [HOME, PARTNER],
  entityType: 'LAB',
};

function run(partnerPage: { url: string; html: string }, storedReadingHosts: string[]) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: RESEARCH_PAGE_TEXT_SOURCE,
    sourceWeight: 0.85,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: (line: string) => {
      logs.push(line);
    },
  };
  const lane = new ResearchPageTextScraper({
    fetchPage: vi.fn(async (url: string) => {
      if (url === PARTNER) return partnerPage;
      return url === HOME ? { url, html: research('how kelp forests recover after marine heatwaves') } : null;
    }),
    rowFinder: async () => [row],
    storedHashLoader: async () => (storedReadingHosts.length ? 'stored-hash' : undefined),
    storedReadingLoader: async () => ({ hosts: new Set(storedReadingHosts) }),
    previousThrottledRowsLoader: async () => ({}),
    citerCountsLoader: async () => new Map(),
  });
  return lane.run(ctx).then((result) => ({ result, emitted, logs }));
}

const pageText = (emitted: ObservationInput[]) =>
  emitted.find((observation) => observation.field === RESEARCH_PAGE_TEXT_FIELD)?.value as
    Array<{ url: string }> | undefined;

const BOTH_HOSTS = ['tidepool-lab.example.org', 'partner-site.example.org'];

describe('research-page-text refuses a fetched page that is not the row content (#6460)', () => {
  it('keeps the stored reading when a cited page redirects to a sign-in wall', async () => {
    const { result, emitted, logs } = await run(
      { url: 'https://secure.its.yale.edu/cas/login?service=x', html: SIGN_IN_PAGE },
      BOTH_HOSTS,
    );

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 kept after a transient fetch failure');
    expect(logs.some((line) => line.includes('research page refused: sign-in-wall'))).toBe(true);
  });

  it('keeps the stored reading when a cited page answers with a bot challenge', async () => {
    const { emitted, logs } = await run({ url: PARTNER, html: BOT_CHALLENGE_PAGE }, BOTH_HOSTS);

    expect(emitted).toEqual([]);
    expect(logs.some((line) => line.includes('research page refused: bot-challenge'))).toBe(true);
  });

  it('stores only the content pages for a row with no earlier reading', async () => {
    const { emitted } = await run({ url: PARTNER, html: BOT_CHALLENGE_PAGE }, []);

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
  });

  it('stores a real partner page as before', async () => {
    const { emitted } = await run(
      { url: PARTNER, html: research('sea urchin grazing on shallow reefs') },
      BOTH_HOSTS,
    );

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME, PARTNER]);
  });
});
