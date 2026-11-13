import { describe, expect, it } from 'vitest';

import {
  HostConcurrencyLimiter,
  HostSlotWaitTimeoutError,
  acquireHostSlotWithin,
} from '../hostConcurrencyLimiter';

const HOST = 'slots-fixture.example.edu';

describe('a host slot wait with a bound', () => {
  it('fails with a slot-wait timeout when the only slot is never released', async () => {
    const limiter = new HostConcurrencyLimiter(1, { applyHostOverrides: false });
    const held = await limiter.acquire(HOST);
    await expect(acquireHostSlotWithin(limiter, HOST, 50)).rejects.toBeInstanceOf(
      HostSlotWaitTimeoutError,
    );
    held();
  });

  it('releases a slot granted after the wait gave up, so the late grant never leaks', async () => {
    const limiter = new HostConcurrencyLimiter(1, { applyHostOverrides: false });
    const held = await limiter.acquire(HOST);
    await expect(acquireHostSlotWithin(limiter, HOST, 20)).rejects.toBeInstanceOf(
      HostSlotWaitTimeoutError,
    );
    held();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(limiter.activeCount(HOST)).toBe(0);
    const next = await acquireHostSlotWithin(limiter, HOST, 50);
    expect(limiter.activeCount(HOST)).toBe(1);
    next();
  });
});
