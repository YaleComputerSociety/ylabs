import axios from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { getCached, setCached } from '../snapshotCache';
import {
  BenchmarkReplayMissError,
  BenchmarkReplayNetworkError,
  beginBenchmarkCapture,
  beginBenchmarkReplay,
  finishBenchmarkCapture,
  finishBenchmarkReplay,
} from '../snapshotBenchmarkMode';

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

  it('treats a page the capture never saw as a miss, not a fetch', async () => {
    beginBenchmarkReplay([]);
    await expect(getCached('lane-a', 'unseen')).rejects.toBeInstanceOf(BenchmarkReplayMissError);
    expect(finishBenchmarkReplay().pagesMissed).toBe(1);
  });

  it('blocks the network during replay and restores it afterwards', async () => {
    beginBenchmarkReplay([]);
    await expect(axios.get('https://example.invalid/')).rejects.toBeInstanceOf(
      BenchmarkReplayNetworkError,
    );
    expect(finishBenchmarkReplay().networkBlocks).toBe(1);
    expect(axios.interceptors.request).toBeDefined();
  });

  it('refuses to nest a replay inside a capture', () => {
    beginBenchmarkCapture();
    expect(() => beginBenchmarkReplay([])).toThrow(/already active/);
  });
});
