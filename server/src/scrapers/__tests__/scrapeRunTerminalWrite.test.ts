import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCRAPE_RUN_TERMINAL_WRITE_BACKOFF_MS,
  ScrapeRunTerminalWriteError,
  writeScrapeRunTerminalStatus,
} from '../scrapeRunTerminalWrite';

describe('writeScrapeRunTerminalStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes once when the first attempt succeeds', async () => {
    const write = vi.fn().mockResolvedValue('written');

    await expect(
      writeScrapeRunTerminalStatus(write, { status: 'success', sourceName: 'fixture-source' }),
    ).resolves.toBe('written');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('backs off between attempts and returns the first successful write', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValue('written');

    const pending = writeScrapeRunTerminalStatus(write, {
      status: 'partial',
      sourceName: 'fixture-source',
    });
    await vi.advanceTimersByTimeAsync(SCRAPE_RUN_TERMINAL_WRITE_BACKOFF_MS[0] - 1);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SCRAPE_RUN_TERMINAL_WRITE_BACKOFF_MS[1]);

    await expect(pending).resolves.toBe('written');
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('stops after the bounded attempts and names the last error', async () => {
    const write = vi.fn().mockRejectedValue(new Error('still down'));

    const pending = expect(
      writeScrapeRunTerminalStatus(write, { status: 'failure', sourceName: 'fixture-source' }),
    ).rejects.toMatchObject({
      name: 'ScrapeRunTerminalWriteError',
      status: 'failure',
      attempts: SCRAPE_RUN_TERMINAL_WRITE_BACKOFF_MS.length + 1,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(write).toHaveBeenCalledTimes(SCRAPE_RUN_TERMINAL_WRITE_BACKOFF_MS.length + 1);
    expect(String((console.error as any).mock.calls[0][0])).toContain('still down');
  });

  it('does not start a retry whose backoff would pass the deadline', async () => {
    const write = vi.fn().mockRejectedValue(new Error('still down'));

    const pending = expect(
      writeScrapeRunTerminalStatus(write, {
        status: 'interrupted',
        sourceName: 'fixture-source',
        backoffMs: [500, 5_000],
        deadlineMs: 2_000,
      }),
    ).rejects.toBeInstanceOf(ScrapeRunTerminalWriteError);
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('abandons a hung attempt at the deadline without retrying it', async () => {
    const write = vi.fn(() => new Promise<never>(() => undefined));

    let settledAt: number | undefined;
    const pending = writeScrapeRunTerminalStatus(write, {
      status: 'interrupted',
      sourceName: 'fixture-source',
      deadlineMs: 3_000,
    }).catch((error) => {
      settledAt = Date.now();
      return error;
    });
    const started = Date.now();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(await pending).toBeInstanceOf(ScrapeRunTerminalWriteError);
    expect(settledAt! - started).toBe(3_000);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
