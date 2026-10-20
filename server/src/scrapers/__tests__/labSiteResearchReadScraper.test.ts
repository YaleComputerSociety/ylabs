import { describe, expect, it, vi } from 'vitest';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import {
  LabSiteResearchReadScraper,
  MAX_RESEARCH_TEXT_SNIPPET_CHARS,
  MAX_RESEARCH_TEXT_SNIPPETS,
  labSiteResearchReadObservations,
  researchTextSnippets,
} from '../sources/labSiteResearchReadScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { usesLatestWinsFingerprint } from '../observationStore';
import type { ObservationInput, ScraperContext } from '../types';

const canonicalizer = createResearchAreaCanonicalizer(
  buildResearchAreaResolverIndex([{ name: 'Glacier Hydrology' }, { name: 'Membrane Biology' }]),
);

const identityCorpus = {
  knownPersonSurnames: NO_SURNAME_ROSTER,
  leadPersonNameByEntityId: new Map<string, string>(),
};

const LAB: CandidateDescriptionLab = {
  _id: 'entity-quillfeather',
  slug: 'quillfeather-lab',
  name: 'Quillfeather Lab',
  entityType: 'LAB',
  websiteUrl: 'https://example.org/lab/quillfeather/',
};

const HOME_HTML = `
<html><head><title>Quillfeather Lab</title><meta property="og:site_name" content="Quillfeather Lab" /></head>
<body><main>
  <h2>Research</h2>
  <p>We study how glacier hydrology reshapes membrane biology in alpine microbes across the thaw season.</p>
  <h2>Methods</h2>
  <ul><li>Cryo-electron tomography</li><li>Lipidomics</li></ul>
</main></body></html>`;

const WELCOME_HTML = `
<html><head><title>Quillfeather Lab</title></head>
<body><main><a href="/lab/quillfeather/research/">Our research</a>
  <p>Welcome to our group. We are glad you stopped by and hope you enjoy the site.</p>
</main></body></html>`;

const RESEARCH_HTML = `
<html><head><title>Research | Quillfeather Lab</title></head>
<body><main>
  <h2>Research</h2>
  <p>We study how glacier hydrology reshapes membrane biology in alpine microbes across the thaw season.</p>
  <p>Our current projects ask how lipid packing changes when meltwater chemistry shifts during spring.</p>
</main></body></html>`;

const read = (overrides: Partial<Parameters<typeof labSiteResearchReadObservations>[0]> = {}) =>
  labSiteResearchReadObservations({
    lab: LAB,
    primary: { url: LAB.websiteUrl, html: HOME_HTML },
    crawled: [],
    identityCorpus,
    canonicalizer,
    ...overrides,
  });

const field = (observations: ObservationInput[], name: string) =>
  observations.find((observation) => observation.field === name);

describe('labSiteResearchReadObservations', () => {
  it('stores the research text as passages, the approved topics and the stated name, and no methods or prose fields', () => {
    const outcome = read();
    expect(field(outcome.observations, 'researchSummary')).toMatchObject({
      entityKey: 'quillfeather-lab',
      sourceUrl: LAB.websiteUrl,
      value: [
        'We study how glacier hydrology reshapes membrane biology in alpine microbes across the thaw season.',
      ],
    });
    expect(field(outcome.observations, 'researchAreas')?.value).toEqual([
      'Glacier Hydrology',
      'Membrane Biology',
    ]);
    expect(field(outcome.observations, 'name')).toMatchObject({
      value: 'Quillfeather Lab',
      confidenceOverride: 0.95,
    });
    expect(field(outcome.observations, 'displayName')?.value).toBe('Quillfeather Lab');
    const fields = outcome.observations.map((observation) => observation.field);
    for (const absent of ['methods', 'fullDescription', 'shortDescription', 'entityType', 'kind']) {
      expect(fields).not.toContain(absent);
    }
  });

  it('cites a crawled research page when it carries more research text than the home page', () => {
    const outcome = read({
      primary: { url: LAB.websiteUrl, html: WELCOME_HTML },
      crawled: [{ url: `${LAB.websiteUrl}research/`, html: RESEARCH_HTML }],
    });
    const text = field(outcome.observations, 'researchSummary');
    expect(text?.sourceUrl).toBe(`${LAB.websiteUrl}research/`);
    expect(text?.value).toHaveLength(2);
  });

  it('asserts no research text when the page carries none, on the read witness', () => {
    const outcome = read({
      primary: {
        url: LAB.websiteUrl,
        html: '<html><head><title>Quillfeather Lab</title></head><body><main><a href="/people">People</a></main></body></html>',
      },
    });
    expect(field(outcome.observations, 'researchSummary')).toBeUndefined();
    expect(field(outcome.observations, 'sourceContentHash')).toMatchObject({
      assertsNoValueFor: ['researchSummary'],
    });
  });

  it("refuses a page about a person row's namesake that never names the row's lead", () => {
    const outcome = read({
      lab: {
        ...LAB,
        _id: 'entity-venn',
        slug: 'orla-venn-faculty-research',
        name: 'Orla Venn Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://example.org/people/orla-venn/',
      },
      primary: { url: 'https://other.example.org/people/marrow/', html: RESEARCH_HTML },
      identityCorpus: {
        ...identityCorpus,
        leadPersonNameByEntityId: new Map([['entity-venn', 'Orla Venn']]),
      },
    });
    expect(outcome).toMatchObject({ refusal: 'page_does_not_name_row', observations: [] });
  });
});

