import { describe, expect, it, vi } from 'vitest';
import {
  UNDERGRAD_LIST_SOURCE_CONFIGS,
  UNDERGRAD_LIST_EVIDENCE_FIELD,
  OfficialUndergradListScraper,
  type MentorResolver,
} from '../sources/officialUndergradListScraper';
import type { ObservationInput, ScraperContext } from '../types';
import {
  UNDERGRAD_EVIDENCE_SIGNAL,
  type MentorListing,
  type UndergradListEntry,
} from '../utils/officialUndergradLists';

const NOW = new Date('2026-11-10T12:00:00Z');

function context(emitted: ObservationInput[], only?: string[]): ScraperContext {
  return {
    scrapeRunId: 'run',
    sourceId: 'source',
    sourceName: 'official-undergrad-lists',
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
  stored?: Map<string, UndergradListEntry[]>;
  only?: string[];
}) {
  const emitted: ObservationInput[] = [];
  const scraper = new OfficialUndergradListScraper({
    fetchText: async () => null,
    resolveMentor: options.resolve,
    storedListEvidenceFinder: async () => options.stored ?? new Map(),
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

describe('OfficialUndergradListScraper', () => {
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
        field: UNDERGRAD_LIST_EVIDENCE_FIELD,
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
    const storedEntry: UndergradListEntry = {
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

    expect((emitted[0].value as UndergradListEntry[]).map((entry) => entry.source)).toEqual([
      'cs-senior-projects',
      'tobin-research-assistantships',
    ]);
  });

  it('carries the entries of a source the run was not asked to read', async () => {
    const storedEntry: UndergradListEntry = {
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
        assertsNoValueFor: [UNDERGRAD_LIST_EVIDENCE_FIELD],
      }),
    ]);
  });

  it('reads a CS archive as complete when a linked term page is gone, but not when it failed', async () => {
    const archive = UNDERGRAD_LIST_SOURCE_CONFIGS.find(
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

  it('reads every semester of the Tobin board, and is incomplete when the board is unreadable', async () => {
    const tobin = UNDERGRAD_LIST_SOURCE_CONFIGS.find(
      (config) => config.source === 'tobin-research-assistantships',
    )!;
    const filledProject = (year: number) => `<article class="node-teaser--opportunity">
      <div class="node-teaser__heading"><a href="/undergraduate/tobin-ra/${year}/01/p"><span>P</span></a></div>
      <dl><div><dt>Faculty Sponsor(s)</dt><dd><a href="/people/avery-synthetic">Avery Synthetic</a></dd></div>
      <div><dt>Position filled</dt></div><div><dt>Semester</dt><dd>${year} Spring</dd></div></dl></article>`;
    const board = `<main>${filledProject(2026)}${filledProject(2012)}</main>`;

    const read = await tobin.read(async () => board, NOW);
    const failed = await tobin.read(async () => null, NOW);
    const empty = await tobin.read(async () => '<main></main>', NOW);

    expect(read.complete).toBe(true);
    expect(read.listings.map((listing) => listing.year)).toEqual([2026, 2012]);
    expect(failed.complete).toBe(false);
    expect(empty.complete).toBe(false);

    const sponsorless = `<article class="node-teaser--opportunity"><dl>
      <div><dt>Position filled</dt></div><div><dt>Semester</dt><dd>2025 Fall</dd></div></dl></article>`;
    const withSponsorlessCard = await tobin.read(
      async () => `<main>${filledProject(2026)}${sponsorless}</main>`,
      NOW,
    );
    expect(withSponsorlessCard.complete).toBe(true);
    expect(withSponsorlessCard.listings.map((listing) => listing.year)).toEqual([2026]);
  });

  it('feeds each list the one signal the #5362 ruling assigns by what the undergraduate did', () => {
    const advisedOwnWork = [
      'cs-senior-projects',
      'cs-directed-research',
      'english-senior-essays',
      'english-creative-writing-projects',
      'political-science-senior-essay-prizes',
      'german-senior-essays',
      'cognitive-science-senior-essays',
      'eps-senior-theses',
      'economics-senior-essay-advisers',
    ];
    const workedInsideResearch = [
      'tobin-research-assistantships',
      'wu-tsai-undergraduate-fellows',
      'yibs-summer-research-fellows',
    ];
    const takingUndergraduatesNow = [
      'psychology-research-opportunities',
      'physics-open-research-opportunities',
    ];
    const signalOf = Object.fromEntries(
      UNDERGRAD_LIST_SOURCE_CONFIGS.map((config) => [
        config.source,
        UNDERGRAD_EVIDENCE_SIGNAL[config.source],
      ]),
    );

    expect(signalOf).toEqual({
      ...Object.fromEntries(advisedOwnWork.map((source) => [source, 'mentors'])),
      ...Object.fromEntries(workedInsideResearch.map((source) => [source, 'hosted'])),
      ...Object.fromEntries(takingUndergraduatesNow.map((source) => [source, 'welcomes'])),
    });
    expect(UNDERGRAD_LIST_SOURCE_CONFIGS).toHaveLength(
      advisedOwnWork.length + workedInsideResearch.length + takingUndergraduatesNow.length,
    );
  });

  it('reads Cognitive Science essay advisers under the departments the program draws on, and never the student', async () => {
    const essays = UNDERGRAD_LIST_SOURCE_CONFIGS.find(
      (config) => config.source === 'cognitive-science-senior-essays',
    )!;
    const page = `<h2>Class of 2025</h2><table>
      <thead><tr><th>Student</th><th>Senior Project Title</th><th>Advisor</th></tr></thead>
      <tbody>
        <tr><td>Quill Ashgrove</td><td>Memory For Edible Things</td><td>Morgan Fennick</td></tr>
        <tr><td>Wren Halloway</td><td>Two Advisers At Once</td><td>Dr. Morgan Fennick and Prof. Jordan Pellow</td></tr>
      </tbody></table>`;

    const read = await essays.read(async () => page, NOW);

    expect(read.complete).toBe(true);
    expect(read.listings.map((listing) => listing.adviserName)).toEqual([
      'Morgan Fennick',
      'Morgan Fennick',
      'Jordan Pellow',
    ]);
    expect(JSON.stringify(read.listings)).not.toMatch(/Quill|Wren|Edible|Advisers At Once/);
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
