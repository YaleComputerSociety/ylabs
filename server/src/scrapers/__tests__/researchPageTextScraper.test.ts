import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ResearchPageTextScraper,
  normalizeResearchPageTextObjectId,
  researchPageTextContentHash,
} from '../sources/researchPageTextScraper';
import { SOURCE_CONTENT_HASH_FIELD } from '../contentHashGate';
import { sanitizeObservationField } from '../observationFieldSanitizer';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = 'https://tidepool-lab.example.org/';
const RESEARCH = 'https://tidepool-lab.example.org/research/';

const filler =
  'The group welcomes collaborators from across the university and shares its data openly with the community.';

const fixturePages: Record<string, string> = {
  [HOME]: `<html><body><h1>Tidepool Lab</h1><p>We study how coastal kelp forests recover after marine heatwaves. ${filler}</p><p>Students who want to join the kelp surveys this summer can write to tidepool@example.org for details.</p><a href="/research/">Research</a></body></html>`,
  [RESEARCH]: `<html><body><h1>Research</h1><p>Our projects follow sea urchin grazing on kelp and the ocean acidification of shallow reefs. ${filler}</p></body></html>`,
};

const row: CandidateDescriptionLab = {
  _id: 'a'.repeat(24),
  slug: 'tidepool-lab',
  name: 'Tidepool Lab',
  websiteUrl: HOME,
  sourceUrls: [HOME],
  entityType: 'LAB',
};

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: RESEARCH_PAGE_TEXT_SOURCE,
    sourceWeight: 0.85,
    options: { dryRun: false, useCache: false, release: false, ...overrides },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

function buildLane(options: { storedHash?: string; pages?: Record<string, string> } = {}): {
  lane: ResearchPageTextScraper;
  fetchPage: ReturnType<typeof vi.fn>;
} {
  const pages = options.pages ?? fixturePages;
  const fetchPage = vi.fn(async (url: string) => (pages[url] ? { url, html: pages[url] } : null));
  const lane = new ResearchPageTextScraper({
    fetchPage,
    rowFinder: async () => [row],
    storedHashLoader: async () => options.storedHash,
  });
  return { lane, fetchPage };
}

const pageTextObservation = (emitted: ObservationInput[]) =>
  emitted.find((observation) => observation.field === RESEARCH_PAGE_TEXT_FIELD);