describe('researchTextSnippets', () => {
  it('cuts a long passage at a sentence boundary and keeps at most the writer snippet count', () => {
    const sentence = 'Glacier meltwater reshapes the membranes of alpine microbes every spring. ';
    const long = sentence.repeat(40).trim();
    const snippets = researchTextSnippets(
      Array.from({ length: 20 }, () => ({ origin: 'main-content' as const, text: long })),
    );
    expect(snippets).toHaveLength(MAX_RESEARCH_TEXT_SNIPPETS);
    for (const snippet of snippets) {
      expect(snippet.length).toBeLessThanOrEqual(MAX_RESEARCH_TEXT_SNIPPET_CHARS);
      expect(snippet.endsWith('.')).toBe(true);
    }
  });
});

describe('LabSiteResearchReadScraper', () => {
  it('keeps one live research text, name and display name per row', () => {
    for (const fieldName of ['researchSummary', 'name', 'displayName']) {
      expect(
        usesLatestWinsFingerprint({
          entityType: 'researchEntity',
          field: fieldName,
          sourceName: 'lab-site-research-read',
        }),
      ).toBe(true);
    }
  });

  it('runs the URL guards before fetching and never fetches a refused page', async () => {
    const emitted: ObservationInput[] = [];
    const fetchPage = vi.fn(async (url: string) => ({ url, html: HOME_HTML }));
    const scraper = new LabSiteResearchReadScraper({
      fetchPage,
      labFinder: async () => [
        {
          ...LAB,
          sourceUrls: ['https://example.org/search?q=quillfeather', LAB.websiteUrl],
        },
      ],
      identityCorpusLoader: async () => identityCorpus,
      canonicalizerLoader: async () => canonicalizer,
    });
    const ctx = {
      options: { only: [], limit: 5 },
      log: () => {},
      emit: async (observations: ObservationInput[]) => {
        emitted.push(...observations);
      },
    } as unknown as ScraperContext;

    const result = await scraper.run(ctx);

    expect(fetchPage.mock.calls.map(([url]) => url)).not.toContain(
      'https://example.org/search?q=quillfeather',
    );
    expect(fetchPage).toHaveBeenCalledWith(LAB.websiteUrl);
    expect(result.entitiesObserved).toBe(1);
    expect(emitted.some((observation) => observation.field === 'researchSummary')).toBe(true);
  });
});

describe('a page the parser cannot read (#5296)', () => {
  it('is counted and skipped, and the run reads the next row', async () => {
    const emitted: ObservationInput[] = [];
    const nested = `<html><body><main>${'<div>'.repeat(6000)}<p>deep</p>${'</div>'.repeat(6000)}</main></body></html>`;
    const second = {
      ...LAB,
      _id: 'entity-second',
      slug: 'second-lab',
      websiteUrl: 'https://example.org/lab/second/',
    };
    const scraper = new LabSiteResearchReadScraper({
      fetchPage: async (url: string) => ({
        url,
        html: url === LAB.websiteUrl ? nested : HOME_HTML,
      }),
      labFinder: async () => [LAB, second],
      identityCorpusLoader: async () => identityCorpus,
      canonicalizerLoader: async () => canonicalizer,
    });
    const result = await scraper.run({
      options: { only: [], limit: 5 },
      log: () => {},
      emit: async (observations: ObservationInput[]) => {
        emitted.push(...observations);
      },
    } as unknown as ScraperContext);
    expect(result.notes).toMatch(/1 unparseable/);
    expect(emitted.some((observation) => observation.entityKey === 'second-lab')).toBe(true);
  });
});
