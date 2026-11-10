import { describe, expect, it, vi } from 'vitest';

import { TobinRaProjectsScraper } from '../sources/tobinRaProjectsScraper';
import type { ObservationInput, ScraperContext } from '../types';
import {
  filledProjectYearsBy,
  parseTobinRaBoard,
  TOBIN_RA_BOARD_URL,
  TOBIN_RA_PROGRAM_NAME,
} from '../utils/tobinRaBoard';

const AWARD_NAMES = ['Synthetic Awardee One', 'Synthetic Awardee Two', 'Synthetic Awardee Three'];

const project = ({
  sponsors,
  semester,
  filled,
  award,
}: {
  sponsors: Array<{ name: string; slug?: string }>;
  semester: string;
  filled: boolean;
  award?: string;
}) => `
  <article class="node-teaser--opportunity">
    <h3><a href="/tobin-ra/project-${Math.random().toString(36).slice(2)}">Synthetic project</a></h3>
    <dl>
      <dt>Faculty Sponsor(s)</dt>
      <dd>${sponsors
        .map((sponsor) =>
          sponsor.slug ? `<a href="/people/${sponsor.slug}">${sponsor.name}</a>` : sponsor.name,
        )
        .join(', ')}</dd>
      ${filled ? '<dt>Position filled</dt><dd></dd>' : ''}
      <dt>Semester</dt><dd>${semester}</dd>
      ${award ? `<dt>Award</dt><dd>${award}</dd>` : ''}
    </dl>
  </article>`;

const boardHtml = (projects: string[]) => `<html><body><main>
  <p>The purpose of the program is to give undergraduates at Yale an opportunity to work as a research assistant.</p>
  ${projects.join('\n')}
</main></body></html>`;

const SAMPLE_BOARD = boardHtml([
  project({
    sponsors: [{ name: 'Synthetic Sponsor A', slug: 'synthetic-sponsor-a' }],
    semester: '2026 Fall',
    filled: true,
    award: AWARD_NAMES[0],
  }),
  project({
    sponsors: [{ name: 'Synthetic Sponsor A', slug: 'synthetic-sponsor-a' }],
    semester: '2026 Spring',
    filled: true,
    award: `${AWARD_NAMES[1]}, ${AWARD_NAMES[2]}`,
  }),
  project({
    sponsors: [{ name: 'Synthetic Sponsor A', slug: 'synthetic-sponsor-a' }],
    semester: '2024 Fall',
    filled: true,
    award: AWARD_NAMES[0],
  }),
  project({
    sponsors: [
      { name: 'Synthetic Sponsor B', slug: 'synthetic-sponsor-b' },
      { name: 'Synthetic Sponsor C', slug: 'synthetic-sponsor-c' },
    ],
    semester: '2025 Fall',
    filled: true,
    award: AWARD_NAMES[1],
  }),
  project({
    sponsors: [{ name: 'Synthetic Sponsor D', slug: 'synthetic-sponsor-d' }],
    semester: '2026 Fall',
    filled: false,
  }),
  project({
    sponsors: [{ name: 'Synthetic Unlinked Sponsor' }],
    semester: '2026 Fall',
    filled: true,
    award: AWARD_NAMES[2],
  }),
  project({
    sponsors: [{ name: 'Synthetic Sponsor E', slug: 'synthetic-sponsor-e' }],
    semester: 'Summer',
    filled: true,
    award: AWARD_NAMES[2],
  }),
]);

const sponsorUrl = (slug: string) => `https://economics.yale.edu/people/${slug}`;

const contextCollecting = () => {
  const emitted: ObservationInput[] = [];
  const logged: string[] = [];
  const ctx = {
    scrapeRunId: 'synthetic-run',
    sourceId: 'synthetic-source',
    sourceName: 'tobin-ra-projects',
    sourceWeight: 0.85,
    options: { useCache: false },
    emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    }),
    log: vi.fn((message: string) => logged.push(message)),
  } as unknown as ScraperContext;
  return { ctx, emitted, logged };
};

const rowsBySponsor: Record<string, string> = {
  [sponsorUrl('synthetic-sponsor-a')]: 'synthetic-row-a',
  [sponsorUrl('synthetic-sponsor-b')]: 'synthetic-row-shared',
  [sponsorUrl('synthetic-sponsor-c')]: 'synthetic-row-shared',
};

const scraperFor = (html: string) =>
  new TobinRaProjectsScraper({
    fetchHtml: async () => html,
    sponsorRowSlug: async (url) => rowsBySponsor[url] ?? null,
  });

const adviseesFor = (emitted: ObservationInput[], slug: string) =>
  emitted.find((obs) => obs.entityKey === slug && obs.field === 'pastUndergradAdvisees')?.value;