describe('ResearchPageTextScraper', () => {
  it('stores the research text of the row pages and its content hash', async () => {
    const { lane, fetchPage } = buildLane();
    const { ctx, emitted } = makeContext();
    await lane.run(ctx);
    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([HOME, RESEARCH]);
    expect(emitted.map((observation) => observation.field)).toEqual([
      RESEARCH_PAGE_TEXT_FIELD,
      SOURCE_CONTENT_HASH_FIELD,
    ]);
    const observation = pageTextObservation(emitted);
    expect(observation).toMatchObject({
      entityType: 'researchEntity',
      entityKey: 'tidepool-lab',
      sourceUrl: HOME,
    });
    const value = observation?.value as Array<{ url: string; text: string }>;
    expect(value.map((entry) => entry.url)).toEqual([HOME, RESEARCH]);
    expect(value[0].text).toContain('kelp forests recover after marine heatwaves');
    expect(value[1].text).toContain('sea urchin grazing on kelp');
  });

  it('reads the lab site, its research subpage and the official profile, in that order', async () => {
    const PROFILE = 'https://medicine.example.org/profile/tidepool-lab/';
    const OTHER = 'https://tidepool-lab.example.org/about-the-coast/';
    const POSTING = 'https://tidepool-lab.example.org/jobs/postdoc-posting/';
    const pagesWithProfile: Record<string, string> = {
      ...fixturePages,
      [PROFILE]: `<html><body><h1>Profile</h1><p>Her research examines how warming oceans change kelp forest food webs and urchin barrens. ${filler}</p></body></html>`,
      [OTHER]: `<html><body><p>The coast near the station hosts long-term plots of intertidal invertebrates and algae. ${filler}</p></body></html>`,
      [POSTING]: `<html><body><p>We are hiring a postdoctoral researcher to study kelp recovery after heatwaves. ${filler}</p></body></html>`,
    };
    const fetchPage = vi.fn(async (url: string) =>
      pagesWithProfile[url] ? { url, html: pagesWithProfile[url] } : null,
    );
    const lane = new ResearchPageTextScraper({
      fetchPage,
      rowFinder: async () => [{ ...row, sourceUrls: [OTHER, PROFILE, HOME, POSTING] }],
      storedHashLoader: async () => undefined,
    });
    const { ctx, emitted } = makeContext();
    await lane.run(ctx);
    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([HOME, RESEARCH, PROFILE, OTHER]);
    const value = pageTextObservation(emitted)?.value as Array<{ url: string; text: string }>;
    expect(value.map((entry) => entry.url)).toEqual([HOME, RESEARCH, PROFILE, OTHER]);
    expect(value[2].text).toContain('warming oceans change kelp forest food webs');
  });

  it('reads at most six pages for a row', async () => {
    const many = Array.from({ length: 9 }, (_, index) => `${HOME}page-${index}/`);
    const fetchPage = vi.fn(async (url: string) => ({
      url,
      html: `<html><body><p>Page ${url} describes kelp forest recovery after marine heatwaves. ${filler}</p></body></html>`,
    }));
    const lane = new ResearchPageTextScraper({
      fetchPage,
      rowFinder: async () => [{ ...row, sourceUrls: [HOME, ...many] }],
      storedHashLoader: async () => undefined,
    });
    await lane.run(makeContext().ctx);
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it('yields the same observation from the same pages', async () => {
    const first = makeContext();
    const second = makeContext();
    await buildLane().lane.run(first.ctx);
    await buildLane().lane.run(second.ctx);
    expect(second.emitted).toEqual(first.emitted);
  });

  it('redacts contact details before storing the text', async () => {
    const { lane } = buildLane();
    const { ctx, emitted } = makeContext();
    await lane.run(ctx);
    const text = JSON.stringify(pageTextObservation(emitted)?.value);
    expect(text).not.toContain('tidepool@example.org');
    expect(text).toContain('[email redacted]');
  });

  it('is redacted again at ingest whichever producer stores it', () => {
    const sanitized = sanitizeObservationField('researchEntity', RESEARCH_PAGE_TEXT_FIELD, [
      { url: HOME, text: 'Write to tidepool@example.org about kelp.' },
      { url: '', text: 'dropped' },
    ]);
    expect(sanitized).toEqual({
      value: [{ url: HOME, text: 'Write to [email redacted] about kelp.' }],
      rejected: false,
    });
  });

  it('emits nothing when the stored content hash matches', async () => {
    const probe = makeContext();
    await buildLane().lane.run(probe.ctx);
    const hash = probe.emitted.find((o) => o.field === SOURCE_CONTENT_HASH_FIELD)?.value;
    const { lane } = buildLane({ storedHash: hash as string });
    const { ctx, emitted } = makeContext();
    const result = await lane.run(ctx);
    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 content unchanged');
  });

  it('asserts an empty reading when the home page states no research', async () => {
    const { lane } = buildLane({
      pages: { [HOME]: '<html><body><p>Under construction.</p></body></html>' },
    });
    const { ctx, emitted } = makeContext();
    await lane.run(ctx);
    expect(pageTextObservation(emitted)).toMatchObject({
      value: [],
      assertsNoValueFor: [RESEARCH_PAGE_TEXT_FIELD],
      sourceUrl: HOME,
    });
  });

  it('emits nothing when no page could be read', async () => {
    const { lane } = buildLane({ pages: {} });
    const { ctx, emitted } = makeContext();
    const result = await lane.run(ctx);
    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 with no readable page');
  });

  it('hashes the stored value, so a different text gets a different hash', () => {
    const a = researchPageTextContentHash([{ url: HOME, text: 'kelp forests' }]);
    const b = researchPageTextContentHash([{ url: HOME, text: 'kelp forests recover' }]);
    expect(a).not.toBe(b);
    expect(researchPageTextContentHash([{ url: HOME, text: 'kelp forests' }])).toBe(a);
  });

  it('normalizes only strict ObjectId filters', () => {
    expect(normalizeResearchPageTextObjectId(` ${'b'.repeat(24)} `)).toBe('b'.repeat(24));
    expect(normalizeResearchPageTextObjectId('tidepool-lab')).toBeUndefined();
    expect(normalizeResearchPageTextObjectId({ $ne: null })).toBeUndefined();
  });

  it('makes no model call anywhere in the lane', () => {
    const source = fs.readFileSync(
      path.resolve(HERE, '../sources/researchPageTextScraper.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/openai|axios|callLLM|OPENAI_API_KEY|chat\/completions/i);
  });
});
