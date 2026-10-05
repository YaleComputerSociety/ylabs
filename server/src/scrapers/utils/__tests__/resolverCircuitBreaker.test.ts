import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESOLVER_BREAKER_THRESHOLD,
  ResolverCircuitBreaker,
  ResolverUnhealthyError,
} from '../resolverCircuitBreaker';

const host = (n: number) => `host-${n}.example.edu`;

describe('ResolverCircuitBreaker', () => {
  it('never trips on one dead host failing repeatedly, however many times', () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 3 });
    for (let i = 0; i < 50; i += 1) breaker.recordFailure('gone.example.edu');
    expect(breaker.isTripped).toBe(false);
    expect(breaker.failingHosts).toEqual(['gone.example.edu']);
  });

  it('trips once distinct hosts reach the threshold, and keeps throwing', () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 3 });
    breaker.recordFailure(host(1));
    breaker.recordFailure(host(2));
    expect(breaker.isTripped).toBe(false);
    expect(() => breaker.recordFailure(host(3))).toThrow(ResolverUnhealthyError);
    expect(breaker.isTripped).toBe(true);
    // Tripped is terminal: a caller cannot continue past it by ignoring one throw.
    expect(() => breaker.assertHealthy()).toThrow(ResolverUnhealthyError);
    expect(() => breaker.recordFailure(host(9))).toThrow(ResolverUnhealthyError);
  });

  it('names the failing hosts and the window in the error', () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 2, windowMs: 30_000 });
    breaker.recordFailure(host(1));
    try {
      breaker.recordFailure(host(2));
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ResolverUnhealthyError);
      const typed = error as ResolverUnhealthyError;
      expect(typed.hosts).toEqual([host(1), host(2)]);
      expect(typed.message).toMatch(/2 distinct hosts failed to resolve within 30s/);
    }
  });

  it('a host that resolves stops counting against the resolver', () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 3 });
    breaker.recordFailure(host(1));
    breaker.recordFailure(host(2));
    breaker.recordSuccess(host(1));
    expect(breaker.failingHosts).toEqual([host(2)]);
    // Only two distinct hosts are outstanding, so this must not trip.
    breaker.recordFailure(host(3));
    expect(breaker.isTripped).toBe(false);
  });

  it('forgets failures older than the window, so slow rot never trips it', () => {
    let clock = 1_000_000;
    const breaker = new ResolverCircuitBreaker({
      threshold: 3,
      windowMs: 60_000,
      now: () => clock,
    });
    breaker.recordFailure(host(1));
    clock += 61_000;
    breaker.recordFailure(host(2));
    clock += 61_000;
    breaker.recordFailure(host(3));
    expect(breaker.isTripped).toBe(false);
    expect(breaker.failingHosts).toEqual([host(3)]);
  });

  it('trips on a burst inside the window', () => {
    let clock = 1_000_000;
    const breaker = new ResolverCircuitBreaker({
      threshold: 3,
      windowMs: 60_000,
      now: () => clock,
    });
    breaker.recordFailure(host(1));
    clock += 500;
    breaker.recordFailure(host(2));
    clock += 500;
    expect(() => breaker.recordFailure(host(3))).toThrow(ResolverUnhealthyError);
  });

  it('defaults to a threshold above one, so a single dead host is never enough', () => {
    expect(DEFAULT_RESOLVER_BREAKER_THRESHOLD).toBeGreaterThan(1);
  });
});

