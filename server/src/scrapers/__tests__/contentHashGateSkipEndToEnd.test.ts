import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANE_PAGE_HEALTH_FIELD } from '../lanePageHealth';
import * as contentHashGate from '../contentHashGate';
import {
  DEFAULT_MODEL,
  DESCRIPTION_EXTRACTION_PROMPT_HASH,
  LabMicrositeDescriptionLLMExtractor,
  type CallDescriptionLLMFn,
  LAB_NAME_EMISSION_CONTRACT,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import {
  CARD_SYNTHESIS_MODEL,
  CARD_SYNTHESIS_PROMPT_HASH,
  type CardSynthesisLLMFn,
} from '../../utils/groundedCardSynthesis';
import {
  LabMicrositeUndergradLLMExtractor,
  type CallLLMFn,
  type LLMExtraction,
  type WorkPlanLoaderFn,
} from '../sources/labMicrositeUndergradLLMExtractor';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import {
  extractDescriptionPageProse,
  htmlToText,
} from '../sources/labMicrositeDescriptionLLMExtractor';
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
        emitted.push(
          ...(Array.isArray(obs) ? obs : [obs]).filter(
            (observation) => observation.field !== LANE_PAGE_HEALTH_FIELD,
          ),
        );
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

/**
 * The lane's own hash input, mirrored: a per-page digest over BOTH extraction paths' inputs, the
 * visible text and the deterministic official prose, combined order-independently (#3840).
 * Mirrored rather than imported so a change to the lane's input shows up here as a failure
 * instead of being followed silently.
 */
const laneHashInput = (pages: { url: string; html: string }[]): string =>
  contentHashGate.computePageSetTextDigest(pages, (page) => {
    const prose = extractDescriptionPageProse(page, 'organization');
    return [
      htmlToText(page.html),
      prose?.fullDescription ?? '',
      prose?.shortDescription ?? '',
    ].join('\n');
  });

describe('durable content-change gate skips LLM re-spend end-to-end', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('description extractor: unchanged page → no LLM call, no observations, skip is logged', async () => {
    const pageHtml =
      '<main><h1>Ashford Lab</h1><p>The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>';
    const expectedHash = contentHashGate.computeVersionedContentHash(
      laneHashInput([{ url: 'https://medicine.yale.edu/lab/ashford/', html: pageHtml }]),
      DESCRIPTION_EXTRACTION_PROMPT_HASH,
      DEFAULT_MODEL,
      CARD_SYNTHESIS_MODEL,
      CARD_SYNTHESIS_PROMPT_HASH,
      LAB_NAME_EMISSION_CONTRACT,
    );
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
      identityCorpusLoader: async () => ({
        knownPersonSurnames: NO_SURNAME_ROSTER,
        leadPersonNameByEntityId: new Map<string, string>(),
      }),
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

  describe('gate input across two real runs of the lane (#3840)', () => {
    const ashfordUrl = 'https://medicine.yale.edu/lab/ashford/';
    const visibleProse =
      'The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.';
    const jsonLdProse = (topic: string) =>
      `The Ashford Lab investigates ${topic} using quantitative imaging, genetic screens, and computational modeling. Our research connects molecular mechanisms to patient outcomes across several clinical settings.`;
    const ashfordPage = ({ nonce, jsonLdTopic }: { nonce: string; jsonLdTopic: string }) =>
      `<html><head><script nonce="${nonce}">window.__build="${nonce}"</script><script type="application/ld+json">${JSON.stringify(
        { '@type': 'WebPage', description: jsonLdProse(jsonLdTopic) },
      )}</script></head><body><main class="page-${nonce}" data-build="${nonce}"><h1>Ashford Lab</h1><p>${visibleProse}</p></main></body></html>`;

    async function runLane(html: string, storedHash: string | undefined) {
      vi.spyOn(contentHashGate, 'loadStoredContentHash').mockResolvedValue(storedHash);
      const callLLM = vi.fn().mockResolvedValue({
        fullDescription: visibleProse,
        shortDescription:
          'Studies cellular signaling, immune response, translational biomarkers, and computational modeling.',
        topics: [],
        methods: [],
      } satisfies DescriptionExtraction);
      const scraper = new LabMicrositeDescriptionLLMExtractor({
        identityCorpusLoader: async () => ({
          knownPersonSurnames: NO_SURNAME_ROSTER,
          leadPersonNameByEntityId: new Map<string, string>(),
        }),
        apiKey: 'test-key',
        labFinder: async () => [
          {
            _id: 'entity-ashford',
            slug: 'ashford-lab',
            name: 'Ashford Lab',
            websiteUrl: ashfordUrl,
          },
        ],
        fetchPage: vi.fn().mockResolvedValue({ url: ashfordUrl, html }),
        callLLM,
        callCardLLM: vi.fn<CardSynthesisLLMFn>().mockResolvedValue(''),
      });
      const { ctx, logs } = makeContext();
      const result = await scraper.run(ctx);
      const skipped = logs.some((line) => /content unchanged/.test(line));
      return { callLLM, result, skipped };
    }

    async function hashOfFirstRun(html: string): Promise<string> {
      const computeSpy = vi.spyOn(contentHashGate, 'computeVersionedContentHash');
      await runLane(html, undefined);
      const hash = computeSpy.mock.results.at(-1)?.value as string;
      computeSpy.mockRestore();
      return hash;
    }

    it('skips the model when only the markup churned between runs', async () => {
      const storedHash = await hashOfFirstRun(ashfordPage({ nonce: 'a1', jsonLdTopic: 'cilia' }));
      vi.restoreAllMocks();

      const second = await runLane(ashfordPage({ nonce: 'zz9', jsonLdTopic: 'cilia' }), storedHash);

      expect(second.skipped).toBe(true);
      expect(second.callLLM).not.toHaveBeenCalled();
      expect(second.result.notes).toContain('1 content-unchanged skipped');
    });

    it('re-extracts when only the JSON-LD official prose changed between runs', async () => {
      const storedHash = await hashOfFirstRun(ashfordPage({ nonce: 'a1', jsonLdTopic: 'cilia' }));
      vi.restoreAllMocks();

      const second = await runLane(
        ashfordPage({ nonce: 'a1', jsonLdTopic: 'membrane trafficking' }),
        storedHash,
      );

      expect(second.skipped).toBe(false);
      expect(second.result.notes).toContain('0 content-unchanged skipped');
    });
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
      identityCorpusLoader: async () => ({
        knownPersonSurnames: NO_SURNAME_ROSTER,
        leadPersonNameByEntityId: new Map<string, string>(),
      }),
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
    const staleHash = contentHashGate.computeVersionedContentHash(
      laneHashInput([
        { url: 'https://medicine.yale.edu/lab/ashford/', html: '<main><p>Older prose.</p></main>' },
      ]),
      DESCRIPTION_EXTRACTION_PROMPT_HASH,
      DEFAULT_MODEL,
    );
    vi.spyOn(contentHashGate, 'loadStoredContentHash').mockResolvedValue(staleHash);

    const pageHtml =
      '<main><h1>Ashford Lab</h1><p>The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>';
    const freshHash = contentHashGate.computeVersionedContentHash(
      laneHashInput([{ url: 'https://medicine.yale.edu/lab/ashford/', html: pageHtml }]),
      DESCRIPTION_EXTRACTION_PROMPT_HASH,
      DEFAULT_MODEL,
      CARD_SYNTHESIS_MODEL,
      CARD_SYNTHESIS_PROMPT_HASH,
      LAB_NAME_EMISSION_CONTRACT,
    );
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
      identityCorpusLoader: async () => ({
        knownPersonSurnames: NO_SURNAME_ROSTER,
        leadPersonNameByEntityId: new Map<string, string>(),
      }),
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

  it('description extractor: full description without a synthesized card leaves the hash unwritten so the row stays eligible (#2436)', async () => {
    const staleHash = contentHashGate.computeVersionedContentHash(
      laneHashInput([
        { url: 'https://medicine.yale.edu/lab/ashford/', html: '<main><p>Older prose.</p></main>' },
      ]),
      DESCRIPTION_EXTRACTION_PROMPT_HASH,
      DEFAULT_MODEL,
    );
    vi.spyOn(contentHashGate, 'loadStoredContentHash').mockResolvedValue(staleHash);

    // Facility prose: usable as a full description, but no usable card can be
    // derived from it, so the run ends with a full description and no card.
    const proseText =
      'The Ashford Lab is located in the Anlyan Center on the medical campus and was established in 1998 with support from several foundations and individual donors who continue to fund its operations today.';
    const pageHtml = `<div><table><tr><td>${proseText}</td></tr></table></div>`;
    const fetchPage = vi.fn().mockResolvedValue({
      url: 'https://medicine.yale.edu/lab/ashford/',
      html: pageHtml,
    });
    const callLLM = vi.fn().mockResolvedValue({
      fullDescription: proseText,
      shortDescription: '',
      topics: [],
      methods: [],
    } satisfies DescriptionExtraction);
    const callCardLLM = vi.fn().mockResolvedValue('');
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      identityCorpusLoader: async () => ({
        knownPersonSurnames: NO_SURNAME_ROSTER,
        leadPersonNameByEntityId: new Map<string, string>(),
      }),
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

    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.some((obs) => obs.field === 'fullDescription')).toBe(true);
    expect(emitted.some((obs) => obs.field === 'shortDescription')).toBe(false);
    expect(emitted.some((obs) => obs.field === 'sourceContentHash')).toBe(false);
  });

  describe('bounded card retry on an unchanged description (#3840)', () => {
    const researchProse =
      'Our lab is broadly interested in the biology of aging and the ways that metabolism shapes lifespan across species. Over the past decade we have built a range of experimental systems, from yeast to zebrafish, and we continue to expand these tools while training the next generation of scientists.';

    function cardlessScraper(callCardLLM: CardSynthesisLLMFn) {
      vi.spyOn(contentHashGate, 'loadStoredContentHash').mockResolvedValue(undefined);
      return new LabMicrositeDescriptionLLMExtractor({
        identityCorpusLoader: async () => ({
          knownPersonSurnames: NO_SURNAME_ROSTER,
          leadPersonNameByEntityId: new Map<string, string>(),
        }),
        apiKey: 'test-key',
        labFinder: async () => [
          {
            _id: 'entity-ashford',
            slug: 'ashford-lab',
            name: 'Ashford Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/ashford/',
          },
        ],
        fetchPage: vi.fn().mockResolvedValue({
          url: 'https://medicine.yale.edu/lab/ashford/',
          html: `<main><h1>Ashford Lab</h1><p>${researchProse}</p></main>`,
        }),
        callLLM: vi.fn().mockResolvedValue({
          fullDescription: researchProse,
          shortDescription: '',
          topics: [],
          methods: [],
        } satisfies DescriptionExtraction),
        callCardLLM,
      });
    }

    it('records the hash once the lane re-derives its stored description and the card is refused', async () => {
      vi.spyOn(contentHashGate, 'loadStoredLaneDescription').mockResolvedValue(researchProse);
      const callCardLLM = vi.fn<CardSynthesisLLMFn>().mockResolvedValue('');
      const { ctx, emitted } = makeContext();
      await cardlessScraper(callCardLLM).run(ctx);

      expect(callCardLLM).toHaveBeenCalledTimes(1);
      expect(emitted.some((obs) => obs.field === 'shortDescription')).toBe(false);
      expect(emitted.some((obs) => obs.field === 'sourceContentHash')).toBe(true);
    });

    it('keeps the retry open when the card call threw, even on a repeated description', async () => {
      vi.spyOn(contentHashGate, 'loadStoredLaneDescription').mockResolvedValue(researchProse);
      const callCardLLM = vi
        .fn<CardSynthesisLLMFn>()
        .mockRejectedValue(new Error('429 rate limited'));
      const { ctx, emitted } = makeContext();
      await cardlessScraper(callCardLLM).run(ctx);

      expect(callCardLLM).toHaveBeenCalledTimes(1);
      expect(emitted.some((obs) => obs.field === 'fullDescription')).toBe(true);
      expect(emitted.some((obs) => obs.field === 'sourceContentHash')).toBe(false);
    });
  });

  it('description extractor: card model change re-extracts the same unchanged page', async () => {
    const pageHtml =
      '<main><h1>Ashford Lab</h1><p>The Ashford Lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>';
    const priorCardModelHash = contentHashGate.computeVersionedContentHash(
      laneHashInput([{ url: 'https://medicine.yale.edu/lab/ashford/', html: pageHtml }]),
      DESCRIPTION_EXTRACTION_PROMPT_HASH,
      DEFAULT_MODEL,
      CARD_SYNTHESIS_MODEL,
      CARD_SYNTHESIS_PROMPT_HASH,
      LAB_NAME_EMISSION_CONTRACT,
    );
    vi.spyOn(contentHashGate, 'loadStoredContentHash').mockResolvedValue(priorCardModelHash);

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
      identityCorpusLoader: async () => ({
        knownPersonSurnames: NO_SURNAME_ROSTER,
        leadPersonNameByEntityId: new Map<string, string>(),
      }),
      apiKey: 'test-key',
      cardModel: 'gpt-5-mini-next',
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
    expect(hashObs?.value).toBe(
      contentHashGate.computeVersionedContentHash(
        laneHashInput([{ url: 'https://medicine.yale.edu/lab/ashford/', html: pageHtml }]),
        DESCRIPTION_EXTRACTION_PROMPT_HASH,
        DEFAULT_MODEL,
        'gpt-5-mini-next',
        CARD_SYNTHESIS_PROMPT_HASH,
        LAB_NAME_EMISSION_CONTRACT,
      ),
    );
    expect(hashObs?.value).not.toBe(priorCardModelHash);
  });

  it('undergrad extractor: unchanged home + subpage text → no LLM call, no observations, skip is logged', async () => {
    const homeHtml =
      '<html><body><h1>Smith Lab</h1><p>We welcome undergraduate researchers each semester.</p><a href="/people">Lab Members</a></body></html>';
    const peopleHtml =
      '<html><body><h2>Members</h2><h3>Undergraduates</h3><ul><li>Alice</li></ul></body></html>';
    let echoedHash = '';
    const originalCompute = contentHashGate.computeVersionedContentHash;
    vi.spyOn(contentHashGate, 'computeVersionedContentHash').mockImplementation(
      (text, promptVersion, model) => {
        const hash = originalCompute(text, promptVersion, model);
        echoedHash = hash;
        return hash;
      },
    );
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
