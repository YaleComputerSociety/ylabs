import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

import {
  buildStudentDecisionPrompt,
  decisionExtractionToObservation,
  defaultCallLLM,
  selectDecisionCandidates,
  StudentDecisionLLMExtractor,
  STUDENT_DECISION_RESPONSE_FORMAT,
  type DecisionCandidate,
  type StudentDecisionLLMExtractorDeps,
} from '../sources/studentDecisionLLMExtractor';
import { studentDecisionRecommendedActions } from '../../services/studentDecisionExplanationService';
import { getCached, setCached } from '../snapshotCache';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('../snapshotCache', () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => undefined),
}));

const candidate: DecisionCandidate = {
  _id: 'entity-1',
  slug: 'example-lab',
  name: 'Example Lab',
  entityType: 'LAB',
  description: 'Example Lab studies computational biology.',
  websiteUrl: 'https://example.yale.edu/lab',
  sourceUrls: ['https://example.yale.edu/lab'],
  accessSummary: {
    bestNextStep: 'Plan exploratory outreach',
    status: 'reach-out-plausible',
  },
  accessSignals: [
    {
      signalType: 'REACH_OUT_PLAUSIBLE',
      confidence: 'MEDIUM',
      excerpt: 'Interested students may contact the lab through the official profile.',
      sourceUrl: 'https://example.yale.edu/lab',
    },
  ],
  entryPathways: [
    {
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      studentFacingLabel: 'Plan careful outreach',
      sourceUrls: ['https://example.yale.edu/lab'],
    },
  ],
  contactRoutes: [],
  postedOpportunities: [],
};

const explanation = {
  recommendedAction: 'PLAN_EXPLORATORY_OUTREACH' as const,
  headline: 'Plan careful exploratory outreach.',
  explanation:
    'This profile has source-backed evidence that outreach may be plausible, but no active posted role is attached.',
  why: ['The access evidence points to an official profile route.'],
  notThis: 'Not a posted opening.',
  confidence: 0.72,
  sourceUrls: ['https://example.yale.edu/lab'],
  reviewFlags: [],
};

function makeContext(
  overrides: Partial<ScraperContext['options']> = {},
): { ctx: ScraperContext; emitted: ObservationInput[]; logs: string[] } {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'student-decision-llm',
    sourceWeight: 0.55,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: (message) => {
      logs.push(message);
    },
  };
  return { ctx, emitted, logs };
}

function newTestScraper(
  deps: StudentDecisionLLMExtractorDeps,
): StudentDecisionLLMExtractor {
  return new StudentDecisionLLMExtractor({
    apiKey: 'test-key',
    model: 'test-model',
    ...deps,
  });
}

