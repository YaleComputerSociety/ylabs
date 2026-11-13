import axios from 'axios';
import { BenchmarkReplayNetworkError } from '../../scrapers/snapshotBenchmarkMode';
import { HOST_BUDGET_EXEMPT } from '../../scrapers/utils/hostBudgetExempt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FROZEN_MODEL_RESPONSE_HEADER,
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
  });

  afterEach(() => {
    restoreDefaultModelUsageSink();
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
      ...HOST_BUDGET_EXEMPT,
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

    expect(recorded).toEqual([]);
  });

  it('records nothing for a request a benchmark replay refused before it left the process', async () => {
    post.mockRejectedValue(new BenchmarkReplayNetworkError());

    await expect(
      postChatCompletion({
        caller: 'card-synthesis',
        apiKey: 'sk-test',
        timeoutMs: 1,
        body: { model: 'gpt-5-mini' },
      }),
    ).rejects.toBeInstanceOf(BenchmarkReplayNetworkError);

    expect(recorded).toEqual([]);
  });

  it('holds the call until its usage record is written', async () => {
    post.mockResolvedValue(chatResponse);
    let releaseWrite: () => void = () => undefined;
    const writes: ModelUsageRecord[] = [];
    setModelUsageSink(
      (record) =>
        new Promise<void>((resolve) => {
          releaseWrite = () => {
            writes.push(record);
            resolve();
          };
        }),
    );

    let settled = false;
    const call = postChatCompletion({
      caller: 'card-synthesis',
      apiKey: 'sk-test',
      timeoutMs: 1,
      body: { model: 'gpt-5-mini' },
    }).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    releaseWrite();
    await call;
    expect(writes).toHaveLength(1);
  });

  it('returns a background-recorded call without waiting for its usage write', async () => {
    post.mockResolvedValue(chatResponse);
    let releaseWrite: () => void = () => undefined;
    setModelUsageSink(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );

    await expect(
      postEmbedding({
        caller: 'research-search-query-embedding',
        apiKey: 'sk-test',
        timeoutMs: 1,
        usageWrite: 'background',
        body: { model: 'text-embedding-3-small', input: 'protein folding' },
      }),
    ).resolves.toBe(chatResponse);
    releaseWrite();
  });

  it('posts embeddings to the OpenAI endpoint and treats only that host as the model endpoint', async () => {
    post.mockResolvedValue({ data: { data: [{ embedding: [0.1] }] }, headers: {} });

    await postEmbedding({
      caller: 'research-search-query-embedding',
      apiKey: 'sk-test',
      timeoutMs: 2_000,
      body: { model: 'text-embedding-3-small', input: 'protein folding' },
    });

    expect(post.mock.calls[0][0]).toBe('https://api.openai.com/v1/embeddings');
    expect(isModelEndpointUrl('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(isModelEndpointUrl('https://gateway.example.test/v1/chat/completions')).toBe(false);
  });
});
