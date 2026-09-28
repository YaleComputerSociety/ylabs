import { describe, expect, it, vi } from 'vitest';
import { BenchmarkReplayNetworkError } from '../../scrapers/snapshotBenchmarkMode';

const runLaneDry = vi.fn();

vi.mock('../laneBenchmarkRun', () => ({
  currentCodeSha: () => 'test-sha',
  runClockFieldsFor: () => new Set<string>(),
  runLaneDry: (...args: unknown[]) => runLaneDry(...args),
  slugsForPlannedEntities: async () => new Map<string, string>(),
}));

const { replayBenchmark } = await import('../laneScorecard');

const benchmark = { benchmarkId: 'synthetic-rendered', sourceName: 'student-grants-database' };

describe('replayBenchmark', () => {
  it('reports a render the capture never froze as a refusal instead of throwing', async () => {
    runLaneDry.mockRejectedValueOnce(new BenchmarkReplayNetworkError());

    const replayed = await replayBenchmark(benchmark, []);

    expect(replayed.refusedReason).toMatch(/never froze/);
  });

  it('still throws a lane failure that is not a replay refusal', async () => {
    runLaneDry.mockRejectedValueOnce(new Error('lane bug'));

    await expect(replayBenchmark(benchmark, [])).rejects.toThrow('lane bug');
  });

  it('scores the next benchmark after a refused one', async () => {
    runLaneDry.mockRejectedValueOnce(new BenchmarkReplayNetworkError());
    runLaneDry.mockResolvedValueOnce({ observations: [], truncated: false });

    await replayBenchmark(benchmark, []);
    const replayed = await replayBenchmark(benchmark, []);

    expect(replayed.refusedReason).toBeUndefined();
    expect(replayed.score).toBeDefined();
  });
});
