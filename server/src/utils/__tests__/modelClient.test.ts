import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FROZEN_MODEL_RESPONSE_HEADER,
  flushModelUsageRecords,
  isModelEndpointUrl,
  type ModelUsageRecord,
  postChatCompletion,
  postEmbedding,
  restoreDefaultModelUsageSink,
  setModelUsageSink,
} from '../modelClient';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const post = vi.mocked(axios.post);

const chatResponse = {
  data: {
    choices: [{ message: { content: '{}' } }],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 80,
      prompt_tokens_details: { cached_tokens: 1024 },
      completion_tokens_details: { reasoning_tokens: 16 },
    },
  },
  headers: {},
};

describe('postChatCompletion', () => {
  let recorded: ModelUsageRecord[];

  beforeEach(() => {
    recorded = [];
    setModelUsageSink(async (record) => {
      recorded.push(record);
    });
    post.mockReset();
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    restoreDefaultModelUsageSink();
    delete process.env.OPENAI_BASE_URL;
  });

  it('sends the same request every call site used to send by hand', async () => {
    post.mockResolvedValue(chatResponse);
    const body = { model: 'gpt-5-mini', messages: [{ role: 'user', content: 'hi' }] };

    const response = await postChatCompletion({
      caller: 'card-synthesis',
      apiKey: 'sk-test',
      timeoutMs: 30_000,
      body,
    });

    expect(response).toBe(chatResponse);
    expect(post).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', body, {
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      timeout: 30_000,
    });
  });

  it('records the caller, model, and every billed token count', async () => {
    post.mockResolvedValue(chatResponse);

    await postChatCompletion({
      caller: 'coverage-synthesis-llm',
      apiKey: 'sk-test',
      timeoutMs: 1,
      body: { model: 'gpt-5-mini' },
    });
    await flushModelUsageRecords();

    expect(recorded).toEqual([
      expect.objectContaining({
        caller: 'coverage-synthesis-llm',
        endpoint: 'chat/completions',
        model: 'gpt-5-mini',
        succeeded: true,
        promptTokens: 1200,
        cachedPromptTokens: 1024,
        completionTokens: 80,
        reasoningTokens: 16,
      }),
    ]);
  });

  it('records a failed call and still throws its error', async () => {
    post.mockRejectedValue(new Error('timeout'));

    await expect(
      postChatCompletion({
        caller: 'card-synthesis',
        apiKey: 'sk-test',
        timeoutMs: 1,
        body: { model: 'gpt-5-mini' },
      }),
    ).rejects.toThrow('timeout');
    await flushModelUsageRecords();

    expect(recorded).toEqual([
      expect.objectContaining({ succeeded: false, promptTokens: 0, completionTokens: 0 }),
    ]);
  });

  it('records nothing for a response a benchmark replay served from its frozen pages', async () => {
    post.mockResolvedValue({
      ...chatResponse,
      headers: { [FROZEN_MODEL_RESPONSE_HEADER]: 'true' },
    });

    await postChatCompletion({
      caller: 'card-synthesis',
      apiKey: 'sk-test',
      timeoutMs: 1,
      body: { model: 'gpt-5-mini' },
    });
    await flushModelUsageRecords();

    expect(recorded).toEqual([]);
  });

  it('returns the response even when the usage sink fails', async () => {
    post.mockResolvedValue(chatResponse);
    setModelUsageSink(async () => {
      throw new Error('database unavailable');
    });

    await expect(
      postChatCompletion({
        caller: 'card-synthesis',
        apiKey: 'sk-test',
        timeoutMs: 1,
        body: { model: 'gpt-5-mini' },
      }),
    ).resolves.toBe(chatResponse);
    await expect(flushModelUsageRecords()).resolves.toBeUndefined();
  });

  it('records nothing when usage recording is switched off', async () => {
    post.mockResolvedValue(chatResponse);
    setModelUsageSink(null);

    await postChatCompletion({
      caller: 'card-synthesis',
      apiKey: 'sk-test',
      timeoutMs: 1,
      body: { model: 'gpt-5-mini' },
    });
    await flushModelUsageRecords();

    expect(recorded).toEqual([]);
  });

  it('posts to a configured base URL and treats only that host as the model endpoint', async () => {
    process.env.OPENAI_BASE_URL = 'https://gateway.example.test/v1/';
    post.mockResolvedValue({ data: { data: [{ embedding: [0.1] }] }, headers: {} });

    await postEmbedding({
      caller: 'research-search-query-embedding',
      apiKey: 'sk-test',
      timeoutMs: 2_000,
      body: { model: 'text-embedding-3-small', input: 'protein folding' },
    });

    expect(post.mock.calls[0][0]).toBe('https://gateway.example.test/v1/embeddings');
    expect(isModelEndpointUrl('https://gateway.example.test/v1/chat/completions')).toBe(true);
    expect(isModelEndpointUrl('https://api.openai.com/v1/chat/completions')).toBe(false);
  });
});
