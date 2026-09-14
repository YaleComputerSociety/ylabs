/**
 * The request pattern, not the verdicts. A full Development pass produced 389
 * `UNKNOWN` against 131 stored, dominated by `403` on one host, and five of those
 * URLs each returned `200` when re-probed individually. The run was rate-limiting
 * itself, so ~400 verdicts degraded on request pattern alone (#2664).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_LINK_HEALTH_HOST_CONCURRENCY,
  DEFAULT_SOURCE_LINK_HEALTH_PACE_DELAY_MS,
  probeUncachedUrlsByHost,
} from '../backfillSourceLinkHealth';
import type { SourceLinkHealth } from '../../services/sourceLinkHealth';

const healthy = (url: string): SourceLinkHealth => ({
  url,
  healthStatus: 'HEALTHY',
  checkedAt: new Date(),
});

const harness = () => {
  const order: string[] = [];
  const inFlightByHost = new Map<string, number>();
  const maxInFlightByHost = new Map<string, number>();
  const sleeps: number[] = [];
  return {
    order,
    sleeps,
    maxInFlightByHost,
    result: { checked: 0, errors: 0 },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    checkLink: async (url: string) => {
      const host = new URL(url).hostname;
      const next = (inFlightByHost.get(host) ?? 0) + 1;
      inFlightByHost.set(host, next);
      maxInFlightByHost.set(host, Math.max(maxInFlightByHost.get(host) ?? 0, next));
      order.push(url);
      await Promise.resolve();
      inFlightByHost.set(host, next - 1);
      return healthy(url);
    },
  };
};

describe('probeUncachedUrlsByHost', () => {
  it('never has two requests in flight against one host', async () => {
    const h = harness();
    const cache = new Map<string, SourceLinkHealth>();
    const urls = [
      ...Array.from({ length: 6 }, (_, i) => `https://one.yale.edu/${i}`),
      ...Array.from({ length: 6 }, (_, i) => `https://two.yale.edu/${i}`),
    ];

    await probeUncachedUrlsByHost(urls, cache, {
      checkLink: h.checkLink,
      hostConcurrency: 4,
      paceDelayMs: 10,
      sleep: h.sleep,
      result: h.result,
    });

    expect([...h.maxInFlightByHost.values()].every((count) => count === 1)).toBe(true);
    expect(cache.size).toBe(12);
    expect(h.result.checked).toBe(12);
  });

  it('paces between requests to one host, once per request after the first', async () => {
    const h = harness();
    await probeUncachedUrlsByHost(
      ['https://one.yale.edu/a', 'https://one.yale.edu/b', 'https://one.yale.edu/c'],
      new Map(),
      {
        checkLink: h.checkLink,
        hostConcurrency: 4,
        paceDelayMs: 250,
        sleep: h.sleep,
        result: h.result,
      },
    );

    expect(h.sleeps).toEqual([250, 250]);
  });

  // The bug this guards: pacing on candidates rather than requests would make an
  // already-known URL cost a host's delay, so a big corpus would crawl for nothing.
  it('does not probe or pace a URL already in the cache', async () => {
    const h = harness();
    const cache = new Map<string, SourceLinkHealth>([
      ['https://one.yale.edu/a', healthy('https://one.yale.edu/a')],
    ]);

    await probeUncachedUrlsByHost(['https://one.yale.edu/a', 'https://one.yale.edu/a'], cache, {
      checkLink: h.checkLink,
      hostConcurrency: 4,
      paceDelayMs: 250,
      sleep: h.sleep,
      result: h.result,
    });

    expect(h.order).toEqual([]);
    expect(h.sleeps).toEqual([]);
    expect(h.result.checked).toBe(0);
  });

  it('probes a repeated URL once within a single call', async () => {
    const h = harness();
    const cache = new Map<string, SourceLinkHealth>();

    await probeUncachedUrlsByHost(
      ['https://one.yale.edu/a', 'https://one.yale.edu/a', 'https://one.yale.edu/a'],
      cache,
      {
        checkLink: h.checkLink,
        hostConcurrency: 4,
        paceDelayMs: 250,
        sleep: h.sleep,
        result: h.result,
      },
    );

    expect(h.order).toEqual(['https://one.yale.edu/a']);
    expect(h.result.checked).toBe(1);
  });

  it('works hosts concurrently rather than one host at a time', async () => {
    const h = harness();
    const urls = Array.from({ length: 4 }, (_, i) => `https://host${i}.yale.edu/a`);

    await probeUncachedUrlsByHost(urls, new Map(), {
      checkLink: h.checkLink,
      hostConcurrency: 4,
      paceDelayMs: 0,
      sleep: h.sleep,
      result: h.result,
    });

    expect(h.result.checked).toBe(4);
    expect(new Set(h.order).size).toBe(4);
  });

  it('records a probe failure without abandoning the rest of the host', async () => {
    const h = harness();
    const cache = new Map<string, SourceLinkHealth>();
    const checkLink = async (url: string) => {
      if (url.endsWith('/boom')) throw new Error('probe exploded');
      return h.checkLink(url);
    };

    await probeUncachedUrlsByHost(
      ['https://one.yale.edu/boom', 'https://one.yale.edu/after'],
      cache,
      {
        checkLink,
        hostConcurrency: 4,
        paceDelayMs: 0,
        sleep: h.sleep,
        result: h.result,
      },
    );

    expect(h.result.errors).toBe(1);
    expect(cache.has('https://one.yale.edu/after')).toBe(true);
  });

  it('keeps an unparseable url in its own bucket rather than dropping it', async () => {
    const h = harness();
    const cache = new Map<string, SourceLinkHealth>();

    await probeUncachedUrlsByHost(['not-a-url'], cache, {
      checkLink: async (url: string) => healthy(url),
      hostConcurrency: 4,
      paceDelayMs: 0,
      sleep: h.sleep,
      result: h.result,
    });

    expect(h.result.checked).toBe(1);
    expect(cache.has('not-a-url')).toBe(true);
  });

  it('defaults are polite rather than aggressive', () => {
    expect(DEFAULT_SOURCE_LINK_HEALTH_HOST_CONCURRENCY).toBe(4);
    expect(DEFAULT_SOURCE_LINK_HEALTH_PACE_DELAY_MS).toBeGreaterThanOrEqual(250);
  });
});
