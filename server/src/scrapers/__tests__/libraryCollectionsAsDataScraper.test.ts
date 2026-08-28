import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ONLINE_EXHIBITS_BASE_URL,
  LibraryCollectionsAsDataScraper,
  exhibitToObservations,
  extractCuratorialLead,
  parseExhibitPage,
  parseExhibitsIndex,
} from '../sources/libraryCollectionsAsDataScraper';
import type { ObservationInput, ScraperContext } from '../types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'library-collections', name), 'utf8');

const SITES_API_JSON = fixture('sites-api.json');
const PROSPECTS_HTML = fixture('exhibit-prospects.html');
const MARKS_HTML = fixture('exhibit-marks-in-lawbooks.html');
const NO_CREDIT_HTML = fixture('exhibit-no-credit.html');

const BASE = DEFAULT_ONLINE_EXHIBITS_BASE_URL;
const SITES_API_URL = `${BASE}/api/sites?per_page=200`;

const PROSPECTS_LINK = {
  slug: 'prospectsofempire',
  title: 'Prospects of Empire: Slavery and Ecology in Eighteenth-Century Atlantic Britain',
  summary: 'Prospects of Empire explores the notion of empire.',
  entityKey: 'yul-exhibit-prospectsofempire',
  url: `${BASE}/s/prospectsofempire`,
};

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'library-collections-as-data',
    sourceWeight: 0.85,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
  return { ctx, emitted };
}

