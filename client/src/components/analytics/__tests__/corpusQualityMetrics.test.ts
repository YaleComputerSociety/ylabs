import { describe, expect, it } from 'vitest';
import {
  corpusQualityMetricRows,
  formatMean,
  formatRatio,
  metricTrend,
  ratioShare,
  trendPointsLabel,
} from '../corpusQualityMetrics';
import type { CorpusQualityLiveMetrics, CorpusQualitySnapshotRow } from '../corpusQualityTypes';

const snapshot = (overrides: {
  hasResearchWebsite?: { n: number; of: number };
  invariantFails?: { n: number; of: number };
  measuredAt?: string;
}): CorpusQualitySnapshotRow => ({
  measuredAt: overrides.measuredAt || '2026-09-14T00:00:00.000Z',
  environment: 'development',
  richness: {
    hasResearchWebsite: overrides.hasResearchWebsite || { n: 25, of: 50 },
    hasTopic: { n: 48, of: 50 },
    hasSourceUrl: { n: 50, of: 50 },
    topicTotal: { n: 150, of: 50 },
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

const liveMetrics = (
  overrides: {
    hasResearchWebsite?: { n: number; of: number };
    genericName?: { n: number; of: number };
  } = {},
): CorpusQualityLiveMetrics => ({
  computedAt: '2026-09-15T00:00:00.000Z',
  coverage: {
    entities: 100,
    archived: 10,
    studentReady: 50,
    byTier: [],
    studentReadyBySchool: [{ school: 'School of Medicine', count: 50 }],
  },
  richness: {
    hasResearchWebsite: overrides.hasResearchWebsite || { n: 25, of: 50 },
    hasTopic: { n: 48, of: 50 },
    hasSourceUrl: { n: 50, of: 50 },
    topicTotal: { n: 150, of: 50 },
    noResearchWebsiteAndNoTopics: { n: 1, of: 50 },
  },
  description: {
    nameIsGenericFacultyResearchTitle: overrides.genericName || { n: 20, of: 50 },
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
    live: true,
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
        live: true,
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
    live: true,
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
        live: true,
      }),
    ).toBe('');
  });
});

describe('corpusQualityMetricRows', () => {
  it('returns nothing without live metrics', () => {
    expect(corpusQualityMetricRows(null, null, null)).toEqual([]);
  });

  it('takes an aggregatable metric from the live read, not from the measurement', () => {
    const rows = corpusQualityMetricRows(
      liveMetrics({ hasResearchWebsite: { n: 30, of: 50 } }),
      snapshot({ hasResearchWebsite: { n: 11, of: 50 } }),
      snapshot({ hasResearchWebsite: { n: 25, of: 50 }, measuredAt: '2026-09-07T00:00:00.000Z' }),
    );
    const website = rows.find((row) => row.label === 'Has a research website');

    expect(website?.current).toEqual({ n: 30, of: 50 });
    expect(website?.live).toBe(true);
    expect(website?.previous).toEqual({ n: 25, of: 50 });
    expect(metricTrend(website!)).toBe('better');
  });

  it('renders the aggregatable rows even when no measurement exists yet', () => {
    const rows = corpusQualityMetricRows(liveMetrics(), null, null);

    expect(rows.map((row) => row.label)).toEqual([
      'Has a research website',
      'Has topics',
      'No website and no topics',
      'Generic \u201cFaculty Research\u201d title',
    ]);
    expect(rows.every((row) => row.live)).toBe(true);
  });

  it('marks the representation-derived rows as measured rather than live', () => {
    const rows = corpusQualityMetricRows(liveMetrics(), snapshot({}), null);
    const measured = rows.filter((row) => !row.live).map((row) => row.label);

    expect(measured).toEqual([
      'Opens by stating the research',
      'Card summary only echoes the topics',
      'Public description invariant fails',
    ]);
  });

  it('directs invariant failures so that a rise reads as worse', () => {
    const rows = corpusQualityMetricRows(
      liveMetrics(),
      snapshot({ invariantFails: { n: 5, of: 50 } }),
      snapshot({ invariantFails: { n: 0, of: 50 } }),
    );
    const invariant = rows.find((row) => row.label === 'Public description invariant fails');

    expect(invariant?.direction).toBe('lower-is-better');
    expect(invariant?.live).toBe(false);
    expect(metricTrend(invariant!)).toBe('worse');
  });
});
