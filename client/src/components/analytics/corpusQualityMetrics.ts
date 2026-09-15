import {
  CorpusQualityLiveMetrics,
  CorpusQualityMetricRow,
  CorpusQualityRatio,
  CorpusQualitySnapshotRow,
} from './corpusQualityTypes';

export const ratioShare = (ratio: CorpusQualityRatio | undefined): number | null => {
  if (!ratio || ratio.of === 0) return null;
  return ratio.n / ratio.of;
};

export const formatRatio = (ratio: CorpusQualityRatio | undefined): string => {
  if (!ratio) return 'not measured';
  const share = ratioShare(ratio);
  const counts = `${ratio.n.toLocaleString()} / ${ratio.of.toLocaleString()}`;
  return share === null ? counts : `${counts} (${Math.round(share * 100)}%)`;
};

export const formatMean = (ratio: CorpusQualityRatio | undefined): string => {
  if (!ratio || ratio.of === 0) return 'not measured';
  return `${(ratio.n / ratio.of).toFixed(1)} per row`;
};

export type CorpusQualityTrend = 'better' | 'worse' | 'flat' | 'unknown';

export const TREND_FLAT_THRESHOLD = 0.005;

export function metricTrend(row: CorpusQualityMetricRow): CorpusQualityTrend {
  const current = ratioShare(row.current);
  const previous = ratioShare(row.previous);
  if (current === null || previous === null) return 'unknown';
  const delta = current - previous;
  if (Math.abs(delta) < TREND_FLAT_THRESHOLD) return 'flat';
  const rising = delta > 0;
  return rising === (row.direction === 'higher-is-better') ? 'better' : 'worse';
}

/**
 * A move the trend calls flat must not also print a signed delta, or the marker
 * and its label contradict each other on screen.
 */
export function trendPointsLabel(row: CorpusQualityMetricRow): string {
  const trend = metricTrend(row);
  if (trend === 'unknown') return '';
  if (trend === 'flat') return 'no change';
  const current = ratioShare(row.current);
  const previous = ratioShare(row.previous);
  if (current === null || previous === null) return '';
  const points = Math.round((current - previous) * 1000) / 10;
  return `${points > 0 ? '+' : ''}${points} pts`;
}

/**
 * Live rows are computed by one aggregation on this request; snapshot rows need
 * the roster resolved and the public description representation built per row,
 * which is ~13s over the served corpus, so they read from the latest
 * measurement. Keeping the two visibly distinct is the point: a reader must be
 * able to tell "this is now" from "this is as of last night".
 */
/**
 * Live rows come from one aggregation on this request. Snapshot rows need the
 * roster resolved and the public description representation built per row, about
 * 13 seconds over the served corpus, so they read from the latest measurement.
 * Keeping the two visibly distinct is the point: a reader must be able to tell
 * "this is now" from "this is as of the last measurement".
 */
export function corpusQualityMetricRows(
  live: CorpusQualityLiveMetrics | null,
  latest: CorpusQualitySnapshotRow | null,
  previous: CorpusQualitySnapshotRow | null,
): CorpusQualityMetricRow[] {
  if (!live) return [];

  return [
    {
      label: 'Has a research website',
      hint: 'A student can click through to the research itself',
      direction: 'higher-is-better',
      current: live.richness.hasResearchWebsite,
      previous: previous?.richness.hasResearchWebsite,
      live: true,
    },
    {
      label: 'Has topics',
      hint: 'Shown to students as "Best fit for", and used by search; never gates',
      direction: 'higher-is-better',
      current: live.richness.hasTopic,
      previous: previous?.richness.hasTopic,
      live: true,
    },
    {
      label: 'No website and no topics',
      hint: 'Prose only, so nothing to click and no topics to match on',
      direction: 'lower-is-better',
      current: live.richness.noResearchWebsiteAndNoTopics,
      previous: previous?.richness.noResearchWebsiteAndNoTopics,
      live: true,
    },
    ...(latest
      ? ([
          {
            label: 'Opens by stating the research',
            hint: 'First sentence describes the research rather than the person\u2019s CV',
            direction: 'higher-is-better',
            current: latest.description.leadSentenceStatesResearch,
            previous: previous?.description.leadSentenceStatesResearch,
            live: false,
          },
          {
            label: 'Card summary only echoes the topics',
            hint: 'The short description restates the topic chips and adds nothing',
            direction: 'lower-is-better',
            current: latest.description.shortDescriptionIsAreaEchoOnly,
            previous: previous?.description.shortDescriptionIsAreaEchoOnly,
            live: false,
          },
        ] as CorpusQualityMetricRow[])
      : []),
    {
      label: 'Generic \u201cFaculty Research\u201d title',
      hint: 'The card is titled from a role rather than from the research',
      direction: 'lower-is-better',
      current: live.description.nameIsGenericFacultyResearchTitle,
      previous: previous?.description.nameIsGenericFacultyResearchTitle,
      live: true,
    },
    ...(latest
      ? ([
          {
            label: 'Public description invariant fails',
            hint: 'Served copy the gate would refuse if it re-ran now',
            current: latest.integrity.publicDescriptionInvariantFails,
            previous: previous?.integrity.publicDescriptionInvariantFails,
            direction: 'lower-is-better',
            live: false,
          },
        ] as CorpusQualityMetricRow[])
      : []),
  ];
}
