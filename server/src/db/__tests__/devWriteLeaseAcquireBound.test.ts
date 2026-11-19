import type { Db } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS, acquireDevWriteLease } from '../devWriteLease';

const neverAnswers = () => new Promise<never>(() => {});

const silentDatabase = (): Db =>
  ({
    collection: () => ({
      findOne: neverAnswers,
      insertOne: neverAnswers,
      updateOne: neverAnswers,
    }),
  }) as unknown as Db;

describe('a lease acquire whose database never answers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects once the acquire bound passes instead of holding the fetch that asked for it', async () => {
    const attempt = acquireDevWriteLease(
      { name: 'host:fixture.example.edu', command: 'scrape run --source fixture' },
      { db: silentDatabase(), env: {}, host: 'fixture-host', pid: 4242 },
    );
    const settled = attempt.then(
      () => 'acquired',
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS);
    await expect(settled).resolves.toMatch(/timed out after/);
  });
});
