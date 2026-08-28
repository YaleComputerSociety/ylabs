import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL,
  YaleUniversityArtGalleryScraper,
  areaToObservations,
  parseYuagAreaPage,
  parseYuagCuratorialAreasIndex,
} from '../sources/yaleUniversityArtGalleryScraper';
import type { ObservationInput, ScraperContext } from '../types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'yuag', name), 'utf8');

const INDEX_HTML = fixture('curatorial-areas-index.html');
const ASIAN_ART_HTML = fixture('asian-art.html');
const EUROPEAN_ART_HTML = fixture('european-art.html');
const NUMISMATICS_HTML = fixture('numismatics.html');

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'yuag-curatorial-areas',
    sourceWeight: 0.85,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
  return { ctx, emitted };
}

describe('yaleUniversityArtGalleryScraper', () => {
  it('extracts curatorial areas from the index and cites each area page', () => {
    const areas = parseYuagCuratorialAreasIndex(
      INDEX_HTML,
      DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL,
    );

    expect(areas).toEqual([
      {
        name: 'Asian Art',
        url: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas/asian-art',
        slug: 'yuag-asian-art',
      },
      {
        name: 'European Art',
        url: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas/european-art',
        slug: 'yuag-european-art',
      },
      {
        name: 'Numismatics',
        url: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas/numismatics',
        slug: 'yuag-numismatics',
      },
    ]);
  });

  it('excludes deeper sub-pages and global nav links from the index', () => {
    const slugs = parseYuagCuratorialAreasIndex(
      INDEX_HTML,
      DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL,
    ).map((area) => area.slug);

    expect(slugs.some((slug) => slug.includes('digital-archives'))).toBe(false);
    expect(slugs).not.toContain('yuag-curatorial-areas');
  });

  it('extracts the area title and description from the hero and body-text', () => {
    const area = parseYuagAreaPage(ASIAN_ART_HTML, {
      name: 'Asian Art',
      url: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas/asian-art',
      slug: 'yuag-asian-art',
    });

    expect(area.entityType).toBe('ARCHIVE_OR_MUSEUM_PROJECT');
    expect(area.name).toBe('Asian Art');
    expect(area.description).toContain('East, South, and Southeast Asia');
    expect(area.lead).toBeUndefined();
  });

  it('promotes a structured named curator to an inferred-director lead when published', () => {
    const area = parseYuagAreaPage(EUROPEAN_ART_HTML, {
      name: 'European Art',
      url: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas/european-art',
      slug: 'yuag-european-art',
    });

    expect(area.lead).toEqual({
      name: 'Morgan Reyes',
      role: 'director',
      title: 'Curator of European Art',
      profileUrl: 'https://arthistory.yale.edu/people/morgan-reyes',
    });
  });

  it('emits museum identity, official-page citation, and an inferred-director lead only', () => {
    const area = parseYuagAreaPage(EUROPEAN_ART_HTML, {
      name: 'European Art',
      url: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas/european-art',
      slug: 'yuag-european-art',
    });
    const observations = areaToObservations(area);
    const areaUrl =
      'https://artgallery.yale.edu/research-and-learning/curatorial-areas/european-art';

    for (const observation of observations) {
      expect(observation.entityType).toBe('researchEntity');
      expect(observation.entityKey).toBe('yuag-european-art');
      expect(observation.sourceUrl).toBe(areaUrl);
    }

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entityType', value: 'ARCHIVE_OR_MUSEUM_PROJECT' }),
        expect.objectContaining({ field: 'websiteUrl', value: areaUrl }),
        expect.objectContaining({ field: 'sourceUrls', value: [areaUrl] }),
        expect.objectContaining({ field: 'inferredDirectorName', value: 'Morgan Reyes' }),
        expect.objectContaining({
          field: 'inferredDirectorUserName',
          value: { fname: 'Morgan', lname: 'Reyes' },
        }),
        expect.objectContaining({ field: 'inferredDirectorRole', value: 'director' }),
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

  it('never cites the curatorial-areas index root as a source', () => {
    const area = parseYuagAreaPage(NUMISMATICS_HTML, {
      name: 'Numismatics',
      url: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas/numismatics',
      slug: 'yuag-numismatics',
    });
    const observations = areaToObservations(area);

    expect(
      observations.every(
        (observation) => observation.sourceUrl !== DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL,
      ),
    ).toBe(true);
  });

  it('walks the index then fetches each area page and honors --only and --limit', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL) return INDEX_HTML;
      if (url.endsWith('/asian-art')) return ASIAN_ART_HTML;
      if (url.endsWith('/european-art')) return EUROPEAN_ART_HTML;
      if (url.endsWith('/numismatics')) return NUMISMATICS_HTML;
      return '';
    });
    const scraper = new YaleUniversityArtGalleryScraper(undefined, fetchHtml);
    const { ctx, emitted } = makeContext({ only: ['european-art'] });

    const result = await scraper.run(ctx);

    expect(fetchHtml).toHaveBeenCalledWith(
      DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL,
      false,
      'yuag-curatorial-areas',
    );
    expect(fetchHtml).toHaveBeenCalledWith(
      'https://artgallery.yale.edu/research-and-learning/curatorial-areas/european-art',
      false,
      'yuag-curatorial-areas',
    );
    expect(fetchHtml).not.toHaveBeenCalledWith(
      expect.stringContaining('/asian-art'),
      expect.anything(),
      expect.anything(),
    );
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(result.notes).toContain('withCuratorialLead=1');
  });

  it('fails closed and emits nothing when the rendered index is unavailable', async () => {
    const fetchHtml = vi.fn(async () => '');
    const scraper = new YaleUniversityArtGalleryScraper(undefined, fetchHtml);
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toHaveLength(0);
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(result.notes).toContain('rendered-index-unavailable');
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchHtml = vi.fn(async () => '');
    const scraper = new YaleUniversityArtGalleryScraper(undefined, fetchHtml);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});
