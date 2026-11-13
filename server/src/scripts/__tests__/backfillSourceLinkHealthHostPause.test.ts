import { afterEach, describe, expect, it } from 'vitest';

import { probeUncachedUrlsByHost } from '../backfillSourceLinkHealth';
import type { SourceLinkHealth } from '../../services/sourceLinkHealth';
import type { HostPause } from '../../scrapers/utils/hostPause';
import {
  recordHostBackoff,
  resetHostPauseStateForTests,
} from '../../scrapers/utils/hostPauseState';

const PAUSED_UNTIL = new Date(Date.now() + 7 * 24 * 60 * 60_000);

afterEach(() => resetHostPauseStateForTests());

describe('probeUncachedUrlsByHost and a paused host', () => {
  it('sends a paused host no probes, caches no verdict for it, and notes the pause', async () => {
    recordHostBackoff('dept.example.edu', { status: 403, statedUntil: PAUSED_UNTIL });
    const probed: string[] = [];
    const cache = new Map<string, SourceLinkHealth>();
    const result = { checked: 0, errors: 0, deferredPausedHost: 0 };
    const pausesSeen: HostPause[] = [];

    await probeUncachedUrlsByHost(
      ['https://dept.example.edu/a', 'https://dept.example.edu/b', 'https://open.example.edu/c'],
      cache,
      {
        checkLink: async (url) => {
          probed.push(url);
          return { healthStatus: 'HEALTHY' };
        },
        hostConcurrency: 2,
        paceDelayMs: 0,
        sleep: async () => {},
        result,
        pausesSeen,
      },
    );

    expect(probed).toEqual(['https://open.example.edu/c']);
    expect([...cache.keys()]).toEqual(['https://open.example.edu/c']);
    expect(result.deferredPausedHost).toBe(2);
    expect(pausesSeen[0]).toEqual({ host: 'dept.example.edu', until: PAUSED_UNTIL });
  });

  it('discards the verdict of the probe that set the pause, and skips the rest of the host', async () => {
    const probed: string[] = [];
    const cache = new Map<string, SourceLinkHealth>();
    const result = { checked: 0, errors: 0, deferredPausedHost: 0 };

    await probeUncachedUrlsByHost(
      ['https://dept.example.edu/a', 'https://dept.example.edu/b'],
      cache,
      {
        checkLink: async (url) => {
          probed.push(url);
          recordHostBackoff('dept.example.edu', { status: 429 });
          return { healthStatus: 'UNKNOWN', httpStatusCode: 429 } as SourceLinkHealth;
        },
        hostConcurrency: 1,
        paceDelayMs: 0,
        sleep: async () => {},
        result,
      },
    );

    expect(probed).toEqual(['https://dept.example.edu/a']);
    expect(cache.size).toBe(0);
    expect(result.deferredPausedHost).toBe(2);
  });

  it('spaces even a one-at-a-time host by its own interval, fallbacks and retries included', async () => {
    let gated = 0;
    await probeUncachedUrlsByHost(
      ['https://slow.example.edu/a', 'https://slow.example.edu/b'],
      new Map(),
      {
        checkLink: async (_url, requestGate) => {
          if (requestGate) gated += 1;
          return { healthStatus: 'HEALTHY' };
        },
        hostConcurrency: 1,
        paceDelayMs: 250,
        sleep: async () => {},
        result: { checked: 0, errors: 0 },
        hostThrottleFor: (host) =>
          host === 'slow.example.edu' ? { concurrency: 1, minIntervalMs: 1_500 } : undefined,
      },
    );

    expect(gated).toBe(2);
  });
});
