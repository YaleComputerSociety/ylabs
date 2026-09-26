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
      { sourceId: 'obs-1', sourceName: 's', sourceUrl: 'u', observedAt: 'when', confidence: 0.8 },
      { isObservation: true, isSource: false, observationSourceId: 'src-1' },
    );
    expect(plan.outcome).toBe('repaired');
    expect(plan.entry).toEqual({
      sourceId: 'src-1',
      sourceName: 's',
      sourceUrl: 'u',
      observationId: 'obs-1',
      observedAt: 'when',
      confidence: 0.8,
    });
  });

  it('emits keys in fieldProvenanceSchema order so a re-projection stays a no-op', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'obs-1', sourceName: 's', sourceUrl: 'u', observedAt: 'when', confidence: 0.8 },
      { isObservation: true, isSource: false, observationSourceId: 'src-1' },
    );
    expect(Object.keys(plan.entry ?? {})).toEqual([
      'sourceId',
      'sourceName',
      'sourceUrl',
      'observationId',
      'observedAt',
      'confidence',
    ]);
  });

  it('drops sourceId when the observation records no source of its own', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'obs-2', sourceName: 's' },
      { isObservation: true, isSource: false },
    );
    expect(plan.outcome).toBe('repaired_source_unknown');
    expect(plan.entry).toEqual({ sourceName: 's', observationId: 'obs-2' });
    expect(plan.entry).not.toHaveProperty('sourceId');
  });

  it('is a no-op on re-run because it keys on the stored observationId', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'src-1', sourceName: 's', observationId: 'obs-1', confidence: 0.8 },
      { isObservation: true, isSource: false, observationSourceId: 'src-1' },
    );
    expect(plan.outcome).toBe('already_correct');
    expect(plan.entry).toBeUndefined();
  });

  it('rewrites an entry whose observationId was appended out of schema order', () => {
    const appended: Record<string, unknown> = {
      sourceId: 'src-1',
      sourceName: 's',
      confidence: 0.8,
      observationId: 'obs-1',
    };
    const plan = planProvenanceRepair(appended, null);
    expect(plan.outcome).toBe('reordered');
    expect(Object.keys(plan.entry ?? {})).toEqual([
      'sourceId',
      'sourceName',
      'observationId',
      'confidence',
    ]);
    expect(plan.entry?.observationId).toBe('obs-1');
    expect(plan.entry?.sourceId).toBe('src-1');
  });

  it('leaves a sourceId that really is a Source alone', () => {
    const plan = planProvenanceRepair(
      { sourceId: 'src-9' },
      { isObservation: false, isSource: true },
    );
    expect(plan.outcome).toBe('source_id_is_a_source');
    expect(plan.entry).toBeUndefined();
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
      reordered: 0,
      already_correct: 0,
      source_id_is_a_source: 0,
      dangling_observation_id: 0,
      no_ids: 0,
    });
  });
});
