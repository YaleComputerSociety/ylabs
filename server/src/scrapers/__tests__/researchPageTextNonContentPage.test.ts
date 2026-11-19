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
  '<html><head><script>var x = 1;</script></head><body><h1>Security Check</h1><p>Your browser is being verified before you can reach this site. Consulting the crowd about this request, which can take a few seconds while the check completes. Powered by CrowdSec. Why am I seeing this page? This site uses a security service to protect itself from automated traffic.</p></body></html>';

const GAMBLING_PAGE =
  '<html><head><title>CONTOH88 | Situs Resmi Slot Gacor</title></head><body><h1>CONTOH88</h1>' +
  '<p>CONTOH88 hadir sebagai link alternatif resmi yang disediakan untuk member setia maupun member baru, agar akses ke situs utama menjadi lebih mudah, cepat, dan nyaman tanpa hambatan apa pun setiap hari.</p>' +
  '<p>Jika kamu mencari platform yang mampu memberikan hiburan sekaligus pengalaman bermain yang memuaskan, maka CONTOH88 adalah jawabannya, dengan tampilan yang ramah pengguna dan navigasi yang jelas untuk semua pemain.</p>' +
  '<p>Untuk mulai bermain, pengguna cukup mengunjungi situs resmi, melakukan pendaftaran akun, lalu login ke dalam platform untuk menikmati berbagai permainan slot online yang tersedia dengan Minimal Deposit Rp 20.000.</p></body></html>';

const SCHOOL_INDEX = 'https://medicine.yale.edu/research/';

const schoolIndexPage =
  '<html><body><h1>Research</h1><p>Research across the school spans fundamental studies of cells and molecules to population health, with programs that train students in every field of medicine.</p></body></html>';

const row: CandidateDescriptionLab = {
  _id: 'c'.repeat(24),
  slug: 'synthetic-tidepool-lab',
  name: 'Synthetic Tidepool Lab',
  websiteUrl: HOME,
  sourceUrls: [HOME, PARTNER],
  entityType: 'LAB',
};

function run(
  partnerPage: { url: string; html: string },
  storedReadingHosts: string[],
  subject: CandidateDescriptionLab = row,
) {
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
      return url === HOME
        ? { url, html: research('how kelp forests recover after marine heatwaves') }
        : null;
    }),
    rowFinder: async () => [subject],
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

  it('re-reads without a cited domain that now serves a gambling page, instead of keeping the old reading', async () => {
    const { emitted, logs } = await run({ url: PARTNER, html: GAMBLING_PAGE }, BOTH_HOSTS);

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
    expect(logs.some((line) => line.includes('research page refused: gambling-spam'))).toBe(true);
  });

  it('stores only the content pages for a row with no earlier reading', async () => {
    const { emitted } = await run({ url: PARTNER, html: BOT_CHALLENGE_PAGE }, []);

    expect(pageText(emitted)?.map((entry) => entry.url)).toEqual([HOME]);
  });

  it('refuses a school index a person row cites directly', async () => {
    const person: CandidateDescriptionLab = {
      ...row,
      sourceUrls: [HOME, SCHOOL_INDEX],
      kind: 'individual',
    } as CandidateDescriptionLab;
    const { emitted } = await runWith(person, { url: SCHOOL_INDEX, html: schoolIndexPage });

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

function runWith(subject: CandidateDescriptionLab, schoolPage: { url: string; html: string }) {
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
      if (url === schoolPage.url) return schoolPage;
      return url === HOME
        ? { url, html: research('how kelp forests recover after marine heatwaves') }
        : null;
    }),
    rowFinder: async () => [subject],
    storedHashLoader: async () => undefined,
    storedReadingLoader: async () => ({ hosts: new Set<string>() }),
    previousThrottledRowsLoader: async () => ({}),
    citerCountsLoader: async () => new Map(),
  });
  return lane.run(ctx).then((result) => ({ result, emitted }));
}