describe('Tobin RA board parser (#3551)', () => {
  it('reads each project year, filled marker and linked sponsors', () => {
    const board = parseTobinRaBoard(SAMPLE_BOARD);

    expect(board.projectBlocks).toBe(7);
    expect(board.projects[0]).toEqual({
      year: 2026,
      filled: true,
      sponsorProfileUrls: [sponsorUrl('synthetic-sponsor-a')],
    });
    expect(board.projects[3].sponsorProfileUrls).toEqual([
      sponsorUrl('synthetic-sponsor-b'),
      sponsorUrl('synthetic-sponsor-c'),
    ]);
    expect(board.projects[4].filled).toBe(false);
    expect(board.projects[5].sponsorProfileUrls).toEqual([]);
    expect(board.projects[6].year).toBeNull();
  });

  it('removes every Award section before reading, so no student name is parsed', () => {
    const parsed = JSON.stringify(parseTobinRaBoard(SAMPLE_BOARD));

    for (const name of AWARD_NAMES) expect(parsed).not.toContain(name);
  });

  it('counts only filled projects with a year and a linked sponsor, per year', () => {
    const years = filledProjectYearsBy(parseTobinRaBoard(SAMPLE_BOARD).projects);

    expect(years.get(sponsorUrl('synthetic-sponsor-a'))).toEqual([
      { year: 2026, programName: TOBIN_RA_PROGRAM_NAME, count: 2 },
      { year: 2024, programName: TOBIN_RA_PROGRAM_NAME, count: 1 },
    ]);
    expect(years.has(sponsorUrl('synthetic-sponsor-d'))).toBe(false);
    expect(years.has(sponsorUrl('synthetic-sponsor-e'))).toBe(false);
  });
});

describe('TobinRaProjectsScraper (#3551)', () => {
  it('emits a name-free advisee history on the row each matched sponsor leads, citing the board', async () => {
    const { ctx, emitted } = contextCollecting();

    const result = await scraperFor(SAMPLE_BOARD).run(ctx);

    expect(adviseesFor(emitted, 'synthetic-row-a')).toEqual([
      { year: 2026, programName: TOBIN_RA_PROGRAM_NAME, count: 2 },
      { year: 2024, programName: TOBIN_RA_PROGRAM_NAME, count: 1 },
    ]);
    expect(adviseesFor(emitted, 'synthetic-row-shared')).toEqual([
      { year: 2025, programName: TOBIN_RA_PROGRAM_NAME, count: 1 },
    ]);
    expect(emitted.every((obs) => obs.sourceUrl === TOBIN_RA_BOARD_URL)).toBe(true);
    expect(emitted.some((obs) => obs.field === 'undergradInvitation')).toBe(false);
    expect(result.entitiesObserved).toBe(2);
    expect(result.notes).toContain('sponsorsUnmatched=0');
  });

  it('never lets an Award name reach an observation, a log line or the run report', async () => {
    const { ctx, emitted, logged } = contextCollecting();

    const result = await scraperFor(SAMPLE_BOARD).run(ctx);

    const output = JSON.stringify({ emitted, logged, result });
    for (const name of AWARD_NAMES) expect(output).not.toContain(name);
  });

  it('skips a sponsor that resolves to no live researcher lead row', async () => {
    const { ctx, emitted } = contextCollecting();
    const scraper = new TobinRaProjectsScraper({
      fetchHtml: async () => SAMPLE_BOARD,
      sponsorRowSlug: async (url) =>
        url === sponsorUrl('synthetic-sponsor-a') ? 'synthetic-row-a' : null,
    });

    const result = await scraper.run(ctx);

    expect(new Set(emitted.map((obs) => obs.entityKey))).toEqual(new Set(['synthetic-row-a']));
    expect(result.notes).toContain('sponsorsUnmatched=2');
  });

  it('refuses a page with no project blocks instead of reading it as empty', async () => {
    const { ctx, emitted } = contextCollecting();

    await expect(scraperFor(boardHtml([])).run(ctx)).rejects.toThrow(/no project blocks/);
    expect(emitted).toEqual([]);
  });

  it('re-derives the same advisee values from the same page on a second run', async () => {
    const first = contextCollecting();
    const second = contextCollecting();

    await scraperFor(SAMPLE_BOARD).run(first.ctx);
    await scraperFor(SAMPLE_BOARD).run(second.ctx);

    const advisees = (emitted: ObservationInput[]) =>
      emitted
        .filter((obs) => obs.field === 'pastUndergradAdvisees')
        .map((obs) => [obs.entityKey, obs.value]);
    expect(advisees(second.emitted)).toEqual(advisees(first.emitted));
  });
});
