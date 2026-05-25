import { describe, expect, it, vi } from 'vitest';
import {
  CORE_LISTING_URL,
  CENTERS_LISTING_URL,
  RESOURCES_LISTING_URL,
  YaleResearchOfficialScraper,
  coreDirectoryEntitiesToObservations,
  inferCenterKind,
  parseCenterDirectory,
  parseCoreDirectory,
  resourceDirectoryEntitiesToObservations,
  parseResourceDirectory,
} from '../sources/yaleResearchOfficialScraper';
import type { ObservationInput, ScraperContext } from '../types';

const CENTERS_HTML = `
<html><body>
  <main>
    <ol class="listing-items">
      <li class="item">
        <h3><a href="https://westcampus.yale.edu/institutes/biomolecular-design-and-discovery"> Institute of Biomolecular Design and Discovery (IBDD)</a></h3>
        <ul class="item__types">
          <li class="item__type">Medical &amp; health sciences</li>
          <li class="item__type">Sciences &amp; engineering</li>
        </ul>
        <p class="item__summary">IBDD focuses on the discovery of new biological molecules and their application to problems in biology and medicine.</p>
      </li>
      <li class="item">
        <h3><a href="https://geospatial.yale.edu/">Yale Center for Geospatial Solutions</a></h3>
        <ul class="item__types">
          <li class="item__type">Arts, humanities, &amp; social sciences</li>
          <li class="item__type">Sciences &amp; engineering</li>
        </ul>
        <p class="item__summary">The Yale Center for Geospatial Solutions focuses on geospatial science, data, and analysis.</p>
      </li>
    </ol>
    <nav class="pager"><a rel="next" href="/centers-institutes?page=1">Next page</a></nav>
  </main>
</body></html>
`;

const CORES_HTML = `
<html><body>
  <section class="research-cores-listing">
    <div class="cores-card listing-item card--listing">
      <div class="card__type">Services</div>
      <div class="card__content__inner">
        <h2><a href="/cores/ycmd/assay-design">Assay design</a></h2>
        <p>YCMD can work with you to help identify and design an assay suitable for high-throughput screening.</p>
        <div class="card__content__parent-facility">
          <span>Located within</span>
          <a href="/cores/ycmd">Yale Center for Molecular Discovery</a>
        </div>
      </div>
    </div>
    <div class="cores-card listing-item card--listing">
      <div class="card__type">Core/facility</div>
      <div class="card__content__inner">
        <h2><a href="/cores/ycga">Yale Center for Genome Analysis (YCGA)</a></h2>
        <p>The Yale Center for Genome Analysis is a full-service facility dedicated to high-throughput sequencing.</p>
      </div>
    </div>
  </section>
</body></html>
`;

const RESOURCES_HTML = `
<html><body>
  <ol class="listing-items">
    <li class="item">
      <h3><a href="https://ventures.yale.edu/yale-center-biomedical-innovation-and-technology">Center for Biomedical Innovation and Technology (CBIT)</a></h3>
      <ul class="item__types">
        <li class="item__type">Faculty resources</li>
        <li class="item__type">Research administration &amp; collaboration</li>
      </ul>
      <p class="item__summary">CBIT partners with academic innovators, students, corporate entities, and health systems.</p>
    </li>
    <li class="item">
      <h3><a href="https://provost.yale.edu/policies/academic-integrity">Academic Integrity</a></h3>
      <ul class="item__types"><li class="item__type">Policies &amp; regulations</li></ul>
      <p class="item__summary">Research integrity policy guidance.</p>
    </li>
  </ol>
</body></html>
`;

function buildContext(
  scraper: YaleResearchOfficialScraper,
  emitted: ObservationInput[],
  options: Partial<ScraperContext['options']> = {},
): ScraperContext {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: scraper.name,
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, limit: 10, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
}