describe('libraryCollectionsAsDataScraper', () => {
  it('keeps only public exhibitions with a summary and skips the meta/utility sites', () => {
    const exhibits = parseExhibitsIndex(SITES_API_JSON, BASE);

    expect(exhibits.map((e) => e.slug)).toEqual(['prospectsofempire', 'marks-in-lawbooks']);
    expect(exhibits[0]).toEqual({
      slug: 'prospectsofempire',
      title: 'Prospects of Empire: Slavery and Ecology in Eighteenth-Century Atlantic Britain',
      summary: expect.stringContaining('explores the notion of empire'),
      entityKey: 'yul-exhibit-prospectsofempire',
      url: `${BASE}/s/prospectsofempire`,
    });
  });

  it('drops the browse index, utility sites, empty-summary and non-public sites', () => {
    const slugs = parseExhibitsIndex(SITES_API_JSON, BASE).map((e) => e.slug);
    expect(slugs).not.toContain('browse-yul-exhibits');
    expect(slugs).not.toContain('more');
    expect(slugs).not.toContain('YJIL-50');
    expect(slugs).not.toContain('staff-preview-draft');
  });

  it('returns an empty list for malformed JSON', () => {
    expect(parseExhibitsIndex('not json', BASE)).toEqual([]);
  });

  it('extracts a faculty "curated by" credit as the single director lead', () => {
    expect(extractCuratorialLead('The exhibition, curated by Hazel V. Carby, Professor.')).toEqual({
      name: 'Hazel V. Carby',
      role: 'director',
    });
  });

  it('extracts a librarian curator and keeps only the first named curator', () => {
    expect(
      extractCuratorialLead('Credits: Curated by Mike Widener, Rare Book Librarian, with Ryan Martins.'),
    ).toEqual({ name: 'Mike Widener', role: 'director' });
  });

  it('fails closed when no personal curator credit is published', () => {
    expect(extractCuratorialLead('Organized by the Lillian Goldman Law Library staff.')).toBeUndefined();
    expect(extractCuratorialLead('An exhibition of rare books and manuscripts.')).toBeUndefined();
    expect(extractCuratorialLead('Curated by the Exhibitions Committee.')).toBeUndefined();
  });

  it('fails closed on plural-doctor and honorific credits that name no single person', () => {
    expect(extractCuratorialLead('Curated by Drs. Jean Bolognia, Yale School of Medicine.')).toBeUndefined();
    expect(extractCuratorialLead('Curated by Prof. Sample.')).toBeUndefined();
  });

  it('parses an exhibition page into a COLLECTIONS_INITIATIVE with its curator lead', () => {
    const exhibit = parseExhibitPage(PROSPECTS_HTML, PROSPECTS_LINK);
    expect(exhibit.entityType).toBe('COLLECTIONS_INITIATIVE');
    expect(exhibit.kind).toBe('group');
    expect(exhibit.title).toContain('Prospects of Empire');
    expect(exhibit.lead).toEqual({ name: 'Hazel V. Carby', role: 'director' });
  });

  it('parses a lead-less exhibition page and fails closed on the lead', () => {
    const exhibit = parseExhibitPage(NO_CREDIT_HTML, {
      ...PROSPECTS_LINK,
      slug: 'YJIL-50',
      title: 'Yale Journal of International Law at 50',
      entityKey: 'yul-exhibit-yjil-50',
      url: `${BASE}/s/YJIL-50`,
    });
    expect(exhibit.entityType).toBe('COLLECTIONS_INITIATIVE');
    expect(exhibit.lead).toBeUndefined();
  });

  it('emits identity, official-page citation, description, and an inferred-director lead only', () => {
    const exhibit = parseExhibitPage(PROSPECTS_HTML, PROSPECTS_LINK);
    const observations = exhibitToObservations(exhibit);
    const url = `${BASE}/s/prospectsofempire`;

    for (const observation of observations) {
      expect(observation.entityType).toBe('researchEntity');
      expect(observation.entityKey).toBe('yul-exhibit-prospectsofempire');
      expect(observation.sourceUrl).toBe(url);
    }

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'slug', value: 'yul-exhibit-prospectsofempire' }),
        expect.objectContaining({ field: 'entityType', value: 'COLLECTIONS_INITIATIVE' }),
        expect.objectContaining({ field: 'websiteUrl', value: url }),
        expect.objectContaining({ field: 'sourceUrls', value: [url] }),
        expect.objectContaining({ field: 'fullDescription' }),
        expect.objectContaining({ field: 'inferredDirectorName', value: 'Hazel V. Carby' }),
        expect.objectContaining({
          field: 'inferredDirectorUserName',
          value: { fname: 'Hazel', lname: 'Carby' },
        }),
        expect.objectContaining({ field: 'inferredDirectorRole', value: 'director' }),
      ]),
    );

    expect(observations.map((o) => o.field)).not.toEqual(
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

  it('never cites the sites index or the browse landing site as a source', () => {
    const observations = exhibitToObservations(parseExhibitPage(PROSPECTS_HTML, PROSPECTS_LINK));
    expect(
      observations.every(
        (o) =>
          o.sourceUrl !== SITES_API_URL &&
          o.sourceUrl !== `${BASE}/s/browse-yul-exhibits` &&
          o.sourceUrl !== BASE,
      ),
    ).toBe(true);
  });

  it('walks the sites API then fetches each exhibition and honors --only and --limit', async () => {
    const fetchText = vi.fn(async (url: string) => {
      if (url === SITES_API_URL) return SITES_API_JSON;
      if (url.endsWith('/s/prospectsofempire')) return PROSPECTS_HTML;
      if (url.endsWith('/s/marks-in-lawbooks')) return MARKS_HTML;
      return '<main></main>';
    });
    const scraper = new LibraryCollectionsAsDataScraper(BASE, fetchText);
    const { ctx, emitted } = makeContext({ only: ['prospectsofempire'] });

    const result = await scraper.run(ctx);

    expect(fetchText).toHaveBeenCalledWith(SITES_API_URL, false, 'library-collections-as-data');
    expect(fetchText).toHaveBeenCalledWith(
      `${BASE}/s/prospectsofempire`,
      false,
      'library-collections-as-data',
    );
    expect(fetchText).not.toHaveBeenCalledWith(
      expect.stringContaining('/s/marks-in-lawbooks'),
      expect.anything(),
      expect.anything(),
    );
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(result.notes).toContain('withCuratorialLead=1');
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchText = vi.fn(async () => '<main></main>');
    const scraper = new LibraryCollectionsAsDataScraper(BASE, fetchText);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchText).not.toHaveBeenCalled();
  });
});
