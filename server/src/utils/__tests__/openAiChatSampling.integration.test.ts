import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { openAiChatSampling } from '../openAiChatSampling';
import { CARD_SYNTHESIS_MODEL, defaultCardSynthesisLLM } from '../groundedCardSynthesis';
import { defaultCallLLM } from '../../scrapers/sources/labMicrositeUndergradLLMExtractor';

vi.mock('axios');

const mockedPost = vi.mocked(axios.post);

function stubOpenAiJson(content: string): void {
  mockedPost.mockResolvedValue({
    data: { choices: [{ message: { content } }] },
  } as never);
}

function lastRequestBody(): Record<string, unknown> {
  const call = mockedPost.mock.calls.at(-1);
  if (!call) throw new Error('axios.post was never called');
  return call[1] as Record<string, unknown>;
}

afterEach(() => {
  mockedPost.mockReset();
});

describe('openAiChatSampling sampling contract', () => {
  it('adopts gpt-5-mini as the default scraper/materializer model', () => {
    expect(CARD_SYNTHESIS_MODEL).toBe('gpt-5-mini');
  });

  it('sends reasoning_effort and drops temperature for gpt-5 family', () => {
    expect(openAiChatSampling('gpt-5-mini')).toEqual({ reasoning_effort: 'minimal' });
    expect(openAiChatSampling('gpt-5')).toEqual({ reasoning_effort: 'minimal' });
    expect(openAiChatSampling('gpt-5-mini')).not.toHaveProperty('temperature');
  });

  it('keeps deterministic temperature for legacy chat models', () => {
    expect(openAiChatSampling('gpt-4o-mini')).toEqual({ temperature: 0 });
    expect(openAiChatSampling('gpt-4o')).toEqual({ temperature: 0 });
    expect(openAiChatSampling('gpt-4o-mini')).not.toHaveProperty('reasoning_effort');
  });

  it('tolerates missing or padded model names', () => {
    expect(openAiChatSampling('  gpt-5-mini  ')).toEqual({ reasoning_effort: 'minimal' });
    expect(openAiChatSampling('')).toEqual({ temperature: 0 });
    expect(openAiChatSampling(undefined as unknown as string)).toEqual({ temperature: 0 });
  });
});

describe('grounded card synthesis OpenAI request payload', () => {
  it('emits reasoning_effort and no temperature when calling gpt-5-mini', async () => {
    stubOpenAiJson(JSON.stringify({ shortDescription: 'Studies neural circuits.' }));

    await defaultCardSynthesisLLM({
      model: 'gpt-5-mini',
      apiKey: 'test-key',
      entityName: 'Test Lab',
      fullDescription: 'The lab studies neural circuits underlying memory.',
    });

    const body = lastRequestBody();
    expect(body.model).toBe('gpt-5-mini');
    expect(body).toMatchObject({ reasoning_effort: 'minimal' });
    expect(body).not.toHaveProperty('temperature');
  });

  it('emits temperature 0 when a legacy model is configured', async () => {
    stubOpenAiJson(JSON.stringify({ shortDescription: 'Studies neural circuits.' }));

    await defaultCardSynthesisLLM({
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      entityName: 'Test Lab',
      fullDescription: 'The lab studies neural circuits underlying memory.',
    });

    const body = lastRequestBody();
    expect(body).toMatchObject({ temperature: 0 });
    expect(body).not.toHaveProperty('reasoning_effort');
  });
});

describe('lab microsite undergrad extractor OpenAI request payload', () => {
  it('emits reasoning_effort and no temperature when calling gpt-5-mini', async () => {
    stubOpenAiJson(JSON.stringify({ researchSummary: '' }));

    await defaultCallLLM({
      model: 'gpt-5-mini',
      systemPrompt: 'system',
      userPrompt: 'page text',
      apiKey: 'test-key',
      responseFormat: { type: 'json_object' },
    });

    const body = lastRequestBody();
    expect(body.model).toBe('gpt-5-mini');
    expect(body).toMatchObject({ reasoning_effort: 'minimal' });
    expect(body).not.toHaveProperty('temperature');
  });
});
