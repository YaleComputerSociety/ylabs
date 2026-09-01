import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../mapWithConcurrency';

const deferred = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('resolveSourceConcurrency', () => {
  it('uses the fallback when nothing is requested', () => {
    expect(resolveSourceConcurrency(undefined, 5)).toBe(5);
  });

  it('honors a valid request and floors fractional values', () => {
    expect(resolveSourceConcurrency(8, 5)).toBe(8);
    expect(resolveSourceConcurrency(3.9, 5)).toBe(3);
  });

  it('falls back when the request is invalid', () => {
    expect(resolveSourceConcurrency(0, 5)).toBe(5);
    expect(resolveSourceConcurrency(-4, 5)).toBe(5);
    expect(resolveSourceConcurrency(Number.NaN, 5)).toBe(5);
  });

  it('never drops below 1 even if the fallback is invalid', () => {
    expect(resolveSourceConcurrency(0, 0)).toBe(1);
    expect(resolveSourceConcurrency(Number.NaN, -2)).toBe(1);
  });
});

describe('mapWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const items = Array.from({ length: 50 }, (_, index) => index);
    const seen: number[] = [];
    await mapWithConcurrency(items, 6, async (item) => {
      seen.push(item);
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
    expect(seen).toHaveLength(50);
  });

  it('never exceeds the requested concurrency', async () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(items, 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await deferred(2);
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('runs faster than serial for io-bound work', async () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    const serialStart = Date.now();
    await mapWithConcurrency(items, 1, async () => {
      await deferred(10);
    });
    const serialMs = Date.now() - serialStart;
    const parallelStart = Date.now();
    await mapWithConcurrency(items, 6, async () => {
      await deferred(10);
    });
    const parallelMs = Date.now() - parallelStart;
    expect(parallelMs).toBeLessThan(serialMs);
  });

  it('is a no-op for an empty list', async () => {
    let calls = 0;
    await mapWithConcurrency([], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it('exposes a sane default concurrency', () => {
    expect(DEFAULT_SOURCE_CONCURRENCY).toBeGreaterThanOrEqual(2);
  });
});