describe('studentDecisionLLMExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCached).mockResolvedValue(null);
    vi.mocked(setCached).mockResolvedValue(undefined);
  });

  it('selects candidates with action evidence and respects only/limit filters', () => {
    expect(
      selectDecisionCandidates(
        [
          candidate,
          { ...candidate, _id: 'entity-2', slug: 'no-evidence', accessSignals: [], entryPathways: [] },
          { ...candidate, _id: 'entity-3', slug: 'other-lab' },
          { ...candidate, _id: 'entity-4', slug: 'already-explained', studentDecisionExplanation: explanation },
        ],
        { only: ['example-lab', 'other-lab', 'already-explained'], limit: 10 },
      ).map((item) => item.slug),
    ).toEqual(['example-lab', 'other-lab']);
  });

  it('skips candidates that have only summary text and no source-backed evidence URLs', () => {
    expect(
      selectDecisionCandidates([
        {
          ...candidate,
          _id: 'summary-only',
          slug: 'summary-only',
          sourceUrls: [],
          websiteUrl: undefined,
          accessSignals: [],
          entryPathways: [],
          contactRoutes: [],
          postedOpportunities: [],
        },
      ]),
    ).toEqual([]);
  });

  it('skips person-named entities when profile evidence points to a different same-last-name person', () => {
    expect(
      selectDecisionCandidates([
        {
          ...candidate,
          _id: 'entity-mismatch',
          slug: 'ysm-jschwartz',
          name: 'Jason L. Schwartz, Ph.D.',
          sourceUrls: [
            'https://medicine.yale.edu/lab/jschwartz/',
            'https://medicine.yale.edu/profile/jeffrey-schwartz/',
          ],
          accessSignals: [
            {
              signalType: 'REACH_OUT_PLAUSIBLE',
              confidence: 'LOW',
              excerpt: 'Official Yale profile identifies the lead faculty member.',
              sourceUrl: 'https://medicine.yale.edu/profile/jeffrey-schwartz/',
            },
          ],
          entryPathways: [
            {
              pathwayType: 'EXPLORATORY_CONTACT',
              status: 'PLAUSIBLE',
              studentFacingLabel: 'Explore this research area through the official faculty profile',
              sourceUrls: ['https://medicine.yale.edu/profile/jeffrey-schwartz/'],
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('builds prompts from evidence bundles rather than raw scraped pages', () => {
    const prompt = buildStudentDecisionPrompt(candidate);

    expect(prompt).toContain('Research entity: Example Lab');
    expect(prompt).toContain('Use the exact research entity name in the headline');
    expect(prompt).toContain('Current best next step: Plan exploratory outreach');
    expect(prompt).toContain('REACH_OUT_PLAUSIBLE');
    expect(prompt).toContain('https://example.yale.edu/lab');
  });

  it('keeps the LLM response schema aligned with the public validator actions', () => {
    expect(
      STUDENT_DECISION_RESPONSE_FORMAT.json_schema.schema.properties.recommendedAction.enum,
    ).toEqual(studentDecisionRecommendedActions);
  });

  it('turns valid LLM output into a low-confidence studentDecisionExplanation observation', () => {
    const observation = decisionExtractionToObservation(candidate, explanation, new Date('2026-05-29T00:00:00Z'));

    expect(observation).toMatchObject({
      entityType: 'researchEntity',
      entityKey: 'example-lab',
      field: 'studentDecisionExplanation',
      sourceUrl: 'https://example.yale.edu/lab',
      confidenceOverride: 0.55,
    });
    expect(observation?.value).toMatchObject({
      headline: 'Plan careful exploratory outreach.',
      recommendedAction: 'PLAN_EXPLORATORY_OUTREACH',
    });
  });

  it('uses the most specific evidence URL for observation provenance', () => {
    const observation = decisionExtractionToObservation(
      {
        ...candidate,
        websiteUrl: 'https://medicine.yale.edu/lab/example/',
        sourceUrls: [
          'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
          'https://medicine.yale.edu/lab/example/',
        ],
        accessSignals: [
          {
            signalType: 'REACH_OUT_PLAUSIBLE',
            confidence: 'MEDIUM',
            excerpt: 'Official profile evidence.',
            sourceUrl: 'https://medicine.yale.edu/profile/example-faculty/',
          },
        ],
      },
      {
        ...explanation,
        sourceUrls: [
          'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
          'https://medicine.yale.edu/profile/example-faculty/',
        ],
      },
    );

    expect(observation?.sourceUrl).toBe('https://medicine.yale.edu/profile/example-faculty/');
  });

  it('rejects unsafe LLM output before emitting observations', async () => {
    const { ctx, emitted, logs } = makeContext();
    const scraper = newTestScraper({
      candidateLoader: vi.fn(async () => [candidate]),
      callLLM: vi.fn(async () => ({
        ...explanation,
        recommendedAction: 'APPLY',
        headline: 'Apply now.',
      })),
    });

    const result = await scraper.run(ctx);

    expect(result.observationCount).toBe(0);
    expect(emitted).toEqual([]);
    expect(logs.some((line) => line.includes('rejected unsafe explanation'))).toBe(true);
  });

  it('runs the enrichment lane and emits one observation per valid explanation', async () => {
    const { ctx, emitted } = makeContext();
    const scraper = newTestScraper({
      candidateLoader: vi.fn(async () => [candidate]),
      callLLM: vi.fn(async () => explanation),
    });

    const result = await scraper.run(ctx);

    expect(result).toMatchObject({ observationCount: 1, entitiesObserved: 1 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].field).toBe('studentDecisionExplanation');
  });

  it('rejects unsafe runtime limits before loading candidates', async () => {
    const { ctx } = makeContext({ limit: 9007199254740992 });
    const candidateLoader = vi.fn(async () => [candidate]);
    const callLLM = vi.fn(async () => explanation);
    const scraper = newTestScraper({
      candidateLoader,
      callLLM,
    });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(candidateLoader).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('returns zero observations when OPENAI_API_KEY is missing', async () => {
    const { ctx, emitted, logs } = makeContext();
    const scraper = new StudentDecisionLLMExtractor({
      apiKey: '',
      candidateLoader: vi.fn(async () => [candidate]),
      callLLM: vi.fn(async () => explanation),
    });

    const result = await scraper.run(ctx);

    expect(result).toMatchObject({ observationCount: 0, entitiesObserved: 0 });
    expect(emitted).toEqual([]);
    expect(logs.some((line) => line.includes('OPENAI_API_KEY missing'))).toBe(true);
  });

  it('can replay cached LLM output without OPENAI_API_KEY or a live provider call', async () => {
    vi.mocked(getCached).mockResolvedValueOnce(explanation);
    const { ctx, emitted } = makeContext({ useCache: true });
    const callLLM = vi.fn(async () => explanation);
    const scraper = new StudentDecisionLLMExtractor({
      apiKey: '',
      candidateLoader: vi.fn(async () => [candidate]),
      callLLM,
    });

    const result = await scraper.run(ctx);

    expect(result).toMatchObject({ observationCount: 1, entitiesObserved: 1 });
    expect(emitted).toHaveLength(1);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('calls OpenAI with the strict student-decision JSON schema and parses the response', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify(explanation),
            },
          },
        ],
      },
    });

    const output = await defaultCallLLM('prompt body', candidate, 'test-model', 'test-key');

    expect(output).toEqual(explanation);
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        model: 'test-model',
        response_format: expect.objectContaining({
          type: 'json_schema',
          json_schema: expect.objectContaining({
            name: 'student_decision_explanation',
            strict: true,
          }),
        }),
        temperature: 0,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });
});
