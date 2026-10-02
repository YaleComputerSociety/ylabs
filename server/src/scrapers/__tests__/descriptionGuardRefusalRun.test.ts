import { describe, expect, it, vi } from 'vitest';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import {
  LabMicrositeDescriptionLLMExtractor,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';
import { SOURCE_CONTENT_HASH_FIELD } from '../contentHashGate';
import { sharedEvidenceUrls } from '../utils/sharedEvidenceUrls';

const PAGE_URL = 'https://research.example.edu/programs/fixture-shared-page/';

const PAGE_HTML = `<main><p>${'The laboratory studies how microglia clear protein aggregates in the ageing brain, combining two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex to identify the clearance pathways that fail earliest in tauopathy. '.repeat(3)}</p></main>`;

const EXTRACTION: DescriptionExtraction = {
  fullDescription:
    'The laboratory studies how microglia clear protein aggregates in the ageing brain, combining two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex.',
  shortDescription: 'Studies how microglia clear protein aggregates in the ageing brain.',
  topics: [],
  methods: [],
};

const runLane = async (sharedUrls: ReadonlySet<string>) => {
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
      knownPersonSurnames: NO_SURNAME_ROSTER,
      leadPersonNameByEntityId: new Map<string, string>(),
      sharedUrls,
    }),
    apiKey: 'test-key',
    labFinder: async () => [
      {
        _id: 'fixture-1',
        slug: 'fixture-shared-page-lab',
        name: 'Fixture Lab',
        websiteUrl: PAGE_URL,
      },
    ],
    fetchPage: vi.fn(async () => ({ url: PAGE_URL, html: PAGE_HTML })),
    callLLM: vi.fn(async () => EXTRACTION),
    callCardLLM: vi.fn(async () => ''),
  });
  const result = await scraper.run(ctx);
  return { emitted, result };
};

describe('the description lane records a shared-page refusal as refused (#3739)', () => {
  it('emits the description when the page is not shared', async () => {
    const { emitted, result } = await runLane(new Set());

    expect(emitted.map((obs) => obs.field)).toContain('fullDescription');
    expect(emitted.some((obs) => obs.assertsNoValueFor)).toBe(false);
    expect(result.metrics?.descriptionSlotAttestation).toMatchObject({ empty: 0, refused: 0 });
  });

  it('declines a shared page without attesting that the page carries no prose', async () => {
    const { emitted, result } = await runLane(
      sharedEvidenceUrls([{ websiteUrl: PAGE_URL }, { sourceUrls: [PAGE_URL] }]),
    );

    expect(emitted.map((obs) => obs.field)).toEqual([SOURCE_CONTENT_HASH_FIELD]);
    expect(emitted[0].assertsNoValueFor).toBeUndefined();
    expect(result.metrics?.descriptionSlotAttestation).toMatchObject({
      empty: 0,
      refused: 1,
      refusedByGuard: { shared_evidence_url: 1 },
    });
  });
});
