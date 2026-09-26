import { afterEach, describe, expect, it, vi } from 'vitest';
import { forEachInOrderWithPrefetch } from '../boundedConcurrency';
import { HostConcurrencyLimiter, withHostSlot } from '../hostConcurrencyLimiter';

afterEach(() => {
  vi.useRealTimers();
});

describe('forEachInOrderWithPrefetch', () => {
  it('consumes in input order however the fetches finish, and never runs past the lookahead', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const consumed: number[] = [];
    await forEachInOrderWithPrefetch(
      [30, 1, 20, 1, 10, 1],
      3,
      async (delay) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, delay));
        inFlight -= 1;
        return delay;
      },
      async (item, result) => {
        expect(result).toEqual({ status: 'fulfilled', value: item });
        consumed.push(item);
      },
    );
    expect(consumed).toEqual([30, 1, 20, 1, 10, 1]);
    expect(maxInFlight).toBe(3);
  });

  it('hands a rejected fetch to the consumer instead of aborting the walk', async () => {
    const outcomes: string[] = [];
    await forEachInOrderWithPrefetch(
      ['ok', 'bad', 'ok'],
      2,
      async (item) => {
        if (item === 'bad') throw new Error('403');
        return item;
      },
      async (_item, result) => {
        outcomes.push(result.status);
      },
    );
    expect(outcomes).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});

describe('YSM profile walk timing model on medicine.yale.edu (#3568)', () => {
  const PROFILES = 1000;
  const latencyMs = (index: number) => (index % 10 < 8 ? 250 : 2340);

  async function simulate(lookahead: number) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const limiter = new HostConcurrencyLimiter(4);
    const grants: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const startedAt = Date.now();
    const walk = forEachInOrderWithPrefetch(
      Array.from({ length: PROFILES }, (_, index) => index),
      lookahead,
      (index) =>
        withHostSlot(
          'https://medicine.yale.edu/profile/x/',
          async () => {
            grants.push(Date.now());
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, latencyMs(index)));
            inFlight -= 1;
          },
          limiter,
        ),
      async () => {},
    );
    await vi.runAllTimersAsync();
    await walk;
    const minGapMs = Math.min(...grants.slice(1).map((at, index) => at - grants[index]));
    return { elapsedMs: Date.now() - startedAt, maxInFlight, minGapMs };
  }

  it('cuts the fetch time by about 30 percent while holding the host to its override of 2 in flight and 400 ms spacing', async () => {
    const serial = await simulate(1);
    vi.useRealTimers();
    const prefetched = await simulate(4);

    expect(serial.maxInFlight).toBe(1);
    expect(prefetched.maxInFlight).toBe(2);
    expect(prefetched.minGapMs).toBeGreaterThanOrEqual(400);
    expect(serial.elapsedMs).toBe(PROFILES * (0.8 * 400 + 0.2 * 2340));
    const speedUp = serial.elapsedMs / prefetched.elapsedMs;
    expect(speedUp).toBeGreaterThan(1.4);
    expect(speedUp).toBeLessThan(1.5);
    expect(prefetched.elapsedMs).toBeGreaterThanOrEqual(PROFILES * 400);
  });
});
