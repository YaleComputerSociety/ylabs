import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { SCRAPE_RUN_STALE_HEARTBEAT_MS } from '../scrapeRunLiveness';
import {
  installAxiosScrapeRunProgress,
  lastScrapeRunProgressAtMs,
  recordScrapeRunProgress,
  resolveScrapeRunStallWindowMs,
  SCRAPE_RUN_SOCKET_TIMEOUT_MS,
  SCRAPE_RUN_STALL_WINDOW_ENV,
  SCRAPE_RUN_STALL_WINDOW_MS,
  withScrapeRunProgress,
} from '../scrapeRunProgress';

describe('scrape run progress (#5086)', () => {
  it('keeps the stall window above the stale bound and the socket timeout below it', () => {
    expect(SCRAPE_RUN_STALL_WINDOW_MS).toBeGreaterThan(SCRAPE_RUN_STALE_HEARTBEAT_MS);
    expect(SCRAPE_RUN_SOCKET_TIMEOUT_MS).toBeLessThan(SCRAPE_RUN_STALL_WINDOW_MS);
  });

  it('reads an override from the environment and ignores one that is not a positive integer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveScrapeRunStallWindowMs({})).toBe(SCRAPE_RUN_STALL_WINDOW_MS);
    expect(resolveScrapeRunStallWindowMs({ [SCRAPE_RUN_STALL_WINDOW_ENV]: '1800000' })).toBe(
      1_800_000,
    );
    for (const raw of ['0', '-5', '12.5', 'twenty']) {
      expect(resolveScrapeRunStallWindowMs({ [SCRAPE_RUN_STALL_WINDOW_ENV]: raw })).toBe(
        SCRAPE_RUN_STALL_WINDOW_MS,
      );
    }
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('counts settled work as progress whether it resolved or failed', async () => {
    recordScrapeRunProgress(0);
    await withScrapeRunProgress(async () => 'page');
    expect(lastScrapeRunProgressAtMs()).toBeGreaterThan(0);

    recordScrapeRunProgress(0);
    await expect(
      withScrapeRunProgress(async () => {
        throw new Error('fixture failure');
      }),
    ).rejects.toThrow('fixture failure');
    expect(lastScrapeRunProgressAtMs()).toBeGreaterThan(0);
  });

  it('counts every settled axios request as progress once installed', async () => {
    installAxiosScrapeRunProgress();
    installAxiosScrapeRunProgress();
    const respond = vi.fn(async (config) => ({
      data: 'ok',
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }));

    recordScrapeRunProgress(0);
    await axios.get('https://example.test/page', { adapter: respond });
    expect(lastScrapeRunProgressAtMs()).toBeGreaterThan(0);

    recordScrapeRunProgress(0);
    await expect(
      axios.get('https://example.test/page', {
        adapter: async () => {
          throw new Error('fixture network failure');
        },
      }),
    ).rejects.toThrow('fixture network failure');
    expect(lastScrapeRunProgressAtMs()).toBeGreaterThan(0);
  });
});
