import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PEABODY_DIVISIONS_INDEX_URL,
  PeabodyCollectionsResearchScraper,
  divisionToObservations,
  parsePeabodyDivisionPage,
  parsePeabodyDivisionsIndex,
} from '../sources/peabodyCollectionsResearchScraper';
import type { ObservationInput, ScraperContext } from '../types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'peabody', name), 'utf8');

const INDEX_HTML = fixture('collections-index.html');
const ANTHROPOLOGY_HTML = fixture('division-anthropology.html');
const VERTEBRATE_PALEO_HTML = fixture('division-vertebrate-paleontology.html');
const MAMMALOGY_NO_CURATOR_HTML = fixture('division-mammalogy-no-curator.html');

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'peabody-collections-research',
    sourceWeight: 0.85,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
  return { ctx, emitted };
}

describe('peabodyCollectionsResearchScraper', () => {
  it('extracts collections divisions from the index and cites each division page', () => {
    const divisions = parsePeabodyDivisionsIndex(INDEX_HTML, DEFAULT_PEABODY_DIVISIONS_INDEX_URL);

    expect(divisions).toEqual([
      {
        name: 'Anthropology',
        url: 'https://peabody.yale.edu/explore/collections/anthropology',
        slug: 'peabody-anthropology',
      },
      {
        name: 'Vertebrate Paleontology',
        url: 'https://peabody.yale.edu/explore/collections/vertebrate-paleontology',
        slug: 'peabody-vertebrate-paleontology',
      },
      {
        name: 'Mammalogy',
        url: 'https://peabody.yale.edu/explore/collections/mammalogy',
        slug: 'peabody-mammalogy',
      },
    ]);
  });

  it('excludes non-curatorial support areas and sub-pages from the index', () => {
    const slugs = parsePeabodyDivisionsIndex(INDEX_HTML, DEFAULT_PEABODY_DIVISIONS_INDEX_URL).map(
      (division) => division.slug,
    );

    expect(slugs).not.toContain('peabody-information-science');
    expect(slugs.some((slug) => slug.includes('native-american-graves'))).toBe(false);
  });

  it('extracts the division title, description, and single Curator-in-charge lead', () => {
    const division = parsePeabodyDivisionPage(VERTEBRATE_PALEO_HTML, {
      name: 'Vertebrate Paleontology',
      url: 'https://peabody.yale.edu/explore/collections/vertebrate-paleontology',
      slug: 'peabody-vertebrate-paleontology',
    });

    expect(division.entityType).toBe('ARCHIVE_OR_MUSEUM_PROJECT');
    expect(division.name).toBe('Vertebrate Paleontology');
    expect(division.description).toContain('vertebrate systematics, evolution, and paleobiology');
    expect(division.lead).toEqual({
      name: 'Jordan Sawyer',
      role: 'director',
      title: 'Curator-in-charge, Reptiles',
      profileUrl: 'https://people.earth.yale.edu/profile/jordan-sawyer/about',
    });
  });

  it('selects the Curator-in-charge as lead even when other staff are listed first', () => {
    const division = parsePeabodyDivisionPage(ANTHROPOLOGY_HTML, {
      name: 'Anthropology',
      url: 'https://peabody.yale.edu/explore/collections/anthropology',
      slug: 'peabody-anthropology',
    });

    expect(division.lead?.name).toBe('Rowan Casey');
    expect(division.lead?.role).toBe('director');
    expect(division.lead?.profileUrl).toBe('https://anthropology.yale.edu/people/rowan-casey');
  });

  it('fails closed on the lead when no Curator-in-charge is named', () => {
    const division = parsePeabodyDivisionPage(MAMMALOGY_NO_CURATOR_HTML, {
      name: 'Mammalogy',
      url: 'https://peabody.yale.edu/explore/collections/mammalogy',
      slug: 'peabody-mammalogy',
    });

    expect(division.lead).toBeUndefined();
    expect(division.description).toContain('worldwide collection of mammal specimens');
  });

  it('emits museum identity, official-page citation, and an inferred-director lead only', () => {
    const division = parsePeabodyDivisionPage(VERTEBRATE_PALEO_HTML, {
      name: 'Vertebrate Paleontology',
      url: 'https://peabody.yale.edu/explore/collections/vertebrate-paleontology',
      slug: 'peabody-vertebrate-paleontology',
    });
    const observations = divisionToObservations(division);

    const divisionUrl = 'https://peabody.yale.edu/explore/collections/vertebrate-paleontology';
    for (const observation of observations) {
      expect(observation.entityType).toBe('researchEntity');
      expect(observation.entityKey).toBe('peabody-vertebrate-paleontology');
      expect(observation.sourceUrl).toBe(divisionUrl);
    }

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'entityType', value: 'ARCHIVE_OR_MUSEUM_PROJECT' }),
        expect.objectContaining({ field: 'websiteUrl', value: divisionUrl }),
        expect.objectContaining({ field: 'sourceUrls', value: [divisionUrl] }),
        expect.objectContaining({ field: 'inferredDirectorName', value: 'Jordan Sawyer' }),
        expect.objectContaining({
          field: 'inferredDirectorUserName',
          value: { fname: 'Jordan', lname: 'Sawyer' },
        }),
        expect.objectContaining({ field: 'inferredDirectorRole', value: 'director' }),
        expect.objectContaining({
          field: 'inferredDirectorProfileUrl',
          value: 'https://people.earth.yale.edu/profile/jordan-sawyer/about',
        }),
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

  it('never cites the divisions index root as a source', () => {
    const division = parsePeabodyDivisionPage(ANTHROPOLOGY_HTML, {
      name: 'Anthropology',
      url: 'https://peabody.yale.edu/explore/collections/anthropology',
      slug: 'peabody-anthropology',
    });
    const observations = divisionToObservations(division);

    expect(
      observations.every(
        (observation) => observation.sourceUrl !== DEFAULT_PEABODY_DIVISIONS_INDEX_URL,
      ),
    ).toBe(true);
  });

  it('walks the index then fetches each division page and honors --only and --limit', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === DEFAULT_PEABODY_DIVISIONS_INDEX_URL) return INDEX_HTML;
      if (url.endsWith('/vertebrate-paleontology')) return VERTEBRATE_PALEO_HTML;
      if (url.endsWith('/anthropology')) return ANTHROPOLOGY_HTML;
      if (url.endsWith('/mammalogy')) return MAMMALOGY_NO_CURATOR_HTML;
      return '<main></main>';
    });
    const scraper = new PeabodyCollectionsResearchScraper(undefined, fetchHtml);
    const { ctx, emitted } = makeContext({ only: ['vertebrate-paleontology'] });

    const result = await scraper.run(ctx);

    expect(fetchHtml).toHaveBeenCalledWith(
      DEFAULT_PEABODY_DIVISIONS_INDEX_URL,
      false,
      'peabody-collections-research',
    );
    expect(fetchHtml).toHaveBeenCalledWith(
      'https://peabody.yale.edu/explore/collections/vertebrate-paleontology',
      false,
      'peabody-collections-research',
    );
    expect(fetchHtml).not.toHaveBeenCalledWith(
      expect.stringContaining('/anthropology'),
      expect.anything(),
      expect.anything(),
    );
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(result.notes).toContain('withCuratorialLead=1');
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchHtml = vi.fn(async () => '<main></main>');
    const scraper = new PeabodyCollectionsResearchScraper(undefined, fetchHtml);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});
