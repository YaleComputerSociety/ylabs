import { describe, expect, it, vi } from 'vitest';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import {
  LabMicrositeDescriptionLLMExtractor,
  pageStatedLabNameObservations,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

const SITE_URL = 'https://quillcircuits.example.org/';
const LAB_NAME = 'Quill Neural Circuits Lab';

const RESEARCH_PROSE =
  'The laboratory studies how cortical circuits encode sensory expectation, combining two-photon imaging in behaving mice with computational models of predictive coding to explain how learned priors reshape perception. ';

const proseHtml = (title: string) =>
  `<html><head><title>${title}</title><meta name="description" content="${RESEARCH_PROSE.trim()}"></head><body><h1>${LAB_NAME}</h1><main><p>${RESEARCH_PROSE}</p><p>Our group also develops new tools for chronic imaging of dendritic spines during learning in adult animals.</p></main></body></html>`;

const newsFeedHtml = (title: string) =>
  `<html><head><title>${title}</title><meta property="og:site_name" content="${LAB_NAME}"></head><body><ul>${Array.from(
    { length: 30 },
    (_, index) => `<li><a href="/news/${index}">Lab news item ${index} posted</a></li>`,
  ).join('')}</ul></body></html>`;

const extraction = (overrides: Partial<DescriptionExtraction>): DescriptionExtraction => ({
  name: LAB_NAME,
  fullDescription: '',
  shortDescription: '',
  topics: [],
  methods: [],
  ...overrides,
});

const runLane = async (args: {
  html: string;
  extraction: DescriptionExtraction;
  url?: string;
  knownPersonSurnames?: ReadonlySet<string>;
}) => {
  const url = args.url ?? SITE_URL;
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'source-1',
    sourceName: 'lab-microsite-description-llm',
    sourceWeight: 0.5,
    options: { dryRun: true, useCache: false, release: false, limit: 10, ignoreWorkPlanner: true },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => undefined,
  };
  const scraper = new LabMicrositeDescriptionLLMExtractor({
    identityCorpusLoader: async () => ({
      knownPersonSurnames: args.knownPersonSurnames ?? NO_SURNAME_ROSTER,
      leadPersonNameByEntityId: new Map([['fixture-1', 'Ada Quill']]),
      sharedUrls: new Set<string>(),
    }),
    apiKey: 'test-key',
    labFinder: async () => [
      {
        _id: 'fixture-1',
        slug: 'ada-quill-faculty-research',
        name: 'Ada Quill Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        websiteUrl: url,
      },
    ],
    fetchPage: vi.fn(async () => ({ url, html: args.html })),
    callLLM: vi.fn(async () => args.extraction),
    callCardLLM: vi.fn(async () => ''),
  });
  await scraper.run(ctx);
  const valueOf = (field: string) => emitted.find((obs) => obs.field === field)?.value;
  return { emitted, valueOf };
};

describe('the microsite lane emits the page-stated lab name on every description path (#4370)', () => {
  it('emits the name when the deterministic page prose is adopted', async () => {
    const { valueOf } = await runLane({
      html: proseHtml(`${LAB_NAME} - Home`),
      extraction: extraction({ fullDescription: 'Prose the page never states.' }),
    });

    expect(String(valueOf('fullDescription'))).toContain('cortical circuits');
    expect(valueOf('name')).toBe(LAB_NAME);
    expect(valueOf('displayName')).toBe(LAB_NAME);
    expect(valueOf('entityType')).toBe('LAB');
    expect(valueOf('kind')).toBe('lab');
  });

  it('emits the name when no description is usable', async () => {
    const { emitted, valueOf } = await runLane({
      html: newsFeedHtml('News | Yale'),
      extraction: extraction({}),
    });

    expect(emitted.some((obs) => obs.field === 'fullDescription')).toBe(false);
    expect(valueOf('name')).toBe(LAB_NAME);
  });

  it('emits the name once when the model description is adopted', async () => {
    const { emitted } = await runLane({
      html: newsFeedHtml(LAB_NAME).replace('<ul>', `<div>${RESEARCH_PROSE}</div><ul>`),
      extraction: extraction({ fullDescription: RESEARCH_PROSE.trim() }),
    });

    expect(emitted.some((obs) => obs.field === 'fullDescription')).toBe(true);
    expect(emitted.filter((obs) => obs.field === 'name')).toHaveLength(1);
  });

  it('withholds a name the page headings do not state', async () => {
    const { valueOf } = await runLane({
      html: newsFeedHtml('News | Yale').replace(/<meta[^>]*>/, ''),
      extraction: extraction({}),
    });

    expect(valueOf('name')).toBeUndefined();
  });

  it("withholds the person's own name a personal homepage states", async () => {
    const personName = 'Ada Quill';
    const { valueOf } = await runLane({
      html: newsFeedHtml(personName).replace(LAB_NAME, personName),
      extraction: extraction({ name: personName }),
    });

    expect(valueOf('name')).toBeUndefined();
    expect(valueOf('displayName')).toBeUndefined();
  });

  it('withholds an umbrella organization title', async () => {
    const umbrella = 'Yale Center for Fixture Studies';
    const { valueOf } = await runLane({
      html: newsFeedHtml(umbrella).replace(LAB_NAME, umbrella),
      extraction: extraction({ name: umbrella }),
    });

    expect(valueOf('name')).toBeUndefined();
  });

  it("withholds another person's eponymous lab", async () => {
    const foreign = 'Moreau Lab';
    const { valueOf } = await runLane({
      url: 'https://moreaulab.example.org/',
      html: newsFeedHtml(foreign).replace(LAB_NAME, foreign),
      extraction: extraction({ name: foreign }),
      knownPersonSurnames: new Set(['moreau']),
    });

    expect(valueOf('name')).toBeUndefined();
  });

  it('withholds the name of a page whose own body describes another organization, whatever else was refused', () => {
    const personScoped = {
      sourceUrl: SITE_URL,
      entityKey: 'directory-faculty-fixture-person',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      knownPersonSurnames: NO_SURNAME_ROSTER,
    };
    const html = newsFeedHtml(LAB_NAME);
    const orgBody =
      'The department supports undergraduate research through paid research assistantships and summer programs.';

    expect(pageStatedLabNameObservations(extraction({}), personScoped, html)).not.toHaveLength(0);
    expect(
      pageStatedLabNameObservations(extraction({ fullDescription: orgBody }), personScoped, html),
    ).toHaveLength(0);
  });
});
