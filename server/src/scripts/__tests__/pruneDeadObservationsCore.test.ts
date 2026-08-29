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

  it('rejects unknown arguments', () => {
    expect(() => parsePruneDeadObservationsArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('never gates a dry run', () => {
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: false, confirm: false, dropSnapshotCache: false },
        'cluster/Production',
      ),
    ).not.toThrow();
  });

  it('requires the confirm flag and blocks a production target on apply', () => {
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: true, confirm: false, dropSnapshotCache: false },
        'cluster/Development',
      ),
    ).toThrow(/confirm-prune-dead-observations/);
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: true, confirm: true, dropSnapshotCache: false },
        'cluster/Production',
      ),
    ).toThrow(/production/i);
    expect(() =>
      assertPruneDeadObservationsApplyAllowed(
        { apply: true, confirm: true, dropSnapshotCache: false },
        'cluster/Development',
      ),
    ).not.toThrow();
  });
});
