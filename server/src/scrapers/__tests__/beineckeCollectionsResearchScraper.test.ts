import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  BeineckeCollectionsResearchScraper,
  DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL,
  parseBeineckeFellowshipsIndex,
  parseBeineckeProgramPage,
  programToObservations,
} from '../sources/beineckeCollectionsResearchScraper';
import type { ObservationInput, ScraperContext } from '../types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'beinecke', name), 'utf8');

const INDEX_HTML = fixture('fellowships-index.html');
const SHORT_TERM_HTML = fixture('program-short-term.html');
const GRADUATE_HTML = fixture('program-graduate-students.html');
const NO_DESCRIPTION_HTML = fixture('program-no-description.html');

const SHORT_TERM_URL =
  'https://beinecke.library.yale.edu/beinecke/researchers/fellowships/short-term';
const GRADUATE_URL =
  'https://beinecke.library.yale.edu/beinecke/researchers/fellowships/research-fellowships-graduate-students';
const PLACEHOLDER_URL =
  'https://beinecke.library.yale.edu/beinecke/researchers/fellowships/placeholder-program';

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'beinecke-collections-research',
    sourceWeight: 0.85,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
  return { ctx, emitted };
}

describe('beineckeCollectionsResearchScraper', () => {
  it('extracts fellowship programs from the index and cites each program page', () => {
    const programs = parseBeineckeFellowshipsIndex(
      INDEX_HTML,
      DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL,
    );

    expect(programs).toEqual([
      {
        name: 'Short-Term Research Fellowships',
        url: SHORT_TERM_URL,
        slug: 'beinecke-short-term',
      },
      {
        name: 'Research Fellowships for Graduate Students',
        url: GRADUATE_URL,
        slug: 'beinecke-research-fellowships-graduate-students',
      },
      {
        name: 'Placeholder Program',
        url: PLACEHOLDER_URL,
        slug: 'beinecke-placeholder-program',
      },
    ]);
  });

  it('excludes FAQ chrome and self-referential index links from the index', () => {
    const slugs = parseBeineckeFellowshipsIndex(
      INDEX_HTML,
      DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL,
    ).map((program) => program.slug);

    expect(slugs).not.toContain('beinecke-fellowship-faq');
    expect(slugs.some((slug) => slug.includes('services'))).toBe(false);
  });

  it('extracts the program title and official-page description, skipping the alert banner', () => {
    const program = parseBeineckeProgramPage(SHORT_TERM_HTML, {
      name: 'Short-Term Research Fellowships',
      url: SHORT_TERM_URL,
      slug: 'beinecke-short-term',
    });

    expect(program.entityType).toBe('ARCHIVE_OR_MUSEUM_PROJECT');
    expect(program.name).toBe('Short-Term Research Fellowships');
    expect(program.description).toContain('short-term fellowships to facilitate research projects');
    expect(program.description).not.toContain('synthetic test window');
    expect(program.description).not.toContain('application process');
    expect(program.description).not.toContain('Sample Scholar');
  });

  it('fails closed on the description when the program page has no own-page prose', () => {
    const program = parseBeineckeProgramPage(NO_DESCRIPTION_HTML, {
      name: 'Placeholder Program',
      url: PLACEHOLDER_URL,
      slug: 'beinecke-placeholder-program',
    });

    expect(program.description).toBeUndefined();
  });

  it('emits museum identity and an official-page citation only, with no contact or access data', () => {
    const program = parseBeineckeProgramPage(SHORT_TERM_HTML, {
      name: 'Short-Term Research Fellowships',
      url: SHORT_TERM_URL,
      slug: 'beinecke-short-term',
    });
    const observations = programToObservations(program);

    for (const observation of observations) {
      expect(observation.entityType).toBe('researchEntity');
      expect(observation.entityKey).toBe('beinecke-short-term');
      expect(observation.sourceUrl).toBe(SHORT_TERM_URL);
    }

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entityType', value: 'ARCHIVE_OR_MUSEUM_PROJECT' }),
        expect.objectContaining({ field: 'websiteUrl', value: SHORT_TERM_URL }),
        expect.objectContaining({ field: 'sourceUrls', value: [SHORT_TERM_URL] }),
        expect.objectContaining({ field: 'fullDescription' }),
      ]),
    );

    expect(observations.map((observation) => observation.field)).not.toEqual(
      expect.arrayContaining([
        'acceptingUndergrads',
        'undergradAccessEvidence',
        'contactEmail',
        'contactRouteType',
        'joinPageUrl',
        'postedOpportunity',
        'inferredDirectorName',
      ]),
    );
  });

  it('never cites the fellowships index root as a source', () => {
    const program = parseBeineckeProgramPage(SHORT_TERM_HTML, {
      name: 'Short-Term Research Fellowships',
      url: SHORT_TERM_URL,
      slug: 'beinecke-short-term',
    });
    const observations = programToObservations(program);

    expect(
      observations.every(
        (observation) => observation.sourceUrl !== DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL,
      ),
    ).toBe(true);
  });

  it('walks the index, fetches each program page, and skips programs with no own-page description', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL) return INDEX_HTML;
      if (url === SHORT_TERM_URL) return SHORT_TERM_HTML;
      if (url === GRADUATE_URL) return GRADUATE_HTML;
      if (url === PLACEHOLDER_URL) return NO_DESCRIPTION_HTML;
      return '<main></main>';
    });
    const scraper = new BeineckeCollectionsResearchScraper(undefined, fetchHtml);
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetchHtml).toHaveBeenCalledWith(
      DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL,
      false,
      'beinecke-collections-research',
    );
    expect(result.entitiesObserved).toBe(2);
    expect(result.observationCount).toBe(emitted.length);
    expect(result.notes).toContain('skippedNoDescription=1');
    expect(
      emitted.every(
        (observation) => observation.sourceUrl !== DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL,
      ),
    ).toBe(true);
  });

  it('honors --only and fetches just the selected program', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL) return INDEX_HTML;
      if (url === SHORT_TERM_URL) return SHORT_TERM_HTML;
      if (url === GRADUATE_URL) return GRADUATE_HTML;
      if (url === PLACEHOLDER_URL) return NO_DESCRIPTION_HTML;
      return '<main></main>';
    });
    const scraper = new BeineckeCollectionsResearchScraper(undefined, fetchHtml);
    const { ctx } = makeContext({ only: ['short-term'] });

    const result = await scraper.run(ctx);

    expect(fetchHtml).toHaveBeenCalledWith(
      SHORT_TERM_URL,
      false,
      'beinecke-collections-research',
    );
    expect(fetchHtml).not.toHaveBeenCalledWith(
      GRADUATE_URL,
      expect.anything(),
      expect.anything(),
    );
    expect(result.entitiesObserved).toBe(1);
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchHtml = vi.fn(async () => '<main></main>');
    const scraper = new BeineckeCollectionsResearchScraper(undefined, fetchHtml);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});
