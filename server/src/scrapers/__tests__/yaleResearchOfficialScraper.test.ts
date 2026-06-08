import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_YALE_RESEARCH_DIRECTORY_CONFIGS,
  YaleResearchOfficialScraper,
  entityToObservations,
  inferResearchYaleKind,
  parseResearchYaleCenters,
  parseResearchYaleCoreFacilities,
  slugifyResearchYaleEntity,
} from '../sources/yaleResearchOfficialScraper';
import type { ObservationInput, ScraperContext } from '../types';

const CENTERS_HTML = `
<main>
  <a href="/centers-institutes?f%5B0%5D=area_interest%3A54#results">Sciences &amp; engineering (16)</a>
  <ol class="listing-items">
    <li class="item">
      <div class="grid-x grid-margin-x">
        <div class="cell initial-12 medium-4">
          <h3>
            <a href="https://fds.yale.edu/">Yale Institute for Foundations of Data Science</a>
          </h3>
          <ul class="item__types">
            <li class="item__type">Sciences &amp; engineering</li>
          </ul>
        </div>
        <div class="cell initial-12 medium-8">
          <p>The institute integrates faculty from across campus to help scholars apply new methods of data science.</p>
        </div>
      </div>
    </li>
    <li class="item">
      <h3>
        <a href="https://geospatial.yale.edu/">Yale Center for Geospatial Solutions</a>
      </h3>
      <ul class="item__types">
        <li class="item__type">Arts, humanities, &amp; social sciences</li>
        <li class="item__type">Sciences &amp; engineering</li>
      </ul>
      <p>The center focuses on geospatial science, data, and analysis.</p>
    </li>
  </ol>
</main>
`;

const CORES_HTML = `
<main>
  <a href="/cores?f%5B0%5D=result_type%3A2#results">Instrument/equipment (113)</a>
  <article class="card">
    <h2><a href="/cores/acem">Aberration-Corrected Electron Microscopy (ACEM) Core</a></h2>
    <p>Our core's focus is cutting-edge and high-throughput capability in electron microscopy techniques.</p>
    <div class="card__content__contact">
      <h3>Primary contact</h3>
      <a href="mailto:shize.yang@yale.edu">shize.yang@yale.edu</a>
    </div>
  </article>
  <article class="card">
    <h2><a href="/cores/aidc">Advanced Instrumentation Development Center (AIDC)</a></h2>
    <p>Our mission stands at the nexus between hardware, computing, and data science.</p>
  </article>
</main>
`;

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'yale-research-official',
    sourceWeight: 0.85,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
  return { ctx, emitted };
}

describe('yaleResearchOfficialScraper', () => {
  it('parses research.yale.edu centers and institutes from listing items only', () => {
    const entities = parseResearchYaleCenters(
      CENTERS_HTML,
      'https://research.yale.edu/centers-institutes',
    );

    expect(entities).toEqual([
      {
        name: 'Yale Institute for Foundations of Data Science',
        url: 'https://fds.yale.edu/',
        slug: 'research-yale-yale-institute-for-foundations-of-data-science',
        kind: 'institute',
        entityType: 'INSTITUTE',
        description:
          'The institute integrates faculty from across campus to help scholars apply new methods of data science.',
        researchAreas: ['Sciences & engineering'],
        sourceCategory: 'centers-institutes',
      },
      {
        name: 'Yale Center for Geospatial Solutions',
        url: 'https://geospatial.yale.edu/',
        slug: 'research-yale-yale-center-for-geospatial-solutions',
        kind: 'center',
        entityType: 'CENTER',
        description: 'The center focuses on geospatial science, data, and analysis.',
        researchAreas: ['Arts, humanities, & social sciences', 'Sciences & engineering'],
        sourceCategory: 'centers-institutes',
      },
    ]);
  });

  it('parses only core/facility rows from the filtered cores directory', () => {
    const entities = parseResearchYaleCoreFacilities(
      CORES_HTML,
      'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
    );

    expect(entities).toEqual([
      expect.objectContaining({
        name: 'Aberration-Corrected Electron Microscopy (ACEM) Core',
        url: 'https://research.yale.edu/cores/acem',
        slug: 'research-yale-aberration-corrected-electron-microscopy-acem-core',
        kind: 'center',
        entityType: 'CENTER',
        description:
          "Our core's focus is cutting-edge and high-throughput capability in electron microscopy techniques.",
        sourceCategory: 'core-facility',
      }),
      expect.objectContaining({
        name: 'Advanced Instrumentation Development Center (AIDC)',
        url: 'https://research.yale.edu/cores/aidc',
        sourceCategory: 'core-facility',
      }),
    ]);
  });

  it('emits discovery-only observations without undergraduate access or contact routes', () => {
    const [entity] = parseResearchYaleCoreFacilities(
      CORES_HTML,
      'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
    );
    const observations = entityToObservations(
      entity,
      'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
    );

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', value: entity.name }),
        expect.objectContaining({ field: 'websiteUrl', value: entity.url }),
        expect.objectContaining({
          field: 'sourceUrls',
          value: ['https://research.yale.edu/cores?f%5B0%5D=result_type%3A1', entity.url],
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
      ]),
    );
  });

  it('classifies and slugifies official Yale research entities', () => {
    expect(inferResearchYaleKind('Microbial Sciences Institute')).toMatchObject({
      kind: 'institute',
      entityType: 'INSTITUTE',
    });
    expect(inferResearchYaleKind('Yale Planetary Solutions Project')).toMatchObject({
      kind: 'initiative',
      entityType: 'INITIATIVE',
    });
    expect(slugifyResearchYaleEntity('Yale Center for Geospatial Solutions')).toBe(
      'research-yale-yale-center-for-geospatial-solutions',
    );
  });

  it('runs configured directories with pagination and only filters', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes('centers-institutes')) {
        return url.includes('page=1') ? '<main></main>' : CENTERS_HTML;
      }
      if (url.includes('result_type%3A1')) {
        return url.includes('page=1') ? '<main></main>' : CORES_HTML;
      }
      return '<main></main>';
    });
    const scraper = new YaleResearchOfficialScraper(undefined, fetchHtml);
    const { ctx, emitted } = makeContext({ only: ['centers-institutes'] });

    const result = await scraper.run(ctx);

    expect(fetchHtml).toHaveBeenCalledWith(
      'https://research.yale.edu/centers-institutes',
      false,
      'yale-research-official',
    );
    expect(fetchHtml).toHaveBeenCalledWith(
      'https://research.yale.edu/centers-institutes?page=1',
      false,
      'yale-research-official',
    );
    expect(fetchHtml).not.toHaveBeenCalledWith(
      expect.stringContaining('/cores'),
      expect.anything(),
      expect.anything(),
    );
    expect(result.entitiesObserved).toBe(2);
    expect(result.observationCount).toBe(emitted.length);
  });

  it('rejects unsafe runtime limits before fetching directory pages', async () => {
    const fetchHtml = vi.fn(async () => '<main></main>');
    const scraper = new YaleResearchOfficialScraper(undefined, fetchHtml);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('bundles the active research.yale.edu directory configs', () => {
    expect(DEFAULT_YALE_RESEARCH_DIRECTORY_CONFIGS).toEqual([
      expect.objectContaining({
        key: 'centers-institutes',
        url: 'https://research.yale.edu/centers-institutes',
        paginated: true,
      }),
      expect.objectContaining({
        key: 'core-facilities',
        url: 'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
        paginated: true,
      }),
    ]);
  });
});
