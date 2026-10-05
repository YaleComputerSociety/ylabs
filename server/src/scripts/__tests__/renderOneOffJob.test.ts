import { describe, expect, it } from 'vitest';
import {
  createRenderJob,
  describeRenderService,
  waitForRenderJob,
  type FetchLike,
} from '../renderOneOffJob';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected request');
    const status = next.status ?? 200;
    return { ok: status < 300, status, json: async () => next.body };
  };
  return { fetch, calls };
}

describe('Render one-off jobs', () => {
  it('creates a job with a bearer key and the start command only', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 201, body: { id: 'job-1', serviceId: 'srv-abc', status: 'pending' } },
    ]);
    const job = await createRenderJob({ apiKey: 'rnd_key', fetch }, 'srv-abc', 'echo hi');
    expect(job.id).toBe('job-1');
    expect(calls[0].url).toBe('https://api.render.com/v1/services/srv-abc/jobs');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.Authorization).toBe('Bearer rnd_key');
    expect(JSON.parse(calls[0].body!)).toEqual({ startCommand: 'echo hi' });
  });

  it('reports an HTTP failure without the key', async () => {
    const { fetch } = fakeFetch([{ status: 401, body: {} }]);
    const failure = await createRenderJob({ apiKey: 'rnd_key', fetch }, 'srv-abc', 'x').catch(
      (error: Error) => error,
    );
    expect((failure as Error).message).toBe(
      'Render API POST /services/srv-abc/jobs answered HTTP 401',
    );
    expect((failure as Error).message).not.toContain('rnd_key');
  });

  it('describes a service and refuses a mismatched id', async () => {
    const { fetch } = fakeFetch([
      {
        body: {
          id: 'srv-abc',
          name: 'operator',
          branch: 'beta',
          rootDir: '',
          suspended: 'not_suspended',
        },
      },
      { body: { id: 'srv-other' } },
    ]);
    await expect(describeRenderService({ apiKey: 'k', fetch }, 'srv-abc')).resolves.toMatchObject({
      name: 'operator',
      branch: 'beta',
    });
    await expect(describeRenderService({ apiKey: 'k', fetch }, 'srv-abc')).rejects.toThrow(
      'Render service srv-abc was not found',
    );
  });

  it('polls until a terminal status and reports each change once', async () => {
    const { fetch } = fakeFetch([
      { body: { id: 'job-1', serviceId: 'srv-abc', status: 'pending' } },
      { body: { id: 'job-1', serviceId: 'srv-abc', status: 'running' } },
      { body: { id: 'job-1', serviceId: 'srv-abc', status: 'running' } },
      { body: { id: 'job-1', serviceId: 'srv-abc', status: 'failed' } },
    ]);
    const seen: string[] = [];
    const sleeps: number[] = [];
    const job = await waitForRenderJob({ apiKey: 'k', fetch }, 'srv-abc', 'job-1', {
      intervalMs: 5,
      timeoutMs: 1_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
      onStatus: (current) => seen.push(current.status ?? '?'),
    });
    expect(job.status).toBe('failed');
    expect(seen).toEqual(['pending', 'running', 'failed']);
    expect(sleeps).toEqual([5, 5, 5]);
  });

  it('gives up waiting without cancelling the job', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { id: 'job-1', serviceId: 'srv-abc', status: 'running' } },
    ]);
    let clock = 0;
    await expect(
      waitForRenderJob({ apiKey: 'k', fetch }, 'srv-abc', 'job-1', {
        intervalMs: 5,
        timeoutMs: 60_000,
        sleep: async () => undefined,
        now: () => (clock += 120_000),
      }),
    ).rejects.toThrow('it keeps running on Render');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
});
