import axios from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, SsrfBlockedError } from '../../utils/ssrfGuard';
import { getCached, getCachedModelAnswer, setCached } from '../snapshotCache';
import {
  BenchmarkReplayNetworkError,
  beginBenchmarkCapture,
  beginBenchmarkReplay,
  finishBenchmarkCapture,
  finishBenchmarkReplay,
  isBenchmarkModeActive,
  MODEL_RESPONSE_NAMESPACE,
  modelRequestKey,
} from '../snapshotBenchmarkMode';
import { loadStoredContentHash } from '../contentHashGate';

const MODEL_URL = 'https://api.openai.com/v1/chat/completions';
const modelBody = (userPrompt: string) => ({
  model: 'gpt-5-mini',
  messages: [
    { role: 'system', content: 'Extract evidence.' },
    { role: 'user', content: userPrompt },
  ],
});
const liveModel = (answer: string) => async (config: any) => ({
  data: { choices: [{ message: { content: answer } }] },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
});

describe('snapshot benchmark mode', () => {
  afterEach(() => {
    try {
      finishBenchmarkCapture();
    } catch {
      /* not capturing */
    }
    try {
      finishBenchmarkReplay();
    } catch {
      /* not replaying */
    }
  });

  it('captures what a lane writes and forces every read to miss', async () => {
    beginBenchmarkCapture();
    expect(await getCached('lane-a', 'page:https://example.org')).toBeNull();
    await setCached('lane-a', 'page:https://example.org', '<html>a</html>');
    const pages = finishBenchmarkCapture();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      sourceName: 'lane-a',
      requestKey: 'page:https://example.org',
      payload: '<html>a</html>',
    });
  });

  it('replays captured pages and counts each distinct page once', async () => {
    beginBenchmarkReplay([
      { sourceName: 'lane-a', requestKey: 'k', payload: 'body', fetchedAt: new Date(0) },
    ]);
    expect(await getCached('lane-a', 'k')).toBe('body');
    expect(await getCached('lane-a', 'k')).toBe('body');
    await setCached('lane-a', 'k', 'overwritten');
    expect(await getCached('lane-a', 'k')).toBe('body');
    expect(finishBenchmarkReplay()).toEqual({ pagesServed: 1, pagesMissed: 0, networkBlocks: 0 });
  });

  it('treats a page the capture never saw as a counted miss, not a fetch', async () => {
    beginBenchmarkReplay([]);
    expect(await getCached('lane-a', 'unseen')).toBeNull();
    await expect(axios.get('https://example.invalid/unseen')).rejects.toBeInstanceOf(
      BenchmarkReplayNetworkError,
    );
    expect(finishBenchmarkReplay()).toEqual({ pagesServed: 0, pagesMissed: 1, networkBlocks: 1 });
  });

  it('blocks the network during replay and restores it afterwards', async () => {
    beginBenchmarkReplay([]);
    await expect(axios.get('https://example.invalid/')).rejects.toBeInstanceOf(
      BenchmarkReplayNetworkError,
    );
    expect(finishBenchmarkReplay().networkBlocks).toBe(1);
    const response = await axios.get('https://example.invalid/', {
      adapter: async (config) => ({
        data: 'live',
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }),
    });
    expect(response.data).toBe('live');
  });

  it('answers the SSRF guard without a DNS lookup during replay but keeps literal checks', async () => {
    beginBenchmarkReplay([]);
    await expect(assertPublicHttpUrl('https://captured-host.invalid/page')).resolves.toBeInstanceOf(
      URL,
    );
    await expect(assertPublicHttpUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHttpUrl('ftp://captured-host.invalid/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('captures a model response keyed by the exact request body', async () => {
    beginBenchmarkCapture();
    await axios.post(MODEL_URL, modelBody('page text'), { adapter: liveModel('yes') });
    await axios.get('https://example.org/page', { adapter: liveModel('not a model call') });
    const pages = finishBenchmarkCapture();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      sourceName: MODEL_RESPONSE_NAMESPACE,
      requestKey: modelRequestKey(MODEL_URL, modelBody('page text')),
      payload: { choices: [{ message: { content: 'yes' } }] },
    });
  });

  it('keys a model request the same whatever order its fields were written in', () => {
    const body = modelBody('page text');
    const reordered = { messages: body.messages, model: body.model };
    expect(modelRequestKey(MODEL_URL, reordered)).toBe(modelRequestKey(MODEL_URL, body));
    expect(modelRequestKey(MODEL_URL, JSON.stringify(body))).toBe(modelRequestKey(MODEL_URL, body));
  });

  it('serves a frozen model response without reaching the network', async () => {
    beginBenchmarkCapture();
    await axios.post(MODEL_URL, modelBody('page text'), { adapter: liveModel('yes') });
    const pages = finishBenchmarkCapture();

    beginBenchmarkReplay(pages);
    const response = await axios.post(MODEL_URL, modelBody('page text'));
    expect(response.data.choices[0].message.content).toBe('yes');
    expect(finishBenchmarkReplay()).toEqual({ pagesServed: 1, pagesMissed: 0, networkBlocks: 0 });
  });

  it('counts a changed prompt as a miss rather than serving the old answer', async () => {
    beginBenchmarkCapture();
    await axios.post(MODEL_URL, modelBody('page text'), { adapter: liveModel('yes') });
    const pages = finishBenchmarkCapture();

    beginBenchmarkReplay(pages);
    await expect(axios.post(MODEL_URL, modelBody('page text, cleaned'))).rejects.toBeInstanceOf(
      BenchmarkReplayNetworkError,
    );
    expect(finishBenchmarkReplay()).toEqual({ pagesServed: 0, pagesMissed: 1, networkBlocks: 1 });
  });

  it('lets a model call through in a live-model replay but still blocks page fetches', async () => {
    beginBenchmarkReplay([], { liveModel: true });
    const response = await axios.post(MODEL_URL, modelBody('page text'), {
      adapter: liveModel('fresh'),
    });
    expect(response.data.choices[0].message.content).toBe('fresh');
    await expect(axios.get('https://example.invalid/')).rejects.toBeInstanceOf(
      BenchmarkReplayNetworkError,
    );
    expect(finishBenchmarkReplay()).toEqual({ pagesServed: 0, pagesMissed: 0, networkBlocks: 1 });
  });

  it("reads past a lane's cached model answer only in a live-model replay", async () => {
    const pages = [
      { sourceName: 'lane-a', requestKey: 'llm:k', payload: 'frozen', fetchedAt: new Date(0) },
    ];
    beginBenchmarkReplay(pages);
    expect(await getCachedModelAnswer('lane-a', 'llm:k')).toBe('frozen');
    finishBenchmarkReplay();
    beginBenchmarkReplay(pages, { liveModel: true });
    expect(await getCachedModelAnswer('lane-a', 'llm:k')).toBeNull();
    expect(await getCached('lane-a', 'llm:k')).toBe('frozen');
  });

  it('stops recording model responses once the capture finishes', async () => {
    beginBenchmarkCapture();
    finishBenchmarkCapture();
    beginBenchmarkCapture();
    await axios.post(MODEL_URL, modelBody('later'), { adapter: liveModel('yes') });
    expect(finishBenchmarkCapture()).toHaveLength(1);
    expect(isBenchmarkModeActive()).toBe(false);
  });

  it('ignores the stored content hash while a benchmark is active', async () => {
    beginBenchmarkReplay([]);
    await expect(
      loadStoredContentHash('lane-a', { entityType: 'researchEntity', entityKey: 'lab' }),
    ).resolves.toBeUndefined();
  });

  it('refuses to nest a replay inside a capture', () => {
    beginBenchmarkCapture();
    expect(() => beginBenchmarkReplay([])).toThrow(/already active/);
  });
});
