import { describe, expect, it, vi } from 'vitest';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import {
  candidateDescriptionLabsFromDocs,
  LabMicrositeDescriptionLLMExtractor,
  type CandidateDescriptionLab,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

const TITLE_ONLY_PROFILE = 'https://medicine.yale.edu/profile/fixture-title-only-person/';
const DESCRIPTION_PAGE = 'https://fixture-lab.example.edu/research/';

const TITLE_ONLY_HTML =
  '<html><head><title>Fixture Person | Yale School of Medicine</title></head><body><main><h1>Fixture Person, MD</h1><p>Assistant Professor</p></main></body></html>';

const STORED_DESCRIPTION =
  'The group studies how microglia clear protein aggregates in the ageing brain, combining two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex to find the clearance pathways that fail earliest.';

const METHODS_EXTRACTION: DescriptionExtraction = {
  fullDescription: '',
  shortDescription: '',
  topics: [],
  methods: ['two-photon imaging', 'single-nucleus sequencing'],
};

const runLane = async (lab: Partial<CandidateDescriptionLab>) => {
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
  const callLLM = vi.fn(async () => METHODS_EXTRACTION);
  const scraper = new LabMicrositeDescriptionLLMExtractor({
    identityCorpusLoader: async () => ({
      knownPersonSurnames: NO_SURNAME_ROSTER,
      leadPersonNameByEntityId: new Map<string, string>(),
    }),
    apiKey: 'test-key',
    labFinder: async () => [
      {
        _id: 'fixture-1',
        slug: 'fixture-title-only-row',
        name: 'Fixture Person',
        websiteUrl: TITLE_ONLY_PROFILE,
        fullDescription: STORED_DESCRIPTION,
        ...lab,
      },
    ],
    fetchPage: vi.fn(async () => ({ url: TITLE_ONLY_PROFILE, html: TITLE_ONLY_HTML })),
    callLLM,
    callCardLLM: vi.fn(async () => ''),
  });
  await scraper.run(ctx);
  return emitted.filter((obs) => obs.field === 'methods');
};

describe('methods read from the stored description are not credited to a page that lacks them (#4048)', () => {
  it('credits them to the page the stored description is credited to', async () => {
    const methods = await runLane({ fullDescriptionSourceUrl: DESCRIPTION_PAGE });

    expect(methods).toHaveLength(1);
    expect(methods[0].sourceUrl).toBe(DESCRIPTION_PAGE);
    expect(methods[0].value).toEqual(['two-photon imaging', 'single-nucleus sequencing']);
  });

  it('never credits them to the title-only page just fetched', async () => {
    const credited = [
      ...(await runLane({ fullDescriptionSourceUrl: DESCRIPTION_PAGE })),
      ...(await runLane({})),
    ];

    expect(credited.some((obs) => obs.sourceUrl === TITLE_ONLY_PROFILE)).toBe(false);
  });

  it('asserts no methods when the stored description has no credited page', async () => {
    expect(await runLane({})).toEqual([]);
  });
});

describe('the lab finder carries the stored description credit to the lane (#4048)', () => {
  it('reads the credited page from the row provenance', () => {
    const [candidate] = candidateDescriptionLabsFromDocs([
      {
        _id: 'fixture-2',
        slug: 'fixture-credited-row',
        name: 'Fixture Lab',
        websiteUrl: DESCRIPTION_PAGE,
        fieldProvenance: { fullDescription: { sourceUrl: DESCRIPTION_PAGE } },
      },
    ]);
    expect(candidate.fullDescriptionSourceUrl).toBe(DESCRIPTION_PAGE);
  });
});
