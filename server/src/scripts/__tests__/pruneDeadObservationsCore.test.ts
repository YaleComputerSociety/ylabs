import { describe, expect, it } from 'vitest';
import {
  assertPruneDeadObservationsApplyAllowed,
  parsePruneDeadObservationsArgs,
} from '../pruneDeadObservationsCore';

describe('prune dead observations core', () => {
  it('defaults to a dry run and parses apply, confirm, snapshot-drop, source, and output', () => {
    expect(parsePruneDeadObservationsArgs([])).toEqual({
      apply: false,
      confirm: false,
      dropSnapshotCache: false,
    });
    expect(
      parsePruneDeadObservationsArgs([
        '--apply',
        '--confirm-prune-dead-observations',
        '--drop-snapshot-cache',
        '--source=openalex',
        '--output=/tmp/prune.json',
      ]),
    ).toEqual({
      apply: true,
      confirm: true,
      dropSnapshotCache: true,
      sourceName: 'openalex',
      output: '/tmp/prune.json',
    });
  });

  it('parses an explicit run-retention override and rejects a negative one', () => {
    expect(parsePruneDeadObservationsArgs(['--keep-runs=0']).keepRuns).toBe(0);
    expect(parsePruneDeadObservationsArgs(['--keep-runs', '5']).keepRuns).toBe(5);
    expect(() => parsePruneDeadObservationsArgs(['--keep-runs=-1'])).toThrow(/keep-runs/);
    expect(() => parsePruneDeadObservationsArgs(['--keep-runs=two'])).toThrow(/keep-runs/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parsePruneDeadObservationsArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('never gates a dry run', () => {
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: false, confirm: false, dropSnapshotCache: false },
        'cluster/Production',
        'production',
      ),
    ).not.toThrow();
  });

  it('requires the confirm flag and blocks a production target on apply', () => {
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: true, confirm: false, dropSnapshotCache: false },
        'cluster/Development',
        'development',
      ),
    ).toThrow(/confirm-prune-dead-observations/);
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: true, confirm: true, dropSnapshotCache: false },
        'cluster/Production',
        'development',
      ),
    ).toThrow(/production/i);
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: true, confirm: true, dropSnapshotCache: false },
        'cluster/Development',
        'development',
      ),
    ).not.toThrow();
  });

  it('blocks a production environment even when the database label looks non-production', () => {
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: true, confirm: true, dropSnapshotCache: false },
        'cluster/YaleResearch',
        'production',
      ),
    ).toThrow(/production/i);
  });
});
