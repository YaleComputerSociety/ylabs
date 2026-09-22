import { describe, expect, it } from 'vitest';
import {
  BACKFILL_PROVENANCE_OBSERVATION_ID_CONFIRM_FLAG,
  assertBackfillProvenanceObservationIdApplyAllowed,
  emptyProvenanceRepairTally,
  parseBackfillProvenanceObservationIdArgs,
  planProvenanceRepair,
} from '../backfillFieldProvenanceObservationIdCore';

describe('planProvenanceRepair', () => {
  it('moves a mis-keyed observation id and re-points sourceId at the real source', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'obs-1' },
      { isObservation: true, isSource: false, observationSourceId: 'src-1' },
    );
    expect(plan.outcome).toBe('repaired');
    expect(plan.set).toEqual({ observationId: 'obs-1', sourceId: 'src-1' });
    expect(plan.unsetSourceId).toBeUndefined();
  });

  it('clears sourceId when the observation records no source of its own', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'obs-2' },
      { isObservation: true, isSource: false },
    );
    expect(plan.outcome).toBe('repaired_source_unknown');
    expect(plan.set).toEqual({ observationId: 'obs-2' });
    expect(plan.unsetSourceId).toBe(true);
  });

  it('is a no-op on re-run because it keys on the stored observationId', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'src-1', observationId: 'obs-1' },
      { isObservation: true, isSource: false, observationSourceId: 'src-1' },
    );
    expect(plan.outcome).toBe('already_correct');
    expect(plan.set).toBeUndefined();
  });

  it('leaves a sourceId that really is a Source alone', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'src-9' },
      { isObservation: false, isSource: true },
    );
    expect(plan.outcome).toBe('source_id_is_a_source');
    expect(plan.set).toBeUndefined();
  });

  it('reports rather than moves a reference that resolves in neither collection', () => {
    expect(planProvenanceRepair({ sourceId: 'gone' }, null).outcome).toBe(
      'dangling_observation_id',
    );
    expect(
      planProvenanceRepair({ sourceId: 'gone' }, { isObservation: false, isSource: false }).outcome,
    ).toBe('dangling_observation_id');
  });

  it('separates an entry carrying no ids from one needing repair', () => {
    expect(planProvenanceRepair({}, null).outcome).toBe('no_ids');
  });
});

describe('parseBackfillProvenanceObservationIdArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseBackfillProvenanceObservationIdArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.limit).toBe(0);
  });

  it('parses apply, confirm, limit and output', () => {
    const args = parseBackfillProvenanceObservationIdArgs([
      '--apply',
      BACKFILL_PROVENANCE_OBSERVATION_ID_CONFIRM_FLAG,
      '--limit',
      '25',
      '--output=/tmp/report.json',
    ]);
    expect(args).toEqual({
      apply: true,
      confirm: true,
      limit: 25,
      output: '/tmp/report.json',
    });
  });

  it('rejects an unknown argument and a negative limit', () => {
    expect(() => parseBackfillProvenanceObservationIdArgs(['--nope'])).toThrow(/Unknown/);
    expect(() => parseBackfillProvenanceObservationIdArgs(['--limit=-1'])).toThrow(/--limit/);
  });
});

describe('assertBackfillProvenanceObservationIdApplyAllowed', () => {
  const args = { apply: true, confirm: true, limit: 0 };

  it('permits a confirmed apply against development', () => {
    expect(() =>
      assertBackfillProvenanceObservationIdApplyAllowed(args, 'cluster/Development', 'development'),
    ).not.toThrow();
  });

  it('requires the confirm flag', () => {
    expect(() =>
      assertBackfillProvenanceObservationIdApplyAllowed(
        { ...args, confirm: false },
        'cluster/Development',
        'development',
      ),
    ).toThrow(BACKFILL_PROVENANCE_OBSERVATION_ID_CONFIRM_FLAG);
  });

  it('blocks production by environment and by database label', () => {
    expect(() =>
      assertBackfillProvenanceObservationIdApplyAllowed(args, 'cluster/Development', 'production'),
    ).toThrow(/blocked against a production database/);
    expect(() =>
      assertBackfillProvenanceObservationIdApplyAllowed(args, 'cluster/Prod', 'development'),
    ).toThrow(/blocked against a production database/);
  });

  it('never blocks a dry run', () => {
    expect(() =>
      assertBackfillProvenanceObservationIdApplyAllowed(
        { apply: false, confirm: false, limit: 0 },
        'cluster/Prod',
        'production',
      ),
    ).not.toThrow();
  });
});

describe('emptyProvenanceRepairTally', () => {
  it('starts every outcome at zero so a dry run reports all arms', () => {
    expect(emptyProvenanceRepairTally()).toEqual({
      repaired: 0,
      repaired_source_unknown: 0,
      already_correct: 0,
      source_id_is_a_source: 0,
      dangling_observation_id: 0,
      no_ids: 0,
    });
  });
});
