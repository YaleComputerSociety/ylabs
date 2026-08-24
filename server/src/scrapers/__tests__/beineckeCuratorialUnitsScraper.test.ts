import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL,
  BeineckeCuratorialUnitsScraper,
  parseBeineckeCuratorialUnitsIndex,
  parseBeineckeUnitPage,
  unitToObservations,
} from '../sources/beineckeCuratorialUnitsScraper';
import type { ObservationInput, ScraperContext } from '../types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'beinecke-curatorial-units', name), 'utf8');

const INDEX_HTML = fixture('collections-index.html');
const OSBORN_HTML = fixture('unit-osborn-collection.html');
const AMERICAN_LITERATURE_HTML = fixture('unit-american-literature.html');
const NO_INTRO_HTML = fixture('unit-no-intro.html');

const STRUCTURED_CURATOR_HTML = `
  <main>
    <h1 class="field--name-title">Hypothetical Structured Unit</h1>
    <h2 class="intro">A hypothetical unit page that carries a structured curator credit card.</h2>
    <div class="staff-info-container-table">
      <span class="staff-role"><em>Curator of the Collection</em></span>
      <span class="staff-name"><strong>Ada Lovelace</strong></span>
      <a href="https://beinecke.library.yale.edu/staff/ada-lovelace">Profile</a>
    </div>
  </main>`;

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'beinecke-curatorial-units',
    sourceWeight: 0.85,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
  return { ctx, emitted };
}

