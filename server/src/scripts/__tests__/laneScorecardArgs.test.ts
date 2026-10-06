import { describe, expect, it } from 'vitest';
import { CONFIRM_FLAG, parseLaneScorecardArgs, emptyReplayReason } from '../laneScorecard';
import { benchmarksToReplay } from '../laneScorecardCore';

describe('parseLaneScorecardArgs', () => {
  it('defaults a live-model run to three runs and stays a dry run', () => {
    expect(parseLaneScorecardArgs(['--live-model'])).toMatchObject({
      dryRun: true,
      liveModelRuns: 3,
    });
  });

  it('reads the run count', () => {
    expect(parseLaneScorecardArgs(['--live-model', '--runs=5']).liveModelRuns).toBe(5);
  });

  it('refuses a single run, which has no band', () => {
    expect(() => parseLaneScorecardArgs(['--live-model', '--runs=1'])).toThrow(/2 or more/);
  });

  it('refuses to store a live-model run', () => {
    expect(() => parseLaneScorecardArgs(['--live-model', '--apply', CONFIRM_FLAG])).toThrow(
      /never stores a row/,
    );
  });

  it('leaves an ordinary replay without a live-model run count', () => {
    expect(parseLaneScorecardArgs(['--apply', CONFIRM_FLAG]).liveModelRuns).toBeUndefined();
  });
});

describe('emptyReplayReason', () => {
  it('refuses a replay that planned nothing where the capture planned values', () => {
    expect(
      emptyReplayReason({ plannedObservationCount: 40 }, { emitted: 0, refusedAtIngest: 0 }),
    ).toMatch(/planned no values where the capture planned 40/);
  });

  it('scores a replay that planned something, even if only refused-at-ingest values', () => {
    expect(
      emptyReplayReason({ plannedObservationCount: 40 }, { emitted: 0, refusedAtIngest: 2 }),
    ).toBeUndefined();
    expect(
      emptyReplayReason({ plannedObservationCount: 40 }, { emitted: 3, refusedAtIngest: 0 }),
    ).toBeUndefined();
  });

  it('scores an empty replay of an empty capture', () => {
    expect(
      emptyReplayReason({ plannedObservationCount: 0 }, { emitted: 0, refusedAtIngest: 0 }),
    ).toBeUndefined();
  });
});

describe('benchmarksToReplay', () => {
  const benchmarks = [
    { benchmarkId: 'lane-a-v1' },
    { benchmarkId: 'lane-a-v2', supersedes: 'lane-a-v1' },
    { benchmarkId: 'lane-a-v3', supersedes: 'lane-a-v2' },
    { benchmarkId: 'lane-b-v1' },
  ];

  it('replays only the newest benchmark of each recapture chain and lists the rest', () => {
    const { replay, superseded } = benchmarksToReplay(benchmarks);
    expect(replay.map((b) => b.benchmarkId)).toEqual(['lane-a-v3', 'lane-b-v1']);
    expect(superseded).toEqual([
      { benchmarkId: 'lane-a-v1', supersededBy: 'lane-a-v2' },
      { benchmarkId: 'lane-a-v2', supersededBy: 'lane-a-v3' },
    ]);
  });

  it('still replays a superseded benchmark that is named explicitly', () => {
    const { replay, superseded } = benchmarksToReplay(benchmarks, 'lane-a-v1');
    expect(replay.map((b) => b.benchmarkId)).toEqual(['lane-a-v1']);
    expect(superseded).toEqual([]);
  });
});
