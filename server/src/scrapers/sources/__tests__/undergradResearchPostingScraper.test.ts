import { describe, expect, it, vi } from 'vitest';
import {
  UndergradResearchPostingScraper,
  parseUndergradResearchPostingsPage,
  undergradResearchPostingObservations,
  type ResolvedHiringHome,
} from '../undergradResearchPostingScraper';
import type { ObservationInput, ScraperContext } from '../../types';

const CONFIG = {
  key: 'test-board',
  url: 'https://science.yalecollege.yale.edu/research-opportunities/current-openings',
  blockSelector: 'article',
};

const NOW = new Date('2026-06-01T00:00:00.000Z');

const COMPLETE_POSTING_HTML = `
  <main>
    <article>
      <h3>Summer Research Assistant</h3>
      <p>Lab: Smith Lab</p>
      <p>Application deadline: 2026-12-01.</p>
      <p>Work on undergraduate microbiome projects for the summer.</p>
      <a href="https://apply.yale.edu/smith-lab-ra">Apply now</a>
    </article>
  </main>
`;

describe('parseUndergradResearchPostingsPage (#1568)', () => {
  it('parses a fully-specified posting into a future-dated apply-now record', () => {
    const postings = parseUndergradResearchPostingsPage(COMPLETE_POSTING_HTML, CONFIG, NOW);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      title: 'Summer Research Assistant',
      hiringHome: 'Smith Lab',
      applyUrl: 'https://apply.yale.edu/smith-lab-ra',
    });
    expect(postings[0].deadline.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('fails closed on a posting with no deadline label', () => {
    const html = COMPLETE_POSTING_HTML.replace('Application deadline: 2026-12-01.', 'Rolling.');
    expect(parseUndergradResearchPostingsPage(html, CONFIG, NOW)).toEqual([]);
  });

  it('fails closed on a posting whose deadline has already passed', () => {
    const html = COMPLETE_POSTING_HTML.replace('2026-12-01', '2024-12-01');
    expect(parseUndergradResearchPostingsPage(html, CONFIG, NOW)).toEqual([]);
  });

  it('parses natural-language deadline dates into a future expiry', () => {
    const html = COMPLETE_POSTING_HTML.replace('2026-12-01', 'December 1, 2026');
    const postings = parseUndergradResearchPostingsPage(html, CONFIG, NOW);
    expect(postings).toHaveLength(1);
    expect(postings[0].deadline.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(postings[0].deadline.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('fails closed when there is no apply route', () => {
    const html = COMPLETE_POSTING_HTML.replace(
      '<a href="https://apply.yale.edu/smith-lab-ra">Apply now</a>',
      '<a href="https://smith-lab.yale.edu">Lab website</a>',
    );
    expect(parseUndergradResearchPostingsPage(html, CONFIG, NOW)).toEqual([]);
  });

  it('fails closed when there is no hiring home label', () => {
    const html = COMPLETE_POSTING_HTML.replace('<p>Lab: Smith Lab</p>', '');
    expect(parseUndergradResearchPostingsPage(html, CONFIG, NOW)).toEqual([]);
  });
});

describe('undergradResearchPostingObservations', () => {
  it('keys the postedOpening observation to the resolved hiring entity', () => {
    const [posting] = parseUndergradResearchPostingsPage(COMPLETE_POSTING_HTML, CONFIG, NOW);
    const home: ResolvedHiringHome = {
      entityId: '64f000000000000000000009',
      slug: 'smith-lab',
      name: 'Smith Lab',
    };
    const observations = undergradResearchPostingObservations(posting, home);
    const posted = observations.find((o) => o.field === 'postedOpening');
    expect(posted?.entityId).toBe(home.entityId);
    expect(posted?.entityKey).toBe(home.slug);
    expect((posted?.value as any).applyUrl).toBe('https://apply.yale.edu/smith-lab-ra');
    expect((posted?.value as any).deadline).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('UndergradResearchPostingScraper.run', () => {
  const makeCtx = (emitted: ObservationInput[][]): ScraperContext =>
    ({
      scrapeRunId: 'run',
      sourceId: 'src',
      sourceName: 'undergrad-research-posting',
      sourceWeight: 1,
      options: { dryRun: true, useCache: false, release: false },
      emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
        emitted.push(Array.isArray(obs) ? obs : [obs]);
      }),
      log: vi.fn(),
    }) as unknown as ScraperContext;

  it('emits observations only for postings whose hiring home resolves', async () => {
    const emitted: ObservationInput[][] = [];
    const scraper = new UndergradResearchPostingScraper({
      pageConfigs: [CONFIG],
      fetchHtml: async () => COMPLETE_POSTING_HTML,
      resolveHiringHome: async (name) =>
        name === 'Smith Lab'
          ? { entityId: '64f000000000000000000009', slug: 'smith-lab', name: 'Smith Lab' }
          : null,
      now: () => NOW,
    });
    const result = await scraper.run(makeCtx(emitted));
    expect(result.entitiesObserved).toBe(1);
    expect(emitted.flat().some((o) => o.field === 'postedOpening')).toBe(true);
  });

  it('fails closed when the hiring home cannot be resolved to an entity', async () => {
    const emitted: ObservationInput[][] = [];
    const scraper = new UndergradResearchPostingScraper({
      pageConfigs: [CONFIG],
      fetchHtml: async () => COMPLETE_POSTING_HTML,
      resolveHiringHome: async () => null,
      now: () => NOW,
    });
    const result = await scraper.run(makeCtx(emitted));
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toEqual([]);
  });
});

describe('UndergradResearchPostingScraper.run source concurrency', () => {
  const labFor = (index: number) => `Lab ${index}`;

  const htmlForLab = (labName: string) =>
    COMPLETE_POSTING_HTML.replace('Lab: Smith Lab', `Lab: ${labName}`);

  const pageConfigs = Array.from({ length: 6 }, (_, index) => ({
    key: `board-${index}`,
    url: `https://science.yalecollege.yale.edu/board-${index}`,
    blockSelector: 'article',
  }));

  const urlToLab = new Map(pageConfigs.map((page, index) => [page.url, labFor(index)]));

  const makeCtx = (emitted: ObservationInput[][], sourceConcurrency: number): ScraperContext =>
    ({
      scrapeRunId: 'run',
      sourceId: 'src',
      sourceName: 'undergrad-research-posting',
      sourceWeight: 1,
      options: { dryRun: true, useCache: false, release: false, sourceConcurrency },
      emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
        emitted.push(Array.isArray(obs) ? obs : [obs]);
      }),
      log: vi.fn(),
    }) as unknown as ScraperContext;

  const runWithConcurrency = async (sourceConcurrency: number) => {
    let active = 0;
    let peak = 0;
    const emitted: ObservationInput[][] = [];
    const scraper = new UndergradResearchPostingScraper({
      pageConfigs,
      fetchHtml: async (url: string) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const labName = urlToLab.get(url);
        if (!labName) throw new Error(`unexpected url ${url}`);
        return htmlForLab(labName);
      },
      resolveHiringHome: async (name) => ({
        entityId: `id-${name}`,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        name,
      }),
      now: () => NOW,
    });
    const result = await scraper.run(makeCtx(emitted, sourceConcurrency));
    const emittedKeys = emitted
      .flat()
      .filter((o) => o.field === 'postedOpening')
      .map((o) => o.entityKey)
      .sort();
    return { result, peak, emittedKeys };
  };

  it('emits the same observations serially and in parallel, and actually parallelizes', async () => {
    const serial = await runWithConcurrency(1);
    const parallel = await runWithConcurrency(6);

    expect(serial.peak).toBe(1);
    expect(parallel.peak).toBeGreaterThan(1);

    const expectedKeys = pageConfigs
      .map((_, index) => labFor(index).toLowerCase().replace(/\s+/g, '-'))
      .sort();
    expect(serial.emittedKeys).toEqual(expectedKeys);
    expect(parallel.emittedKeys).toEqual(serial.emittedKeys);
    expect(parallel.result.entitiesObserved).toBe(serial.result.entitiesObserved);
    expect(parallel.result.observationCount).toBe(serial.result.observationCount);
  });
});