describe('ResolverCircuitBreaker with a control probe (#4865)', () => {
  const healthyControl = () => Promise.resolve({ healthy: true, detail: 'control answered' });
  const failingControl = () => Promise.resolve({ healthy: false, detail: 'control: ENOTFOUND' });

  const clocked = () => {
    const state = { clock: 1_000_000, sleeps: [] as number[] };
    return {
      state,
      now: () => state.clock,
      sleep: async (ms: number) => {
        state.sleeps.push(ms);
        state.clock += ms;
      },
    };
  };

  it('does not trip on many distinct dead hosts while the control answers', async () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 3, controlProbe: healthyControl });
    for (let i = 0; i < 3; i += 1) breaker.recordFailure(host(i));
    await expect(breaker.settle()).resolves.toBeUndefined();
    expect(breaker.isTripped).toBe(false);
    expect(breaker.failingHosts).toEqual([]);
    expect(breaker.stats).toMatchObject({ controlChecks: 1, tripsAvoided: 1, trips: 0 });
  });

  it('trips when the control also fails, and stays tripped', async () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 3, controlProbe: failingControl });
    for (let i = 0; i < 3; i += 1) breaker.recordFailure(host(i));
    const settled = breaker.settle();
    await expect(settled).rejects.toBeInstanceOf(ResolverUnhealthyError);
    await expect(breaker.settle()).rejects.toThrow(/control check failed \(control: ENOTFOUND\)/);
    expect(breaker.isTripped).toBe(true);
    expect(() => breaker.recordFailure(host(9))).toThrow(ResolverUnhealthyError);
    expect(breaker.stats).toMatchObject({ controlChecks: 1, tripsAvoided: 0, trips: 1 });
  });

  it('treats a control probe that throws as a failed control', async () => {
    const breaker = new ResolverCircuitBreaker({
      threshold: 2,
      controlProbe: () => Promise.reject(new Error('synthetic')),
    });
    breaker.recordFailure(host(1));
    breaker.recordFailure(host(2));
    await expect(breaker.settle()).rejects.toBeInstanceOf(ResolverUnhealthyError);
  });

  it('asks the control at most once per window however dense the dead links are', async () => {
    const { state, now, sleep } = clocked();
    let checks = 0;
    const breaker = new ResolverCircuitBreaker({
      threshold: 3,
      windowMs: 60_000,
      now,
      sleep,
      controlProbe: async () => {
        checks += 1;
        return { healthy: true, detail: 'ok' };
      },
    });
    const startedAt = state.clock;
    const checkTimes: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      state.clock += 100;
      breaker.recordFailure(host(i));
      const before = checks;
      await breaker.settle();
      if (checks > before) checkTimes.push(state.clock);
    }
    expect(breaker.isTripped).toBe(false);
    expect(checks).toBe(10);
    expect(breaker.stats.tripsAvoided).toBe(10);
    for (let i = 1; i < checkTimes.length; i += 1) {
      expect(checkTimes[i] - checkTimes[i - 1]).toBeGreaterThanOrEqual(60_000);
    }
    expect(state.clock - startedAt).toBeLessThan(10 * 60_000 + 30 * 100 + 1);
  });

  it('shares one control check between callers waiting at the same time', async () => {
    let checks = 0;
    let release: () => void = () => undefined;
    const breaker = new ResolverCircuitBreaker({
      threshold: 2,
      controlProbe: () =>
        new Promise((resolve) => {
          checks += 1;
          release = () => resolve({ healthy: true, detail: 'ok' });
        }),
    });
    breaker.recordFailure(host(1));
    breaker.recordFailure(host(2));
    const waiting = [breaker.settle(), breaker.settle(), breaker.settle()];
    await Promise.resolve();
    release();
    await Promise.all(waiting);
    expect(checks).toBe(1);
  });

  it('still trips on an outage that starts after a passing control check', async () => {
    const { now, sleep } = clocked();
    let resolverUp = true;
    const breaker = new ResolverCircuitBreaker({
      threshold: 3,
      now,
      sleep,
      controlProbe: async () => ({ healthy: resolverUp, detail: resolverUp ? 'ok' : 'down' }),
    });
    for (let i = 0; i < 3; i += 1) breaker.recordFailure(host(i));
    await breaker.settle();
    resolverUp = false;
    for (let i = 10; i < 13; i += 1) breaker.recordFailure(host(i));
    await expect(breaker.settle()).rejects.toBeInstanceOf(ResolverUnhealthyError);
    expect(breaker.stats).toMatchObject({ controlChecks: 2, tripsAvoided: 1, trips: 1 });
  });

  it('ignores hosts the store already holds as unresolvable', async () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 2, controlProbe: failingControl });
    breaker.noteStoredHostVerdict(host(1), true);
    breaker.noteStoredHostVerdict(host(2), true);
    breaker.noteStoredHostVerdict(host(3), true);
    breaker.noteStoredHostVerdict(host(3), false);
    breaker.recordFailure(host(1));
    breaker.recordFailure(host(2));
    await breaker.settle();
    expect(breaker.isTripped).toBe(false);
    expect(breaker.stats.knownUnresolvableFailuresIgnored).toBe(2);
    breaker.recordFailure(host(3));
    breaker.recordFailure(host(4));
    await expect(breaker.settle()).rejects.toBeInstanceOf(ResolverUnhealthyError);
  });

  it('a later stored reachable verdict keeps a host counted', () => {
    const breaker = new ResolverCircuitBreaker({ threshold: 5 });
    breaker.noteStoredHostVerdict(host(1), false);
    breaker.noteStoredHostVerdict(host(1), true);
    breaker.recordFailure(host(1));
    expect(breaker.failingHosts).toEqual([host(1)]);
  });
});
