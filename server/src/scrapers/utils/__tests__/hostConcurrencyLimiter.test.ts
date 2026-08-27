import { describe, expect, it } from 'vitest';
import {
  HostConcurrencyLimiter,
  hostnameForLimiter,
  resolvePerHostConcurrency,
  withHostSlot,
} from '../hostConcurrencyLimiter';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('resolvePerHostConcurrency', () => {
  it('reads a positive integer from the env', () => {
    expect(resolvePerHostConcurrency({ SCRAPER_PER_HOST_CONCURRENCY: '6' } as NodeJS.ProcessEnv)).toBe(6);
  });
  it('falls back to the default on missing/invalid values', () => {
    expect(resolvePerHostConcurrency({} as NodeJS.ProcessEnv)).toBe(4);
    expect(resolvePerHostConcurrency({ SCRAPER_PER_HOST_CONCURRENCY: 'x' } as NodeJS.ProcessEnv)).toBe(4);
    expect(resolvePerHostConcurrency({ SCRAPER_PER_HOST_CONCURRENCY: '0' } as NodeJS.ProcessEnv)).toBe(4);
  });
});

describe('hostnameForLimiter', () => {
  it('extracts a lowercased hostname', () => {
    expect(hostnameForLimiter('https://Medicine.Yale.EDU/lab/x')).toBe('medicine.yale.edu');
  });
  it('returns undefined for non-parseable or empty input', () => {
    expect(hostnameForLimiter('')).toBeUndefined();
    expect(hostnameForLimiter(undefined)).toBeUndefined();
    expect(hostnameForLimiter('not a url')).toBeUndefined();
  });
});

describe('HostConcurrencyLimiter', () => {
  it('never lets more than cap run concurrently for one host', async () => {
    const limiter = new HostConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 8 }, () =>
      withHostSlot(
        'https://host.example/x',
        async () => {
          active += 1;
          peak = Math.max(peak, active);
          await tick();
          active -= 1;
        },
        limiter,
      ),
    );
    await Promise.all(jobs);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it('tracks separate budgets per host', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const releaseA = await limiter.acquire('a');
    const releaseB = await limiter.acquire('b');
    expect(limiter.activeCount('a')).toBe(1);
    expect(limiter.activeCount('b')).toBe(1);
    releaseA();
    releaseB();
    expect(limiter.activeCount('a')).toBe(0);
    expect(limiter.activeCount('b')).toBe(0);
  });

  it('grants a waiting acquirer when a slot is released', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const first = await limiter.acquire('h');
    let secondGranted = false;
    const second = limiter.acquire('h').then((release) => {
      secondGranted = true;
      return release;
    });
    await tick();
    expect(secondGranted).toBe(false);
    first();
    const release = await second;
    expect(secondGranted).toBe(true);
    release();
  });

  it('releases the slot even when the work throws', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    await expect(
      withHostSlot('https://host.example/y', async () => {
        throw new Error('boom');
      }, limiter),
    ).rejects.toThrow('boom');
    expect(limiter.activeCount('host.example')).toBe(0);
    const release = await limiter.acquire('host.example');
    expect(limiter.activeCount('host.example')).toBe(1);
    release();
  });

  it('is idempotent on double release', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const release = await limiter.acquire('h');
    release();
    release();
    expect(limiter.activeCount('h')).toBe(0);
  });

  it('runs work directly when the url has no parseable host', async () => {
    const limiter = new HostConcurrencyLimiter(1);
    const result = await withHostSlot('not-a-url', async () => 'ok', limiter);
    expect(result).toBe('ok');
  });
});
