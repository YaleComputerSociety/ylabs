import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  YCBA_DEPARTMENT_SEEDS,
  YaleCenterBritishArtScraper,
  departmentToObservations,
  parseYcbaDepartmentPage,
} from '../sources/yaleCenterBritishArtScraper';
import type { ObservationInput, ScraperContext } from '../types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'ycba', name), 'utf8');

const PAINTINGS_HTML = fixture('paintings-and-sculpture.html');
const RARE_BOOKS_HTML = fixture('rare-books-and-manuscripts.html');
const CONSERVATION_NO_INTRO_HTML = fixture('conservation-no-intro.html');

const PAINTINGS_SEED = {
  name: 'Paintings and Sculpture',
  url: 'https://britishart.yale.edu/paintings-and-sculpture',
  slug: 'ycba-paintings-and-sculpture',
};

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'ycba-collections-research',
    sourceWeight: 0.85,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
  return { ctx, emitted };
}

describe('yaleCenterBritishArtScraper', () => {
  it('seeds only individual department pages, never a museum landing/index root', () => {
    for (const seed of YCBA_DEPARTMENT_SEEDS) {
      expect(seed.url).toMatch(/^https:\/\/britishart\.yale\.edu\/[a-z0-9-]+$/);
      expect(seed.slug.startsWith('ycba-')).toBe(true);
    }
    const urls = YCBA_DEPARTMENT_SEEDS.map((seed) => seed.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).not.toContain('https://britishart.yale.edu/collections-departments');
    expect(urls).not.toContain('https://britishart.yale.edu/departments-and-staff');
  });

  it('extracts the department title and official-page description', () => {
    const department = parseYcbaDepartmentPage(PAINTINGS_HTML, PAINTINGS_SEED);

    expect(department.entityType).toBe('ARCHIVE_OR_MUSEUM_PROJECT');
    expect(department.name).toBe('Paintings and Sculpture');
    expect(department.description).toContain('paintings and sculptures');
    expect(department.lead).toBeUndefined();
  });

  it('fails closed on the description when the page publishes no substantial intro', () => {
    const department = parseYcbaDepartmentPage(CONSERVATION_NO_INTRO_HTML, {
      name: 'Conservation',
      url: 'https://britishart.yale.edu/conservation',
      slug: 'ycba-conservation',
    });

    expect(department.name).toBe('Conservation');
    expect(department.description).toBeUndefined();
    expect(department.lead).toBeUndefined();
  });

  it('emits museum identity and the official-page citation, with no access or contact fields', () => {
    const department = parseYcbaDepartmentPage(RARE_BOOKS_HTML, {
      name: 'Rare Books and Manuscripts',
      url: 'https://britishart.yale.edu/rare-books-and-manuscripts',
      slug: 'ycba-rare-books-and-manuscripts',
    });
    const observations = departmentToObservations(department);
    const url = 'https://britishart.yale.edu/rare-books-and-manuscripts';

    for (const observation of observations) {
      expect(observation.entityType).toBe('researchEntity');
      expect(observation.entityKey).toBe('ycba-rare-books-and-manuscripts');
      expect(observation.sourceUrl).toBe(url);
    }

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entityType', value: 'ARCHIVE_OR_MUSEUM_PROJECT' }),
        expect.objectContaining({ field: 'websiteUrl', value: url }),
        expect.objectContaining({ field: 'sourceUrls', value: [url] }),
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
      ]),
    );
  });

  it('fetches each configured department page and honors --only and --limit', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.endsWith('/paintings-and-sculpture')) return PAINTINGS_HTML;
      if (url.endsWith('/rare-books-and-manuscripts')) return RARE_BOOKS_HTML;
      return '<main></main>';
    });
    const scraper = new YaleCenterBritishArtScraper(YCBA_DEPARTMENT_SEEDS, fetchHtml);
    const { ctx, emitted } = makeContext({ only: ['ycba-rare-books-and-manuscripts'] });

    const result = await scraper.run(ctx);

    expect(fetchHtml).toHaveBeenCalledWith(
      'https://britishart.yale.edu/rare-books-and-manuscripts',
      false,
      'ycba-collections-research',
    );
    expect(fetchHtml).not.toHaveBeenCalledWith(
      expect.stringContaining('/paintings-and-sculpture'),
      expect.anything(),
      expect.anything(),
    );
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(result.notes).toContain('withCuratorialLead=0');
  });

  it('skips a department whose page is unavailable rather than emitting a shell', async () => {
    const fetchHtml = vi.fn(async () => '');
    const scraper = new YaleCenterBritishArtScraper(
      [PAINTINGS_SEED],
      fetchHtml,
    );
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchHtml = vi.fn(async () => '<main></main>');
    const scraper = new YaleCenterBritishArtScraper(YCBA_DEPARTMENT_SEEDS, fetchHtml);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});
