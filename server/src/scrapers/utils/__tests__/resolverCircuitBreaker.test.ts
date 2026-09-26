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
