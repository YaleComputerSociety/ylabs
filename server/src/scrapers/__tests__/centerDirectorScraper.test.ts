import { describe, expect, it } from 'vitest';
import {
  CENTER_DIRECTOR_SOURCE_NAME,
  CenterDirectorScraper,
  type CenterDirectorTarget,
} from '../sources/centerDirectorScraper';
import type { ObservationInput, ScraperContext } from '../types';

const READ_AT = new Date('2026-10-19T12:00:00.000Z');

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: CENTER_DIRECTOR_SOURCE_NAME,
    sourceWeight: 0.7,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      referenceDate: READ_AT,
      ...overrides,
    },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  return { ctx, emitted };
}

const TARGETS: CenterDirectorTarget[] = [
  {
    slug: 'center-widget-institute',
    name: 'Widget Institute',
    websiteUrl: 'https://widget.yale.edu/',
  },
  {
    slug: 'center-gadget-core',
    name: 'Gadget Core',
    websiteUrl: 'https://research.yale.edu/cores/gadget',
  },
  { slug: 'center-sprocket-lab', name: 'Sprocket Lab', websiteUrl: 'https://sprocket.yale.edu/' },
];

const PAGES: Record<string, string> = {
  'https://widget.yale.edu/':
    '<a href="/leadership">Leadership</a><p>Welcome to the institute.</p>',
  'https://widget.yale.edu/leadership': `
    <div class="card"><h3><a href="https://medicine.yale.edu/profile/quill-fenwick/">Quill Fenwick, PhD</a></h3>
    <span>Director</span></div>
    <div class="card"><h3>Orla Brightwater</h3><span>Associate Director</span></div>`,
  'https://research.yale.edu/cores/gadget': `
    <div class="card"><h3>Pell Marrowby</h3><span>Director</span></div>
    <div class="card"><h3>Isolde Varnham</h3><span>Director</span></div>`,
};

function frozenFetch(url: string) {
  const html = PAGES[url];
  if (html === undefined) return Promise.reject(new Error('404'));
  return Promise.resolve({ url, html });
}

describe('CenterDirectorScraper', () => {
  it('emits the director observations the director materializer reads', async () => {
    const scraper = new CenterDirectorScraper({
      fetchPage: frozenFetch,
      findTargets: async () => TARGETS,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted.filter((obs) => obs.entityType === 'researchEntity')).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'center-widget-institute',
        sourceUrl: 'https://widget.yale.edu/leadership',
        field: 'inferredDirectorName',
        value: 'Quill Fenwick',
      },
      {
        entityType: 'researchEntity',
        entityKey: 'center-widget-institute',
        sourceUrl: 'https://widget.yale.edu/leadership',
        field: 'inferredDirectorUserName',
        value: { fname: 'Quill', lname: 'Fenwick' },
      },
      {
        entityType: 'researchEntity',
        entityKey: 'center-widget-institute',
        sourceUrl: 'https://widget.yale.edu/leadership',
        field: 'inferredDirectorRole',
        value: 'director',
        confidenceOverride: 0.85,
      },
      {
        entityType: 'researchEntity',
        entityKey: 'center-widget-institute',
        sourceUrl: 'https://widget.yale.edu/leadership',
        field: 'inferredDirectorTitle',
        value: 'Director',
      },
      {
        entityType: 'researchEntity',
        entityKey: 'center-widget-institute',
        sourceUrl: 'https://widget.yale.edu/leadership',
        field: 'inferredDirectorProfileUrl',
        value: 'https://medicine.yale.edu/profile/quill-fenwick/',
      },
    ]);
    expect(result).toMatchObject({ observationCount: 7, entitiesObserved: 1 });
    expect(result.notes).toBe(
      'Read 3 organizational homes: 1 named a director, 1 refused as ambiguous, ' +
        '0 stated one only in prose, 0 stated none, 1 unreadable.',
    );
  });

  it('records every read that fetched a page, with who it states and who it settled on', async () => {
    const scraper = new CenterDirectorScraper({
      fetchPage: frozenFetch,
      findTargets: async () => TARGETS,
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);
    const snapshots = emitted.filter((obs) => obs.entityType === 'centerRosterHealth');

    expect(snapshots.map((obs) => obs.entityKey)).toEqual([
      'center-widget-institute',
      'center-gadget-core',
    ]);
    expect(snapshots[0].value).toMatchObject({
      members: [{ memberKey: 'Quill Fenwick', role: 'director' }],
      settledDirector: { name: 'Quill Fenwick', role: 'director' },
      read: { pagesRead: 2, readMode: 'html', cacheAllowed: false, readAt: READ_AT.toISOString() },
    });
    expect(snapshots[1].value).toMatchObject({
      members: [
        { memberKey: 'Isolde Varnham', role: 'director' },
        { memberKey: 'Pell Marrowby', role: 'director' },
      ],
      settledDirector: null,
    });
  });

  it('emits the same observations from the same pages on every run', async () => {
    const runOnce = async () => {
      const scraper = new CenterDirectorScraper({
        fetchPage: frozenFetch,
        findTargets: async () => TARGETS,
      });
      const { ctx, emitted } = makeContext();
      await scraper.run(ctx);
      return emitted;
    };
    expect(await runOnce()).toEqual(await runOnce());
  });

  it('honours limit and offset over the target list', async () => {
    const scraper = new CenterDirectorScraper({
      fetchPage: frozenFetch,
      findTargets: async () => TARGETS,
    });
    const { ctx } = makeContext({ limit: 1, offset: 1 });
    const result = await scraper.run(ctx);
    expect(result.notes).toMatch(/^Read 1 organizational homes: 0 named a director, 1 refused/);
  });
});
