import { describe, expect, it, vi } from 'vitest';
import {
  MENTOR_SOURCE_CONFIGS,
  UNDERGRAD_MENTORING_FIELD,
  UndergradMentorListScraper,
  type MentorResolver,
} from '../sources/undergradMentorListScraper';
import type { ObservationInput, ScraperContext } from '../types';
import type { MentorListing, UndergradMentoringEntry } from '../utils/undergradMentoring';

const NOW = new Date('2026-11-10T12:00:00Z');

function context(emitted: ObservationInput[], only?: string[]): ScraperContext {
  return {
    scrapeRunId: 'run',
    sourceId: 'source',
    sourceName: 'undergrad-mentor-list',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, referenceDate: NOW, only },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
}

const listing = (source: MentorListing['source'], adviserName: string, year?: number) => ({
  source,
  adviserName,
  year,
  sourceUrl: `https://example.edu/${source}/page`,
});

const resolveBy =
  (table: Record<string, string | 'ambiguous' | 'no-lead-row'>): MentorResolver =>
  async (entry) => {
    const outcome = table[entry.adviserName];
    if (!outcome) return { status: 'refused', reason: 'no-match' };
    if (outcome === 'ambiguous' || outcome === 'no-lead-row') {
      return { status: 'refused', reason: outcome };
    }
    return { status: 'matched', slug: outcome };
  };

async function run(options: {
  reads: Record<string, { listings: MentorListing[]; complete: boolean } | Error>;
  resolve: MentorResolver;
  stored?: Map<string, UndergradMentoringEntry[]>;
  only?: string[];
}) {
  const emitted: ObservationInput[] = [];
  const scraper = new UndergradMentorListScraper({
    fetchText: async () => null,
    resolveMentor: options.resolve,
    storedMentoringFinder: async () => options.stored ?? new Map(),
    sources: Object.entries(options.reads).map(([source, read]) => ({
      source: source as MentorListing['source'],
      landingUrl: `https://example.edu/${source}`,
      read: async () => {
        if (read instanceof Error) throw read;
        return read;
      },
    })),
  });
  const result = await scraper.run(context(emitted, options.only));
  return { emitted, result };
}