describe('beineckeCuratorialUnitsScraper', () => {
  it('extracts curatorial units from the index and cites each unit page', () => {
    const units = parseBeineckeCuratorialUnitsIndex(
      INDEX_HTML,
      DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL,
    );

    expect(units).toEqual([
      {
        name: 'Americana',
        url: 'https://beinecke.library.yale.edu/beinecke/collections/americana',
        slug: 'beinecke-americana',
      },
      {
        name: 'Osborn Collection',
        url: 'https://beinecke.library.yale.edu/beinecke/collections/osborn-collection',
        slug: 'beinecke-osborn-collection',
      },
      {
        name: 'Yale Collection of American Literature',
        url: 'https://beinecke.library.yale.edu/beinecke/collections/yale-collection-american-literature',
        slug: 'beinecke-yale-collection-american-literature',
      },
    ]);
  });

  it('excludes the about-collections meta page and nav-menu links from the index', () => {
    const slugs = parseBeineckeCuratorialUnitsIndex(
      INDEX_HTML,
      DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL,
    ).map((unit) => unit.slug);

    expect(slugs).not.toContain('beinecke-about-collections');
    expect(slugs).not.toContain('beinecke-researchers');
  });

  it('extracts the unit title and self-contained official-page description', () => {
    const unit = parseBeineckeUnitPage(OSBORN_HTML, {
      name: 'Osborn Collection',
      url: 'https://beinecke.library.yale.edu/beinecke/collections/osborn-collection',
      slug: 'beinecke-osborn-collection',
    });

    expect(unit.entityType).toBe('ARCHIVE_OR_MUSEUM_PROJECT');
    expect(unit.name).toBe('Osborn Collection');
    expect(unit.description).toBe(
      'The Osborn Collection documents literature, history, court culture, and colonial encounter across the United Kingdom and the British Empire.',
    );
    expect(unit.lead).toBeUndefined();
  });

  it('fails closed on the lead when a unit only mentions curators in body prose', () => {
    const unit = parseBeineckeUnitPage(AMERICAN_LITERATURE_HTML, {
      name: 'Yale Collection of American Literature',
      url: 'https://beinecke.library.yale.edu/beinecke/collections/yale-collection-american-literature',
      slug: 'beinecke-yale-collection-american-literature',
    });

    expect(unit.lead).toBeUndefined();
    expect(unit.description).toContain('creative lives');
  });

  it('leaves the description undefined when a unit publishes no summary', () => {
    const unit = parseBeineckeUnitPage(NO_INTRO_HTML, {
      name: 'Maps Collection',
      url: 'https://beinecke.library.yale.edu/beinecke/collections/maps-collection',
      slug: 'beinecke-maps-collection',
    });

    expect(unit.name).toBe('Maps Collection');
    expect(unit.description).toBeUndefined();
    expect(unit.lead).toBeUndefined();
  });

  it('extracts a named curatorial lead only from a structured staff-credit card', () => {
    const unit = parseBeineckeUnitPage(STRUCTURED_CURATOR_HTML, {
      name: 'Hypothetical Structured Unit',
      url: 'https://beinecke.library.yale.edu/beinecke/collections/hypothetical-structured-unit',
      slug: 'beinecke-hypothetical-structured-unit',
    });

    expect(unit.lead).toEqual({
      name: 'Ada Lovelace',
      role: 'director',
      title: 'Curator of the Collection',
      profileUrl: 'https://beinecke.library.yale.edu/staff/ada-lovelace',
    });

    const observations = unitToObservations(unit);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'inferredDirectorName', value: 'Ada Lovelace' }),
        expect.objectContaining({
          field: 'inferredDirectorUserName',
          value: { fname: 'Ada', lname: 'Lovelace' },
        }),
        expect.objectContaining({ field: 'inferredDirectorRole', value: 'director' }),
        expect.objectContaining({
          field: 'inferredDirectorProfileUrl',
          value: 'https://beinecke.library.yale.edu/staff/ada-lovelace',
        }),
      ]),
    );
  });

  it('emits museum identity and official-page citation only, never contact or access claims', () => {
    const unit = parseBeineckeUnitPage(OSBORN_HTML, {
      name: 'Osborn Collection',
      url: 'https://beinecke.library.yale.edu/beinecke/collections/osborn-collection',
      slug: 'beinecke-osborn-collection',
    });
    const observations = unitToObservations(unit);

    const unitUrl = 'https://beinecke.library.yale.edu/beinecke/collections/osborn-collection';
    for (const observation of observations) {
      expect(observation.entityType).toBe('researchEntity');
      expect(observation.entityKey).toBe('beinecke-osborn-collection');
      expect(observation.sourceUrl).toBe(unitUrl);
    }

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entityType', value: 'ARCHIVE_OR_MUSEUM_PROJECT' }),
        expect.objectContaining({ field: 'websiteUrl', value: unitUrl }),
        expect.objectContaining({ field: 'sourceUrls', value: [unitUrl] }),
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

  it('never cites the units index root as a source', () => {
    const unit = parseBeineckeUnitPage(OSBORN_HTML, {
      name: 'Osborn Collection',
      url: 'https://beinecke.library.yale.edu/beinecke/collections/osborn-collection',
      slug: 'beinecke-osborn-collection',
    });
    const observations = unitToObservations(unit);

    expect(
      observations.every(
        (observation) => observation.sourceUrl !== DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL,
      ),
    ).toBe(true);
  });

  it('walks the index then fetches each unit page and honors --only and --limit', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL) return INDEX_HTML;
      if (url.endsWith('/osborn-collection')) return OSBORN_HTML;
      if (url.endsWith('/americana')) return AMERICAN_LITERATURE_HTML;
      if (url.endsWith('/yale-collection-american-literature')) return AMERICAN_LITERATURE_HTML;
      return '<main></main>';
    });
    const scraper = new BeineckeCuratorialUnitsScraper(undefined, fetchHtml);
    const { ctx, emitted } = makeContext({ only: ['osborn-collection'] });

    const result = await scraper.run(ctx);

    expect(fetchHtml).toHaveBeenCalledWith(
      DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL,
      false,
      'beinecke-curatorial-units',
    );
    expect(fetchHtml).toHaveBeenCalledWith(
      'https://beinecke.library.yale.edu/beinecke/collections/osborn-collection',
      false,
      'beinecke-curatorial-units',
    );
    expect(fetchHtml).not.toHaveBeenCalledWith(
      expect.stringContaining('/americana'),
      expect.anything(),
      expect.anything(),
    );
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(result.notes).toContain('withCuratorialLead=0');
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchHtml = vi.fn(async () => '<main></main>');
    const scraper = new BeineckeCuratorialUnitsScraper(undefined, fetchHtml);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});
