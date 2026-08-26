import { afterEach, describe, expect, it, vi } from 'vitest';
import * as contentHashGate from '../contentHashGate';
import {
  LabMicrositeDescriptionLLMExtractor,
  type CallDescriptionLLMFn,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import type { CardSynthesisLLMFn } from '../../utils/groundedCardSynthesis';
import {
  LabMicrositeUndergradLLMExtractor,
  type CallLLMFn,
  type LLMExtraction,
  type WorkPlanLoaderFn,
} from '../sources/labMicrositeUndergradLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(overrides: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
  logs: string[];
} {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  return {
    emitted,
    logs,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'lab-microsite-description-llm',
      sourceWeight: 0.5,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        limit: 10,
        ignoreWorkPlanner: true,
        ...overrides,
      },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (msg) => logs.push(msg),
    },
  };
}

const alwaysFetchWorkPlan: WorkPlanLoaderFn = async (lab, policy) => ({
  entityType: policy.entityType,
  entityKey: lab.slug,
  sourceName: policy.sourceName,
  fields: policy.targetFields.map((field) => ({
    field,
    shouldFetch: true,
    reason: 'missing' as const,
  })),
  shouldFetch: true,
});

describe('durable content-change gate skips LLM re-spend end-to-end', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('description extractor: unchanged page → no LLM call, no observations, skip is logged', async () => {
    const pageHtml =
      '<main><h1>Ashford Lab</h1><p>The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>';
    const expectedHash = contentHashGate.computeContentHash(pageHtml);
    const loadHashSpy = vi
      .spyOn(contentHashGate, 'loadStoredContentHash')
      .mockResolvedValue(expectedHash);

    const fetchPage = vi.fn().mockResolvedValue({
      url: 'https://medicine.yale.edu/lab/ashford/',
      html: pageHtml,
    });
    const callLLM = vi.fn<CallDescriptionLLMFn>();
    const callCardLLM = vi.fn<CardSynthesisLLMFn>();

    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'entity-ashford',
          slug: 'ashford-lab',
          name: 'Ashford Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/ashford/',
        },
      ],
      fetchPage,
      callLLM,
      callCardLLM,
    });

    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(loadHashSpy).toHaveBeenCalledWith('lab-microsite-description-llm', {
      entityType: 'researchEntity',
      entityId: 'entity-ashford',
      entityKey: 'ashford-lab',
    });
    expect(callLLM).not.toHaveBeenCalled();
    expect(callCardLLM).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(result).toMatchObject({ observationCount: 0, entitiesObserved: 0 });
    expect(result.notes).toContain('1 content-unchanged skipped');
    expect(logs.some((line) => /content unchanged/.test(line))).toBe(true);
  });

  it('description extractor: --force-llm bypasses the gate even when the stored hash matches', async () => {
    const pageHtml =
      '<main><h1>Ashford Lab</h1><p>The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>';
    const loadHashSpy = vi
      .spyOn(contentHashGate, 'loadStoredContentHash')
      .mockResolvedValue(contentHashGate.computeContentHash(pageHtml));

    const fetchPage = vi.fn().mockResolvedValue({
      url: 'https://medicine.yale.edu/lab/ashford/',
      html: pageHtml,
    });
    const callLLM = vi.fn().mockResolvedValue({
      fullDescription:
        'The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.',
      shortDescription:
        'Studies cellular signaling, immune response, translational biomarkers, and computational modeling.',
      topics: [],
      methods: [],
    } satisfies DescriptionExtraction);

    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'entity-ashford',
          slug: 'ashford-lab',
          name: 'Ashford Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/ashford/',
        },
      ],
      fetchPage,
      callLLM,
    });

    const { ctx, emitted } = makeContext({ forceLlm: true });
    await scraper.run(ctx);

    expect(loadHashSpy).not.toHaveBeenCalled();
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(emitted.some((obs) => obs.field === 'fullDescription')).toBe(true);
    expect(emitted.some((obs) => obs.field === 'sourceContentHash')).toBe(true);
  });

  it('description extractor: changed page → LLM runs and a new sourceContentHash observation is emitted', async () => {
    const staleHash = contentHashGate.computeContentHash('previous-run-html');
    vi.spyOn(contentHashGate, 'loadStoredContentHash').mockResolvedValue(staleHash);

    const pageHtml =
      '<main><h1>Ashford Lab</h1><p>The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>';
    const freshHash = contentHashGate.computeContentHash(pageHtml);
    const fetchPage = vi.fn().mockResolvedValue({
      url: 'https://medicine.yale.edu/lab/ashford/',
      html: pageHtml,
    });
    const callLLM = vi.fn().mockResolvedValue({
      fullDescription:
        'The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.',
      shortDescription:
        'Studies cellular signaling, immune response, translational biomarkers, and computational modeling.',
      topics: [],
      methods: [],
    } satisfies DescriptionExtraction);
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'entity-ashford',
          slug: 'ashford-lab',
          name: 'Ashford Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/ashford/',
        },
      ],
      fetchPage,
      callLLM,
    });

    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(callLLM).toHaveBeenCalledTimes(1);
    const hashObs = emitted.find((obs) => obs.field === 'sourceContentHash');
    expect(hashObs).toBeDefined();
    expect(hashObs?.value).toBe(freshHash);
    expect(hashObs?.value).not.toBe(staleHash);
  });

  it('undergrad extractor: unchanged home + subpage text → no LLM call, no observations, skip is logged', async () => {
    const homeHtml =
      '<html><body><h1>Smith Lab</h1><p>We welcome undergraduate researchers each semester.</p><a href="/people">Lab Members</a></body></html>';
    const peopleHtml =
      '<html><body><h2>Members</h2><h3>Undergraduates</h3><ul><li>Alice</li></ul></body></html>';
    let echoedHash = '';
    const originalCompute = contentHashGate.computeContentHash;
    vi.spyOn(contentHashGate, 'computeContentHash').mockImplementation((text) => {
      const hash = originalCompute(text);
      echoedHash = hash;
      return hash;
    });
    const loadHashSpy = vi
      .spyOn(contentHashGate, 'loadStoredContentHash')
      .mockImplementation(async () => echoedHash);

    const fetchPage = vi.fn(async (url: string) => {
      if (url === 'https://smith.example.com/') {
        return { url, html: homeHtml };
      }
      if (url === 'https://smith.example.com/people') {
        return { url, html: peopleHtml };
      }
      return null;
    });
    const callLLM = vi.fn<CallLLMFn>();
    const scraper = new LabMicrositeUndergradLLMExtractor({
      apiKey: 'sk-test',
      workPlanLoader: alwaysFetchWorkPlan,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'smith-lab',
          name: 'The Smith Lab',
          websiteUrl: 'https://smith.example.com/',
        },
      ],
      fetchPage,
      callLLM,
    });

    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(loadHashSpy).toHaveBeenCalledWith('lab-microsite-undergrad-llm', {
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
    });
    expect(callLLM).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toContain('1 content-unchanged skipped');
    expect(logs.some((line) => /\[smith-lab\] skipped — content unchanged/.test(line))).toBe(true);
  });

  it('undergrad extractor: --force-llm bypasses the gate even when the stored hash matches', async () => {
    const homeHtml =
      '<html><body><h1>Smith Lab</h1><p>We welcome undergraduate researchers each semester.</p></body></html>';
    const loadHashSpy = vi
      .spyOn(contentHashGate, 'loadStoredContentHash')
      .mockResolvedValue('would-match-if-checked');

    const fetchPage = vi.fn(async (url: string) => {
      if (url === 'https://smith.example.com/') return { url, html: homeHtml };
      return null;
    });
    const callLLM = vi.fn().mockResolvedValue({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome undergraduate researchers each semester.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    } satisfies LLMExtraction);
    const scraper = new LabMicrositeUndergradLLMExtractor({
      apiKey: 'sk-test',
      workPlanLoader: alwaysFetchWorkPlan,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'smith-lab',
          name: 'The Smith Lab',
          websiteUrl: 'https://smith.example.com/',
        },
      ],
      fetchPage,
      callLLM,
    });

    const { ctx, emitted } = makeContext({ forceLlm: true });
    await scraper.run(ctx);

    expect(loadHashSpy).not.toHaveBeenCalled();
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(emitted.some((obs) => obs.field === 'sourceContentHash')).toBe(true);
  });
});
