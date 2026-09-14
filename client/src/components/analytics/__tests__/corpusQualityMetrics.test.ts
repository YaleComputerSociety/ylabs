import { describe, expect, it } from 'vitest';
import {
  corpusQualityMetricRows,
  formatMean,
  formatRatio,
  metricTrend,
  ratioShare,
  trendPointsLabel,
} from '../corpusQualityMetrics';
import type { CorpusQualitySnapshotRow } from '../corpusQualityTypes';

const snapshot = (overrides: {
  hasResearchWebsite?: { n: number; of: number };
  invariantFails?: { n: number; of: number };
  measuredAt?: string;
}): CorpusQualitySnapshotRow => ({
  measuredAt: overrides.measuredAt || '2026-09-14T00:00:00.000Z',
  environment: 'development',
  databaseName: 'Development',
  surface: 'served student_ready rows',
  coverage: {
    entities: 100,
    archived: 10,
    studentReady: 50,
    byTier: [],
    studentReadyBySchool: [],
  },
  richness: {
    hasResearchWebsite: overrides.hasResearchWebsite || { n: 25, of: 50 },
    hasSearchTopic: { n: 48, of: 50 },
    hasSourceUrl: { n: 50, of: 50 },
    searchTopicTotal: { n: 150, of: 50 },
    noResearchWebsiteAndNoTopics: { n: 1, of: 50 },
  },
  description: {
    fullDescriptionUseful: { n: 50, of: 50 },
    shortDescriptionUseful: { n: 50, of: 50 },
    leadSentenceStatesResearch: { n: 24, of: 50 },
    shortDescriptionIsAreaEchoOnly: { n: 2, of: 50 },
    nameIsGenericFacultyResearchTitle: { n: 20, of: 50 },
  },
  integrity: {
    publicDescriptionInvariantFails: overrides.invariantFails || { n: 0, of: 50 },
  },
});

describe('formatRatio', () => {
  it('always shows the denominator so a count cannot be read alone', () => {
    expect(formatRatio({ n: 1270, of: 3095 })).toBe('1,270 / 3,095 (41%)');
  });

  it('omits a share rather than dividing by zero', () => {
    expect(formatRatio({ n: 0, of: 0 })).toBe('0 / 0');
  });

  it('reports an absent metric as not measured rather than as zero', () => {
    expect(formatRatio(undefined)).toBe('not measured');
    expect(ratioShare(undefined)).toBeNull();
  });
});

describe('formatMean', () => {
  it('derives a mean from the stored total and its denominator', () => {
    expect(formatMean({ n: 150, of: 50 })).toBe('3.0 per row');
  });
});

describe('metricTrend', () => {
  const row = (
    direction: 'higher-is-better' | 'lower-is-better',
    current: number,
    previous: number,
  ) => ({
    label: 'metric',
    hint: 'hint',
    direction,
    current: { n: current, of: 100 },
    previous: { n: previous, of: 100 },
  });

  it('reads a rise as better when higher is better', () => {
    expect(metricTrend(row('higher-is-better', 60, 50))).toBe('better');
  });

  it('reads the same rise as worse when lower is better', () => {
    expect(metricTrend(row('lower-is-better', 60, 50))).toBe('worse');
  });

  it('reads a fall as better when lower is better', () => {
    expect(metricTrend(row('lower-is-better', 40, 50))).toBe('better');
  });

  it('treats a sub-half-point move as flat', () => {
    expect(metricTrend(row('higher-is-better', 50, 50))).toBe('flat');
  });

  it('reports unknown rather than better when there is no previous measurement', () => {
    expect(
      metricTrend({
        label: 'metric',
        hint: 'hint',
        direction: 'higher-is-better',
        current: { n: 60, of: 100 },
      }),
    ).toBe('unknown');
  });
});

describe('trendPointsLabel', () => {
  const row = (
    direction: 'higher-is-better' | 'lower-is-better',
    current: number,
    previous: number,
  ) => ({
    label: 'metric',
    hint: 'hint',
    direction,
    current: { n: current, of: 1000 },
    previous: { n: previous, of: 1000 },
  });

  it('says no change when the trend calls the move flat, so the marker and label agree', () => {
    const subThreshold = row('lower-is-better', 169, 166);
    expect(metricTrend(subThreshold)).toBe('flat');
    expect(trendPointsLabel(subThreshold)).toBe('no change');
  });

  it('signs a move the trend counts', () => {
    expect(trendPointsLabel(row('higher-is-better', 500, 400))).toBe('+10 pts');
    expect(trendPointsLabel(row('higher-is-better', 400, 500))).toBe('-10 pts');
  });

  it('prints nothing without a previous measurement', () => {
    expect(
      trendPointsLabel({
        label: 'metric',
        hint: 'hint',
        direction: 'higher-is-better',
        current: { n: 1, of: 2 },
      }),
    ).toBe('');
  });
});

describe('corpusQualityMetricRows', () => {
  it('returns nothing when no measurement has been recorded', () => {
    expect(corpusQualityMetricRows(null, null)).toEqual([]);
  });

  it('pairs each metric with the same metric from the previous measurement', () => {
    const rows = corpusQualityMetricRows(
      snapshot({ hasResearchWebsite: { n: 30, of: 50 } }),
      snapshot({ hasResearchWebsite: { n: 25, of: 50 }, measuredAt: '2026-09-07T00:00:00.000Z' }),
    );
    const home = rows.find((row) => row.label === 'Has a research website');

    expect(home?.current).toEqual({ n: 30, of: 50 });
    expect(home?.previous).toEqual({ n: 25, of: 50 });
    expect(metricTrend(home!)).toBe('better');
  });

  it('directs invariant failures so that a rise reads as worse', () => {
    const rows = corpusQualityMetricRows(
      snapshot({ invariantFails: { n: 5, of: 50 } }),
      snapshot({ invariantFails: { n: 0, of: 50 } }),
    );
    const invariant = rows.find((row) => row.label === 'Public description invariant fails');

    expect(invariant?.direction).toBe('lower-is-better');
    expect(metricTrend(invariant!)).toBe('worse');
  });
});
