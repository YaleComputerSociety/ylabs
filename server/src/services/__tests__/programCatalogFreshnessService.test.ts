import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATALOG_FRESHNESS_THRESHOLDS,
  computeCatalogFreshness,
} from '../programCatalogFreshnessService';

const NOW = new Date('2026-08-23T00:00:00.000Z');
const PAST_DEADLINE = new Date('2026-01-01T00:00:00.000Z');
const FUTURE_DEADLINE = new Date('2027-01-01T00:00:00.000Z');

interface FixtureRecord {
  isAcceptingApplications?: boolean;
  deadline?: Date | null;
  sourceKey?: string;
  title?: string;
  summary?: string;
  applicationLink?: string;
}

const record = (fields: FixtureRecord): FixtureRecord => fields;

const repeat = (count: number, factory: (index: number) => FixtureRecord): FixtureRecord[] =>
  Array.from({ length: count }, (_unused, index) => factory(index));

describe('computeCatalogFreshness', () => {
  it('trips the stale state when the corpus has aged out of its cycle (the #555 cliff)', () => {
    const staleCorpus = [
      ...repeat(24, (index) =>
        record({
          isAcceptingApplications: true,
          deadline: PAST_DEADLINE,
          sourceKey: `office:${index % 3}`,
        }),
      ),
      record({ isAcceptingApplications: true, deadline: FUTURE_DEADLINE, sourceKey: 'office:live' }),
    ];

    const report = computeCatalogFreshness(staleCorpus, NOW);

    expect(report.status).toBe('stale');
    expect(report.totals.visible).toBe(25);
    expect(report.totals.accepting).toBe(1);
    expect(report.totals.deadlinePast).toBe(24);
    expect(report.breaches).toHaveLength(2);
    expect(report.staleSourceKeys.length).toBeGreaterThan(0);
    expect(report.staleSourceKeys.reduce((sum, s) => sum + s.pastDeadline, 0)).toBe(24);
  });

  it('reports a clean state for a healthy mixed corpus', () => {
    const healthyCorpus = [
      ...repeat(10, () => record({ isAcceptingApplications: true, deadline: FUTURE_DEADLINE })),
      ...repeat(8, () => record({ isAcceptingApplications: true, deadline: null })),
      ...repeat(7, () => record({ isAcceptingApplications: true, deadline: PAST_DEADLINE })),
    ];

    const report = computeCatalogFreshness(healthyCorpus, NOW);

    expect(report.status).toBe('clean');
    expect(report.totals.accepting).toBe(18);
    expect(report.totals.deadlineFuture).toBe(10);
    expect(report.totals.deadlineNone).toBe(8);
    expect(report.totals.deadlinePast).toBe(7);
    expect(report.breaches).toHaveLength(0);
    expect(report.staleSourceKeys).toHaveLength(0);
  });

  it('reuses the read-time derivation: a past deadline is never counted as accepting', () => {
    const corpus = repeat(DEFAULT_CATALOG_FRESHNESS_THRESHOLDS.minCorpusSize, () =>
      record({ isAcceptingApplications: true, deadline: PAST_DEADLINE }),
    );

    const report = computeCatalogFreshness(corpus, NOW);

    expect(report.totals.accepting).toBe(0);
    expect(report.shares.accepting).toBe(0);
    expect(report.status).toBe('stale');
  });

  it('does not alarm on a corpus below the minimum size', () => {
    const tinyCorpus = repeat(3, () =>
      record({ isAcceptingApplications: true, deadline: PAST_DEADLINE }),
    );

    const report = computeCatalogFreshness(tinyCorpus, NOW);

    expect(report.status).toBe('insufficient-data');
    expect(report.breaches).toHaveLength(0);
    expect(report.staleSourceKeys).toHaveLength(0);
  });

  it('attributes staleness to contributing sourceKeys, ranked by past-deadline count', () => {
    const corpus = [
      ...repeat(18, () =>
        record({ isAcceptingApplications: true, deadline: PAST_DEADLINE, sourceKey: 'stale-heavy' }),
      ),
      ...repeat(5, () =>
        record({ isAcceptingApplications: true, deadline: PAST_DEADLINE, sourceKey: 'stale-light' }),
      ),
      ...repeat(2, () =>
        record({ isAcceptingApplications: true, deadline: FUTURE_DEADLINE, sourceKey: 'healthy' }),
      ),
    ];

    const report = computeCatalogFreshness(corpus, NOW);

    expect(report.status).toBe('stale');
    expect(report.staleSourceKeys.map((s) => s.sourceKey)).toEqual(['stale-heavy', 'stale-light']);
    expect(report.staleSourceKeys[0]).toMatchObject({ visible: 18, accepting: 0, pastDeadline: 18 });
  });

  it('buckets records with no sourceKey under an unattributed key', () => {
    const corpus = repeat(20, () =>
      record({ isAcceptingApplications: true, deadline: PAST_DEADLINE }),
    );

    const report = computeCatalogFreshness(corpus, NOW);

    expect(report.staleSourceKeys).toHaveLength(1);
    expect(report.staleSourceKeys[0].sourceKey).toBe('(none)');
  });

  it('counts a projected next-cycle deadline as future but flags it separately from a genuine one', () => {
    const corpus = [
      record({
        isAcceptingApplications: true,
        deadline: PAST_DEADLINE,
        title: 'Annual undergraduate research grant',
        summary: 'An annual grant for undergraduate research, awarded each spring.',
        applicationLink: 'https://fellowships.yale.edu/annual-grant',
      }),
      record({ isAcceptingApplications: true, deadline: FUTURE_DEADLINE }),
    ];

    const report = computeCatalogFreshness(corpus, NOW);

    expect(report.totals.deadlineFuture).toBe(2);
    expect(report.totals.deadlineFutureProjected).toBe(1);
    expect(report.totals.deadlinePast).toBe(0);
  });

  it('honors overridden thresholds', () => {
    const corpus = repeat(20, (index) =>
      record({
        isAcceptingApplications: true,
        deadline: index < 12 ? FUTURE_DEADLINE : PAST_DEADLINE,
      }),
    );

    expect(computeCatalogFreshness(corpus, NOW).status).toBe('clean');
    expect(
      computeCatalogFreshness(corpus, NOW, {
        ...DEFAULT_CATALOG_FRESHNESS_THRESHOLDS,
        maxPastDeadlineShare: 0.3,
      }).status,
    ).toBe('stale');
  });
});
