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

interface CorpusQualityMetricDefinition {
  metric: string;
  label: string;
  hint: string;
  direction: CorpusQualityMetricRow['direction'];
  fromSnapshot: (row: CorpusQualitySnapshotRow) => CorpusQualityRatio;
  fromLive?: (live: CorpusQualityLiveMetrics) => CorpusQualityRatio;
}

const CORPUS_QUALITY_METRICS: CorpusQualityMetricDefinition[] = [
  {
    metric: 'hasResearchWebsite',
    label: 'Has a research website',
    hint: 'A student can click through to the research itself',
    direction: 'higher-is-better',
    fromSnapshot: (row) => row.richness.hasResearchWebsite,
    fromLive: (live) => live.richness.hasResearchWebsite,
  },
  {
    metric: 'hasTopic',
    label: 'Has topics',
    hint: 'Shown to students as "Best fit for", and used by search; never gates',
    direction: 'higher-is-better',
    fromSnapshot: (row) => row.richness.hasTopic,
  },
  {
    metric: 'noResearchWebsiteAndNoTopics',
    label: 'No website and no topics',
    hint: 'Prose only, so nothing to click and no topics to match on',
    direction: 'lower-is-better',
    fromSnapshot: (row) => row.richness.noResearchWebsiteAndNoTopics,
  },
  {
    metric: 'leadSentenceStatesResearch',
    label: 'Opens by stating the research',
    hint: 'First sentence describes the research rather than the person\u2019s CV',
    direction: 'higher-is-better',
    fromSnapshot: (row) => row.description.leadSentenceStatesResearch,
  },
  {
    metric: 'shortDescriptionIsAreaEchoOnly',
    label: 'Card summary only echoes the topics',
    hint: 'The short description restates the topic chips and adds nothing',
    direction: 'lower-is-better',
    fromSnapshot: (row) => row.description.shortDescriptionIsAreaEchoOnly,
  },
  {
    metric: 'browseCardCutMidSentence',
    label: 'Browse card cut mid-sentence',
    hint: 'The card sentence runs past 200 characters, so the student sees it end in \u2026',
    direction: 'lower-is-better',
    fromSnapshot: (row) => row.description.browseCardCutMidSentence,
  },
  {
    metric: 'browseCardSixWordsOrFewer',
    label: 'Browse card of six words or fewer',
    hint: 'Too short to tell a student what is studied, such as \u201cStudies human behavior.\u201d',
    direction: 'lower-is-better',
    fromSnapshot: (row) => row.description.browseCardSixWordsOrFewer,
  },
  {
    metric: 'fullDescriptionIsBiography',
    label: 'Serves a biography as its description',
    hint: 'No research prose exists, so the career biography is the fallback',
    direction: 'lower-is-better',
    fromSnapshot: (row) => row.description.fullDescriptionIsBiography,
  },
  {
    metric: 'nameIsGenericFacultyResearchTitle',
    label: 'Generic \u201cFaculty Research\u201d title',
    hint: 'The card is titled from a role rather than from the research',
    direction: 'lower-is-better',
    fromSnapshot: (row) => row.description.nameIsGenericFacultyResearchTitle,
    fromLive: (live) => live.description.nameIsGenericFacultyResearchTitle,
  },
  {
    metric: 'publicDescriptionInvariantFails',
    label: 'Public description invariant fails',
    hint: 'Served copy the gate would refuse if it re-ran now',
    direction: 'lower-is-better',
    fromSnapshot: (row) => row.integrity.publicDescriptionInvariantFails,
  },
];

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
  snapshotOnlyMetrics: readonly string[],
): CorpusQualityMetricRow[] {
  if (!live) return [];

  return CORPUS_QUALITY_METRICS.flatMap(
    ({ metric, label, hint, direction, fromSnapshot, fromLive }): CorpusQualityMetricRow[] => {
      const previousValue = previous ? fromSnapshot(previous) : undefined;
      if (fromLive && !snapshotOnlyMetrics.includes(metric)) {
        return [
          { label, hint, direction, current: fromLive(live), previous: previousValue, live: true },
        ];
      }
      if (!latest) return [];
      return [
        {
          label,
          hint,
          direction,
          current: fromSnapshot(latest),
          previous: previousValue,
          live: false,
        },
      ];
    },
  );
}
