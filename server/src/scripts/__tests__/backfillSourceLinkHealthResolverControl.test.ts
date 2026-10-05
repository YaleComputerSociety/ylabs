import { describe, expect, it } from 'vitest';

import { probeUncachedUrlsByHost } from '../backfillSourceLinkHealth';
import type { SourceLinkHealth } from '../../services/sourceLinkHealth';
import {
  ResolverCircuitBreaker,
  ResolverUnhealthyError,
  type ResolverControlProbe,
} from '../../scrapers/utils/resolverCircuitBreaker';

const unresolvable = (): SourceLinkHealth => ({ healthStatus: 'UNAVAILABLE' });
const deadUrls = (count: number) =>
  Array.from({ length: count }, (_, i) => `https://gone-${i}.example.edu/lab`);

const probeAll = async (urls: string[], controlProbe: ResolverControlProbe) => {
  const result = { checked: 0, errors: 0 };
  const breaker = new ResolverCircuitBreaker({
    threshold: 5,
    controlProbe,
    sleep: async () => undefined,
  });
  const run = probeUncachedUrlsByHost(urls, new Map(), {
    checkLink: async () => unresolvable(),
    hostConcurrency: 4,
    paceDelayMs: 0,
    sleep: async () => undefined,
    result,
    resolverBreaker: breaker,
  });
  return { result, breaker, run };
};

describe('probeUncachedUrlsByHost resolver control (#4865)', () => {
  it('probes a set made only of dead hosts to the end while the control answers', async () => {
    const { result, breaker, run } = await probeAll(deadUrls(12), async () => ({
      healthy: true,
      detail: 'control answered HTTP 200',
    }));
    await expect(run).resolves.toBeUndefined();
    expect(result.checked).toBe(12);
    expect(breaker.stats.trips).toBe(0);
    expect(breaker.stats.tripsAvoided).toBeGreaterThan(0);
  });

  it('halts on a resolver outage before recording much past the threshold', async () => {
    const { result, breaker, run } = await probeAll(deadUrls(40), async () => ({
      healthy: false,
      detail: 'control: ENOTFOUND',
    }));
    await expect(run).rejects.toBeInstanceOf(ResolverUnhealthyError);
    expect(breaker.stats).toMatchObject({ controlChecks: 1, trips: 1 });
    expect(result.checked).toBeLessThanOrEqual(5 + 4);
  });
});