describe('yale research official directory parsing', () => {
  it('parses centers and institutes with official URLs, descriptions, and area facets', () => {
    const entities = parseCenterDirectory(CENTERS_HTML, CENTERS_LISTING_URL);

    expect(entities).toEqual([
      {
        name: 'Institute of Biomolecular Design and Discovery (IBDD)',
        url: 'https://westcampus.yale.edu/institutes/biomolecular-design-and-discovery',
        slug: 'yale-research-center-institute-of-biomolecular-design-and-discovery-ibdd',
        kind: 'institute',
        entityType: 'INSTITUTE',
        description:
          'IBDD focuses on the discovery of new biological molecules and their application to problems in biology and medicine.',
        researchAreas: ['Medical & health sciences', 'Sciences & engineering'],
        sourceUrl: CENTERS_LISTING_URL,
      },
      {
        name: 'Yale Center for Geospatial Solutions',
        url: 'https://geospatial.yale.edu/',
        slug: 'yale-research-center-yale-center-for-geospatial-solutions',
        kind: 'center',
        entityType: 'CENTER',
        description:
          'The Yale Center for Geospatial Solutions focuses on geospatial science, data, and analysis.',
        researchAreas: ['Arts, humanities, & social sciences', 'Sciences & engineering'],
        sourceUrl: CENTERS_LISTING_URL,
      },
    ]);
  });

  it('aggregates service and equipment rows onto parent core facility entities', () => {
    const entities = parseCoreDirectory(CORES_HTML, CORE_LISTING_URL);

    expect(entities).toEqual([
      {
        name: 'Yale Center for Molecular Discovery',
        url: 'https://research.yale.edu/cores/ycmd',
        slug: 'yale-research-core-yale-center-for-molecular-discovery',
        kind: 'center',
        entityType: 'CORE_FACILITY',
        description: '',
        researchAreas: ['Assay design'],
        sourceUrl: CORE_LISTING_URL,
        sourceUrls: [
          CORE_LISTING_URL,
          'https://research.yale.edu/cores/ycmd',
          'https://research.yale.edu/cores/ycmd/assay-design',
        ],
      },
      {
        name: 'Yale Center for Genome Analysis (YCGA)',
        url: 'https://research.yale.edu/cores/ycga',
        slug: 'yale-research-core-yale-center-for-genome-analysis-ycga',
        kind: 'center',
        entityType: 'CORE_FACILITY',
        description:
          'The Yale Center for Genome Analysis is a full-service facility dedicated to high-throughput sequencing.',
        researchAreas: [],
        sourceUrl: CORE_LISTING_URL,
        sourceUrls: [CORE_LISTING_URL, 'https://research.yale.edu/cores/ycga'],
      },
    ]);
  });

  it('keeps only durable research resources from the resources directory', () => {
    const entities = parseResourceDirectory(RESOURCES_HTML, 'https://research.yale.edu/resources');

    expect(entities.map((entity) => entity.name)).toEqual([
      'Center for Biomedical Innovation and Technology (CBIT)',
    ]);
    expect(entities[0]).toMatchObject({
      kind: 'center',
      entityType: 'CENTER',
      researchAreas: ['Faculty resources', 'Research administration & collaboration'],
    });
  });

  it('maps ambiguous names conservatively', () => {
    expect(inferCenterKind('Microbial Sciences Institute')).toEqual({
      kind: 'institute',
      entityType: 'INSTITUTE',
    });
    expect(inferCenterKind('Planetary Solutions Project')).toEqual({
      kind: 'initiative',
      entityType: 'INITIATIVE',
    });
    expect(inferCenterKind('Research Development Program')).toEqual({
      kind: 'program',
      entityType: 'PROGRAM',
    });
    expect(inferCenterKind('Yale Center for Example Studies')).toEqual({
      kind: 'center',
      entityType: 'CENTER',
    });
  });
});

describe('yale research official observations', () => {
  it('emits discovery-only ResearchEntity observations for cores', () => {
    const observations = coreDirectoryEntitiesToObservations(parseCoreDirectory(CORES_HTML));
    const fields = observations.map((obs) => obs.field);

    expect(observations.every((obs) => obs.entityType === 'researchEntity')).toBe(true);
    expect(fields).toContain('entityType');
    expect(fields).toContain('researchAreas');
    expect(fields).not.toEqual(
      expect.arrayContaining([
        'openness',
        'acceptingUndergrads',
        'undergradAccessEvidence',
        'joinPageUrl',
        'contactInstructionsQuote',
        'contactEmail',
      ]),
    );
  });

  it('does not turn resource directory rows into pathways or contact routes', () => {
    const observations = resourceDirectoryEntitiesToObservations(
      parseResourceDirectory(RESOURCES_HTML),
    );

    expect(observations.map((obs) => obs.entityType)).not.toEqual(
      expect.arrayContaining(['entryPathway', 'accessSignal', 'contactRoute']),
    );
  });

  it('runs through centers, cores, and resource infrastructure without emitting access artifacts', async () => {
    const emitted: ObservationInput[] = [];
    const fetchHtml = vi.fn(async (url: string, _useCache: boolean) => {
      if (url.includes('/centers-institutes')) return CENTERS_HTML;
      if (url.includes('/cores')) return CORES_HTML;
      return RESOURCES_HTML;
    });
    const scraper = new YaleResearchOfficialScraper({ fetchHtml });
    const ctx = buildContext(scraper, emitted);

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(5);
    expect(result.observationCount).toBe(emitted.length);
    expect(emitted.map((obs) => obs.entityType)).not.toEqual(
      expect.arrayContaining(['entryPathway', 'accessSignal', 'contactRoute']),
    );
    expect(fetchHtml).toHaveBeenCalledWith(CENTERS_LISTING_URL, false);
    expect(fetchHtml).toHaveBeenCalledWith(CORE_LISTING_URL, false);
    expect(fetchHtml).toHaveBeenCalledWith(RESOURCES_LISTING_URL, false);
  });

  it('applies the run limit across all official directories', async () => {
    const emitted: ObservationInput[] = [];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes('/centers-institutes')) return CENTERS_HTML;
      if (url.includes('/cores')) return CORES_HTML;
      return RESOURCES_HTML;
    });
    const scraper = new YaleResearchOfficialScraper({ fetchHtml });
    const ctx = buildContext(scraper, emitted, { limit: 3 });

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(3);
    expect(fetchHtml).toHaveBeenCalledWith(CENTERS_LISTING_URL, false);
    expect(fetchHtml).toHaveBeenCalledWith(CORE_LISTING_URL, false);
    expect(fetchHtml).not.toHaveBeenCalledWith(RESOURCES_LISTING_URL, false);
  });

  it('honors --only filters for independent directory audits', async () => {
    const emitted: ObservationInput[] = [];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes('/centers-institutes')) return CENTERS_HTML;
      if (url.includes('/cores')) return CORES_HTML;
      return RESOURCES_HTML;
    });
    const scraper = new YaleResearchOfficialScraper({ fetchHtml });
    const ctx = buildContext(scraper, emitted, { only: ['cores'], limit: 10 });

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2);
    expect(fetchHtml).not.toHaveBeenCalledWith(CENTERS_LISTING_URL, false);
    expect(fetchHtml).toHaveBeenCalledWith(CORE_LISTING_URL, false);
    expect(fetchHtml).not.toHaveBeenCalledWith(RESOURCES_LISTING_URL, false);
    expect(emitted.map((obs) => obs.field)).toContain('entityType');
  });
});
