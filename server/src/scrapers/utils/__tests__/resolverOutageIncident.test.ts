import { describe, expect, it, vi } from 'vitest';

import { ResolverCircuitBreaker, ResolverUnhealthyError } from '../resolverCircuitBreaker';

/**
 * Replays the shape of the #2775 incident: a resolver failing intermittently while
 * a pass probes many unrelated hosts. Before #2782 the pass recorded 154 hosts as
 * dead and 134 of them answered 200 from a healthy network. The requirement is not
 * that every false death is prevented in isolation, which no single probe can
 * promise, but that the pass STOPS instead of producing 134 of them.
 */
describe('a resolver outage during a corpus pass (#2775 replay)', () => {
  const deadHosts = ['gone-a.example.edu', 'gone-b.example.edu'];

  const runPass = (hosts: string[], resolverBroken: () => boolean) => {
    const breaker = new ResolverCircuitBreaker({ threshold: 5, windowMs: 60_000 });
    const recordedDead: string[] = [];
    try {
      for (const host of hosts) {
        // A broken resolver makes every lookup look like an absent name.
        const looksDead = resolverBroken() || deadHosts.includes(host);
        if (looksDead) {
          breaker.recordFailure(host);
          recordedDead.push(host);
        } else {
          breaker.recordSuccess(host);
        }
      }
    } catch (error) {
      if (!(error instanceof ResolverUnhealthyError)) throw error;
      return { recordedDead, halted: true, failing: (error as ResolverUnhealthyError).hosts };
    }
    return { recordedDead, halted: false, failing: breaker.failingHosts };
  };

  const corpus = Array.from({ length: 154 }, (_, i) => `host-${i}.example.edu`).concat(deadHosts);

  it('halts the pass instead of recording 154 deaths', () => {
    const result = runPass(corpus, () => true);
    expect(result.halted).toBe(true);
    // Five distinct failures is the threshold, so the sixth cannot be written.
    expect(result.recordedDead.length).toBeLessThanOrEqual(5);
    expect(result.recordedDead.length).toBeLessThan(154);
  });

  it('lets a healthy pass record the genuinely dead hosts and finish', () => {
    const result = runPass(corpus, () => false);
    expect(result.halted).toBe(false);
    expect(result.recordedDead).toEqual(deadHosts);
  });

  it('survives a brief outage that stays under the threshold', () => {
    let calls = 0;
    // Broken for the first two hosts, then healthy. Two transient failures plus
    // the two genuinely dead hosts is four distinct hosts, under the threshold.
    const result = runPass(corpus, () => (calls += 1) <= 2);
    expect(result.halted).toBe(false);
    expect(result.recordedDead).toEqual([...corpus.slice(0, 2), ...deadHosts]);
  });

  // A transient failure stays in the window until it expires, so it can combine
  // with genuine deaths to trip the breaker. That is deliberate: the failure mode
  // is a halt, which costs a re-run, rather than a false death, which hides a live
  // page from a student. Prefer halting when the two are indistinguishable.
  it('halts when transient failures plus genuine deaths reach the threshold', () => {
    let calls = 0;
    const result = runPass(corpus, () => (calls += 1) <= 3);
    expect(result.halted).toBe(true);
    expect(result.recordedDead.length).toBeLessThanOrEqual(5);
  });

  it('is not fooled by one dead host probed over and over', () => {
    const repeated = Array.from({ length: 200 }, () => deadHosts[0]);
    const result = runPass(repeated, () => false);
    expect(result.halted).toBe(false);
    expect(result.failing).toEqual([deadHosts[0]]);
  });
});