describe('UndergradMentorListScraper', () => {
  it("rebuilds each matched row's list across sources, citing each source's landing page", async () => {
    const { emitted } = await run({
      reads: {
        'cs-senior-projects': {
          complete: true,
          listings: [
            listing('cs-senior-projects', 'Avery Synthetic', 2025),
            listing('cs-senior-projects', 'Avery Synthetic', 2026),
          ],
        },
        'economics-senior-essay-advisers': {
          complete: true,
          listings: [listing('economics-senior-essay-advisers', 'Avery Synthetic')],
        },
      },
      resolve: resolveBy({ 'Avery Synthetic': 'synthetic-lab' }),
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        entityKey: 'synthetic-lab',
        field: UNDERGRAD_MENTORING_FIELD,
        value: [
          {
            source: 'cs-senior-projects',
            kind: 'advised',
            count: 2,
            latestYear: 2026,
            sourceUrl: 'https://example.edu/cs-senior-projects',
          },
          {
            source: 'economics-senior-essay-advisers',
            kind: 'open',
            sourceUrl: 'https://example.edu/economics-senior-essay-advisers',
          },
        ],
      }),
    ]);
  });

  it('attaches nothing for an adviser it cannot place, and counts why', async () => {
    const { emitted, result } = await run({
      reads: {
        'cs-senior-projects': {
          complete: true,
          listings: [
            listing('cs-senior-projects', 'Shared Name'),
            listing('cs-senior-projects', 'Unknown Person'),
            listing('cs-senior-projects', 'No Row'),
          ],
        },
      },
      resolve: resolveBy({ 'Shared Name': 'ambiguous', 'No Row': 'no-lead-row' }),
    });

    expect(emitted).toEqual([]);
    expect((result.metrics as any).perSource['cs-senior-projects']).toEqual({
      listings: 3,
      matched: 0,
      ambiguous: 1,
      'no-match': 1,
      'no-lead-row': 1,
    });
  });

  it('keeps the entries of a source it could not read completely', async () => {
    const storedEntry: UndergradMentoringEntry = {
      source: 'tobin-research-assistantships',
      kind: 'advised',
      count: 3,
      latestYear: 2025,
      sourceUrl: 'https://example.edu/tobin',
    };
    const { emitted } = await run({
      reads: {
        'cs-senior-projects': {
          complete: true,
          listings: [listing('cs-senior-projects', 'Avery Synthetic', 2026)],
        },
        'tobin-research-assistantships': { complete: false, listings: [] },
      },
      resolve: resolveBy({ 'Avery Synthetic': 'synthetic-lab' }),
      stored: new Map([['synthetic-lab', [storedEntry]]]),
    });

    expect((emitted[0].value as UndergradMentoringEntry[]).map((entry) => entry.source)).toEqual([
      'cs-senior-projects',
      'tobin-research-assistantships',
    ]);
  });

  it('carries the entries of a source the run was not asked to read', async () => {
    const storedEntry: UndergradMentoringEntry = {
      source: 'wu-tsai-undergraduate-fellows',
      kind: 'advised',
      count: 1,
      sourceUrl: 'https://example.edu/wti',
    };
    const { emitted } = await run({
      reads: {
        'cs-senior-projects': { complete: true, listings: [] },
        'wu-tsai-undergraduate-fellows': { complete: true, listings: [] },
      },
      only: ['cs-senior-projects'],
      resolve: resolveBy({}),
      stored: new Map([['carried-lab', [storedEntry]]]),
    });

    expect(emitted).toEqual([
      expect.objectContaining({ entityKey: 'carried-lab', value: [storedEntry] }),
    ]);
  });

  it('withdraws a row whose every source was read and no longer names its adviser', async () => {
    const { emitted } = await run({
      reads: { 'cs-senior-projects': { complete: true, listings: [] } },
      resolve: resolveBy({}),
      stored: new Map([
        [
          'former-lab',
          [
            {
              source: 'cs-senior-projects',
              kind: 'advised',
              count: 1,
              sourceUrl: 'https://example.edu/cs',
            },
          ],
        ],
      ]),
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        entityKey: 'former-lab',
        value: null,
        assertsNoValueFor: [UNDERGRAD_MENTORING_FIELD],
      }),
    ]);
  });

  it('reads a CS archive as complete when a linked term page is gone, but not when it failed', async () => {
    const archive = MENTOR_SOURCE_CONFIGS.find(
      (config) => config.source === 'cs-directed-research',
    )!;
    const index =
      '<a href="25-26b/index.html">Spring 2026</a><a href="24-25a/index.html">Fall 2024</a>';
    const term =
      '<h2>Projects: Spring 2026</h2><ul><li>Student, <i>Title</i>, Adviser: Avery Synthetic.</li></ul>';
    const pages = (missing: string | null) => async (url: string) =>
      url.endsWith('/cs290/') ? index : url.includes('25-26b') ? term : missing;

    const gone = await archive.read(pages(''), NOW);
    const failed = await archive.read(pages(null), NOW);

    expect(gone).toEqual({
      complete: true,
      listings: [expect.objectContaining({ adviserName: 'Avery Synthetic', year: 2026 })],
    });
    expect(failed.complete).toBe(false);
  });

  it('keeps going when one source throws, and records it', async () => {
    const { emitted, result } = await run({
      reads: {
        'psychology-research-opportunities': new Error('sheet unavailable'),
        'cs-senior-projects': {
          complete: true,
          listings: [listing('cs-senior-projects', 'Avery Synthetic')],
        },
      },
      resolve: resolveBy({ 'Avery Synthetic': 'synthetic-lab' }),
    });

    expect(emitted).toHaveLength(1);
    expect(result.partialFailures?.join(' ')).toMatch(/psychology-research-opportunities/);
  });
});
