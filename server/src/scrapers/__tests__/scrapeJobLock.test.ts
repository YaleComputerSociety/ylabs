import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScrapeJobLock } from '../../models/scrapeJobLock';
import {
  DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS,
  acquireScrapeJobLock,
  heartbeatScrapeJobLock,
  releaseScrapeJobLock,
} from '../scrapeJobLock';

const NOW = new Date('2026-05-14T12:00:00Z');

describe('scrape job locks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('atomically acquires an unlocked or stale source lease', async () => {
    const lock = {
      environment: 'production',
      sourceName: 'openalex',
      ownerId: 'owner-1',
      locked: true,
    };
    const findOneAndUpdate = vi
      .spyOn(ScrapeJobLock, 'findOneAndUpdate')
      .mockResolvedValue(lock as any);
    const create = vi.spyOn(ScrapeJobLock, 'create');

    const result = await acquireScrapeJobLock({
      environment: 'production',
      sourceName: 'openalex',
      ownerId: 'owner-1',
      now: NOW,
    });

    expect(result).toEqual({
      acquired: true,
      ownerId: 'owner-1',
      lock,
    });
    expect(create).not.toHaveBeenCalled();

    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      environment: 'production',
      sourceName: 'openalex',
      $or: [
        { locked: { $ne: true } },
        { leaseExpiresAt: { $lte: NOW } },
        { leaseExpiresAt: { $exists: false } },
      ],
    });
    expect((update as any).$set).toMatchObject({
      locked: true,
      ownerId: 'owner-1',
      acquiredAt: NOW,
      heartbeatAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS),
    });
    expect((update as any).$unset).toEqual({ releasedAt: '', releaseReason: '' });
    expect(options).toMatchObject({ new: true });
  });

  it('returns lock-held when a concurrent create loses the unique-key race', async () => {
    vi.spyOn(ScrapeJobLock, 'findOneAndUpdate').mockResolvedValue(null as any);
    vi.spyOn(ScrapeJobLock, 'create').mockRejectedValue({ code: 11000 });

    const result = await acquireScrapeJobLock({
      environment: 'production',
      sourceName: 'openalex',
      ownerId: 'owner-2',
      now: NOW,
    });

    expect(result).toEqual({
      acquired: false,
      ownerId: 'owner-2',
      reason: 'lock-held',
    });
  });

  it('extends the lease only for the current lock owner', async () => {
    const updateOne = vi
      .spyOn(ScrapeJobLock, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as any);

    const result = await heartbeatScrapeJobLock({
      environment: 'production',
      sourceName: 'openalex',
      ownerId: 'owner-1',
      now: NOW,
    });

    expect(result).toEqual({ heartbeated: true });
    const [filter, update] = updateOne.mock.calls[0] as any[];
    expect(filter).toEqual({
      environment: 'production',
      sourceName: 'openalex',
      ownerId: 'owner-1',
      locked: true,
    });
    expect((update as any).$set).toEqual({
      heartbeatAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS),
    });
  });

  it('releases the current owner and records the last run id', async () => {
    const updateOne = vi
      .spyOn(ScrapeJobLock, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as any);

    const result = await releaseScrapeJobLock({
      environment: 'production',
      sourceName: 'openalex',
      ownerId: 'owner-1',
      releaseReason: 'success',
      lastRunId: 'run-1',
      now: NOW,
    });

    expect(result).toEqual({ released: true });
    const [filter, update] = updateOne.mock.calls[0] as any[];
    expect(filter).toEqual({
      environment: 'production',
      sourceName: 'openalex',
      ownerId: 'owner-1',
      locked: true,
    });
    expect(update).toEqual({
      $set: {
        locked: false,
        releasedAt: NOW,
        releaseReason: 'success',
        lastRunId: 'run-1',
      },
      $unset: {
        ownerId: '',
        leaseExpiresAt: '',
      },
    });
  });
});
