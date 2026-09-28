import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RENDERED_FETCH_BENCHMARK_NAMESPACE,
  withBenchmarkRenderedFetcher,
  type RenderedFetcher,
} from '../renderedFetch';
import {
  BenchmarkReplayNetworkError,
  beginBenchmarkCapture,
  beginBenchmarkReplay,
  finishBenchmarkCapture,
  finishBenchmarkReplay,
} from '../snapshotBenchmarkMode';
import { unresolvedReplayReason } from '../../scripts/laneScorecard';

const request = { url: 'https://example.org/grants', mode: 'stealthy' };
const rendered = {
  url: request.url,
  html: '<html>frozen render</html>',
  fetchMode: 'scrapling' as const,
};

describe('rendered fetches under a benchmark (#3590)', () => {
  afterEach(() => {
    for (const finish of [finishBenchmarkCapture, finishBenchmarkReplay]) {
      try {
        finish();
      } catch {
        /* not active */
      }
    }
  });

  it('serves a captured render on replay without calling the renderer', async () => {
    beginBenchmarkCapture();
    const live: RenderedFetcher = vi.fn(async () => rendered);
    await withBenchmarkRenderedFetcher(live)!(request);
    const pages = finishBenchmarkCapture();

    beginBenchmarkReplay(pages);
    const liveDuringReplay: RenderedFetcher = vi.fn(async () => {
      throw new Error('the live renderer must not run during replay');
    });
    const replayed = withBenchmarkRenderedFetcher(liveDuringReplay);
    expect(await replayed!(request)).toEqual(rendered);
    expect(liveDuringReplay).not.toHaveBeenCalled();
    expect(finishBenchmarkReplay().servedByNamespace[RENDERED_FETCH_BENCHMARK_NAMESPACE]).toBe(1);
  });

  it('reproduces a captured null render as null rather than as a miss', async () => {
    beginBenchmarkCapture();
    await withBenchmarkRenderedFetcher(async () => null)!(request);
    const pages = finishBenchmarkCapture();
    beginBenchmarkReplay(pages);
    expect(await withBenchmarkRenderedFetcher(null)!(request)).toBeNull();
    expect(finishBenchmarkReplay().pagesMissed).toBe(0);
  });

  it('counts a render the capture never saw as a miss and refuses it', async () => {
    beginBenchmarkCapture();
    await withBenchmarkRenderedFetcher(async () => rendered)!(request);
    const pages = finishBenchmarkCapture();
    beginBenchmarkReplay(pages);
    await expect(
      withBenchmarkRenderedFetcher(null)!({ url: 'https://example.org/unseen' }),
    ).rejects.toBeInstanceOf(BenchmarkReplayNetworkError);
    expect(finishBenchmarkReplay()).toMatchObject({ pagesMissed: 1, networkBlocks: 1 });
  });

  it('gives replay no renderer when the capture had none', () => {
    beginBenchmarkCapture();
    expect(withBenchmarkRenderedFetcher(null)).toBeNull();
    const pages = finishBenchmarkCapture();
    beginBenchmarkReplay(pages);
    expect(withBenchmarkRenderedFetcher(async () => rendered)).toBeNull();
  });
});

describe('unresolvedReplayReason (#3590)', () => {
  const page = (sourceName: string, requestKey: string) => ({ sourceName, requestKey });

  it('refuses a replay that served none of its frozen pages', () => {
    expect(
      unresolvedReplayReason([page('lane', 'page:1')], { pagesServed: 0, servedByNamespace: {} }),
    ).toMatch(/none of the 1 frozen pages/);
  });

  it('refuses a rendered replay whose renderer never engaged', () => {
    expect(
      unresolvedReplayReason(
        [
          page('lane', 'page:1'),
          page(RENDERED_FETCH_BENCHMARK_NAMESPACE, 'renderer:enabled'),
          page(RENDERED_FETCH_BENCHMARK_NAMESPACE, 'render:v1:https://example.org'),
        ],
        { pagesServed: 1, servedByNamespace: { lane: 1 } },
      ),
    ).toMatch(/renderer never engaged/);
  });

  it('accepts a replay that resolved its pages and renders', () => {
    expect(
      unresolvedReplayReason(
        [page('lane', 'page:1'), page(RENDERED_FETCH_BENCHMARK_NAMESPACE, 'render:v1:x')],
        { pagesServed: 2, servedByNamespace: { lane: 1, [RENDERED_FETCH_BENCHMARK_NAMESPACE]: 1 } },
      ),
    ).toBeUndefined();
  });
});
