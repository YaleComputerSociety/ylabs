import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyScrapeRunLiveness,
  isLocalProcessAlive,
  liveScrapeRunFilter,
  SCRAPE_RUN_STALE_HEARTBEAT_MS,
  startScrapeRunHeartbeat,
} from '../scrapeRunLiveness';

const NOW = new Date('2026-09-27T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('classifyScrapeRunLiveness (#3595)', () => {
  it('calls a terminal run finished whatever its heartbeat says', () => {
    for (const status of ['success', 'failure', 'partial', 'interrupted', 'completed']) {
      expect(classifyScrapeRunLiveness({ status, heartbeatAt: NOW }, NOW)).toBe('finished');
    }
  });

  it('calls a running row live only while its heartbeat is inside the bound', () => {
    expect(classifyScrapeRunLiveness({ status: 'running', heartbeatAt: ago(60_000) }, NOW)).toBe(
      'live',
    );
    expect(
      classifyScrapeRunLiveness(
        { status: 'running', heartbeatAt: ago(SCRAPE_RUN_STALE_HEARTBEAT_MS) },
        NOW,
      ),
    ).toBe('live');
    expect(
      classifyScrapeRunLiveness(
        { status: 'running', heartbeatAt: ago(SCRAPE_RUN_STALE_HEARTBEAT_MS + 1) },
        NOW,
      ),
    ).toBe('stale');
  });

  it('refuses to call a running row that predates heartbeats live', () => {
    expect(classifyScrapeRunLiveness({ status: 'running', startedAt: ago(1_000) }, NOW)).toBe(
      'unverifiable',
    );
  });

  it('builds a query that matches only running rows with a fresh heartbeat', () => {
    expect(liveScrapeRunFilter(NOW)).toEqual({
      status: 'running',
      heartbeatAt: { $gt: ago(SCRAPE_RUN_STALE_HEARTBEAT_MS) },
    });
  });

  it('sees this process as alive and an unused pid as gone', () => {
    expect(isLocalProcessAlive(process.pid)).toBe(true);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    expect(isLocalProcessAlive(999_999)).toBe(false);
    kill.mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    });
    expect(isLocalProcessAlive(1)).toBe(true);
    kill.mockRestore();
  });
});

describe('startScrapeRunHeartbeat (#3595)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('beats on every interval until stopped', async () => {
    vi.useFakeTimers();
    const beat = vi.fn().mockResolvedValue({ matched: true });
    const heartbeat = startScrapeRunHeartbeat(
      { runId: 'run-1', sourceName: 'fixture-source', intervalMs: 100 },
      { beat },
    );

    await vi.advanceTimersByTimeAsync(350);
    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(beat).toHaveBeenCalledTimes(3);
    expect(beat.mock.calls[0]).toEqual(['run-1', expect.any(Date)]);
  });

  it('reports once when the row was closed by something else', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heartbeat = startScrapeRunHeartbeat(
      { runId: 'run-1', sourceName: 'fixture-source', intervalMs: 100 },
      { beat: vi.fn().mockResolvedValue({ matched: false }) },
    );

    await vi.advanceTimersByTimeAsync(350);
    heartbeat.stop();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toContain('fixture-source');
  });

  it('logs a failed beat and keeps beating', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const beat = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValue({ matched: true });
    const heartbeat = startScrapeRunHeartbeat(
      { runId: 'run-1', sourceName: 'fixture-source', intervalMs: 100 },
      { beat },
    );

    await vi.advanceTimersByTimeAsync(250);
    heartbeat.stop();

    expect(beat).toHaveBeenCalledTimes(2);
    expect(consoleError.mock.calls.flat().join(' ')).toContain('socket closed');
  });
});
