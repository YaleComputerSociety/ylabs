import { describe, expect, it } from 'vitest';
import {
  canonicalFingerprint,
  planObservationFingerprintNormalization,
  selectRetainedObservation,
  type NormalizableObservation,
} from '../observationFingerprintNormalization';

const GOOD_PROSE =
  'The Horsley Lab investigates the cellular and molecular mechanisms that govern tissue biology, skin stem cells, and immune signaling in regeneration.';
const DEGRADED_PROSE = 'Interested in joining our lab?';

const row = (overrides: Partial<NormalizableObservation>): NormalizableObservation => ({
  _id: 'row',
  sourceName: 'lab-microsite-description-llm',
  entityType: 'researchEntity',
  entityKey: 'dept-mcdb-horsley',
  field: 'fullDescription',
  value: GOOD_PROSE,
  observedAt: new Date('2026-05-22T00:00:00.000Z'),
  superseded: false,
  ...overrides,
});

describe('canonicalFingerprint', () => {
  it('collapses the legacy key-only row and the id-bearing row onto one fingerprint', () => {
    const legacy = canonicalFingerprint(row({ _id: 'a' }));
    const resolved = canonicalFingerprint(
      row({ _id: 'b', entityId: '6a0fa8959fc810ec168cdcfd', value: DEGRADED_PROSE }),
    );

    expect(legacy).toBe(resolved);
  });
});

describe('selectRetainedObservation', () => {
  it('keeps good prose active instead of the newer regression', () => {
    const good = row({ _id: 'good', value: GOOD_PROSE });
    const regression = row({
      _id: 'regression',
      value: DEGRADED_PROSE,
      entityId: '6a0fa8959fc810ec168cdcfd',
      observedAt: new Date('2026-08-22T00:00:00.000Z'),
    });

    const result = selectRetainedObservation([good, regression]);

    expect(result.retained._id).toBe('good');
    expect(result.keptOlderUsefulValue).toBe(true);
    expect(result.allValuesUnusable).toBe(false);
  });

  it('keeps the newest row when the newest prose is the usable one', () => {
    const stale = row({ _id: 'stale', value: DEGRADED_PROSE });
    const fresh = row({
      _id: 'fresh',
      value: GOOD_PROSE,
      observedAt: new Date('2026-08-22T00:00:00.000Z'),
    });

    const result = selectRetainedObservation([stale, fresh]);

    expect(result.retained._id).toBe('fresh');
    expect(result.keptOlderUsefulValue).toBe(false);
  });

  it('falls back to the newest row and reports it when no value is usable', () => {
    const older = row({ _id: 'older', value: DEGRADED_PROSE });
    const newer = row({
      _id: 'newer',
      value: DEGRADED_PROSE,
      observedAt: new Date('2026-08-22T00:00:00.000Z'),
    });

    const result = selectRetainedObservation([older, newer]);

    expect(result.retained._id).toBe('newer');
    expect(result.allValuesUnusable).toBe(true);
  });

  it('keeps the newest row for a non-prose field without judging quality', () => {
    const older = row({ _id: 'older', field: 'researchAreas', value: ['immunology'] });
    const newer = row({
      _id: 'newer',
      field: 'researchAreas',
      value: [],
      observedAt: new Date('2026-08-22T00:00:00.000Z'),
    });

    expect(selectRetainedObservation([older, newer]).retained._id).toBe('newer');
  });
});

describe('planObservationFingerprintNormalization', () => {
  it('rewrites the id-form fingerprint and supersedes the regression, keeping good prose', () => {
    const legacy = row({
      _id: 'legacy',
      observationFingerprint: canonicalFingerprint(row({})),
    });
    const regression = row({
      _id: 'regression',
      entityId: '6a0fa8959fc810ec168cdcfd',
      value: DEGRADED_PROSE,
      observedAt: new Date('2026-08-22T00:00:00.000Z'),
      observationFingerprint: '["fulldescription","id:6a0fa8959fc810ec168cdcfd","x","y"]',
    });

    const plan = planObservationFingerprintNormalization([legacy, regression]);

    expect(plan.counts.fingerprintRewrites).toBe(1);
    expect(plan.fingerprintRewrites[0].id).toBe('regression');
    expect(plan.counts.activeGroupsCollapsed).toBe(1);
    expect(plan.counts.proseGroupsKeptOlderUsefulValue).toBe(1);
    expect(plan.supersessions).toEqual([{ id: 'regression', supersededBy: 'legacy' }]);
  });

  it('ignores rows that are already superseded when grouping active duplicates', () => {
    const plan = planObservationFingerprintNormalization([
      row({ _id: 'active' }),
      row({ _id: 'retired', value: DEGRADED_PROSE, superseded: true }),
    ]);

    expect(plan.counts.activeGroupsCollapsed).toBe(0);
    expect(plan.supersessions).toEqual([]);
  });

  it('counts a row that carries neither identity form as unfingerprintable', () => {
    const plan = planObservationFingerprintNormalization([
      row({ _id: 'orphan', entityKey: undefined, entityId: undefined }),
    ]);

    expect(plan.counts.unfingerprintable).toBe(1);
    expect(plan.counts.fingerprintRewrites).toBe(0);
  });
});
