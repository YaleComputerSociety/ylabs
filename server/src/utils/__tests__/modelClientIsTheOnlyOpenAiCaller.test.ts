import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCoverageSynthesisLLM } from '../../scrapers/coverageSynthesis';
import { defaultCallLLM as defaultUndergradCallLLM } from '../../scrapers/sources/labMicrositeUndergradLLMExtractor';
import { defaultResearchTopicsModel } from '../../scripts/deriveResearchTopicsCore';
import { defaultLabDescriptionSynthesizer } from '../../scripts/labDescriptionSynthesis';
import {
  clearResearchSearchQueryEmbeddingCache,
  getResearchSearchQueryVector,
} from '../../services/researchSearchQueryEmbedding';
import { defaultSearchRerankLiveMissModel } from '../../services/searchRerankLiveMissJob';
import { defaultCardSynthesisLLM } from '../groundedCardSynthesis';
import {
  type ModelCaller,
  type ModelUsageRecord,
  restoreDefaultModelUsageSink,
  setModelUsageSink,
} from '../modelClient';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const post = vi.mocked(axios.post);
const API_KEY = 'sk-synthetic-test-key';

const openAiResponse = {
  data: {
    choices: [{ message: { content: '{}' } }],
    data: [{ embedding: [0.25, 0.5] }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  },
  headers: {},
};

const defaultModelCalls: Array<[ModelCaller, () => Promise<unknown>]> = [
  [
    'card-synthesis',
    () =>
      defaultCardSynthesisLLM({
        model: 'gpt-5-mini',
        apiKey: API_KEY,
        fullDescription: 'Studies protein folding.',
        entityName: 'Synthetic Folding Lab',
      }),
  ],
  [
    'coverage-synthesis-llm',
    () =>
      defaultCoverageSynthesisLLM(API_KEY)({
        entityName: 'Synthetic Folding Lab',
        snippets: [{ text: 'Studies protein folding.' }],
      } as Parameters<ReturnType<typeof defaultCoverageSynthesisLLM>>[0]),
  ],
  [
    'lab-description-synthesis',
    () =>
      defaultLabDescriptionSynthesizer({
        name: 'Synthetic Folding Lab',
        sourceText: 'Studies protein folding.',
      }),
  ],
  [
    'research-topics-derivation',
    () =>
      defaultResearchTopicsModel(API_KEY)({
        model: 'gpt-5-mini',
        pages: [{ url: 'https://example.test/research', text: 'Studies protein folding.' }],
      } as Parameters<ReturnType<typeof defaultResearchTopicsModel>>[0]),
  ],
  [
    'lab-microsite-undergrad-llm',
    () =>
      defaultUndergradCallLLM({
        model: 'gpt-5-mini',
        systemPrompt: 'system',
        userPrompt: 'user',
        apiKey: API_KEY,
        responseFormat: { type: 'json_object' },
      }),
  ],
  ['research-search-query-embedding', () => getResearchSearchQueryVector('protein folding')],
  [
    'search-rerank-live-miss',
    () =>
      defaultSearchRerankLiveMissModel(API_KEY)({
        query: 'protein folding',
        candidates: [
          {
            entityId: 'synthetic-row-a',
            name: 'Synthetic Folding Lab',
            departments: ['Synthetic Department'],
            shortDescription: 'Studies protein folding.',
            fullDescription: 'Studies protein folding.',
          },
        ],
      }),
  ],
];

describe('default model calls reach OpenAI only through the shared client', () => {
  let recorded: ModelUsageRecord[];
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    recorded = [];
    setModelUsageSink(async (record) => {
      recorded.push(record);
    });
    post.mockReset();
    post.mockResolvedValue(openAiResponse);
    process.env.OPENAI_API_KEY = API_KEY;
    clearResearchSearchQueryEmbeddingCache();
  });

  afterEach(() => {
    restoreDefaultModelUsageSink();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  it.each(defaultModelCalls)(
    'leaves one usage record under %s for each OpenAI request',
    async (caller, call) => {
      await call().catch(() => undefined);

      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0]).toMatch(/^https:\/\/api\.openai\.com\/v1\//);
      expect(recorded.map((record) => record.caller)).toEqual([caller]);
    },
  );
});
