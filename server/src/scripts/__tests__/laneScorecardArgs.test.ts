import { describe, expect, it } from 'vitest';
import { CONFIRM_FLAG, parseLaneScorecardArgs } from '../laneScorecard';

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
