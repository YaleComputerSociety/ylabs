import {
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

export function corpusQualityMetricRows(
  latest: CorpusQualitySnapshotRow | null,
  previous: CorpusQualitySnapshotRow | null,
): CorpusQualityMetricRow[] {
  if (!latest) return [];

  return [
    {
      label: 'Serves a research home',
      hint: 'A student can click through to the research itself',
      direction: 'higher-is-better',
      current: latest.richness.hasResearchHome,
      previous: previous?.richness.hasResearchHome,
    },
    {
      label: 'Serves a research area',
      hint: 'The card carries at least one topic a student can browse by',
      direction: 'higher-is-better',
      current: latest.richness.hasResearchArea,
      previous: previous?.richness.hasResearchArea,
    },
    {
      label: 'Neither a home nor an area',
      hint: 'Prose only, so nothing to click and nothing to filter by',
      direction: 'lower-is-better',
      current: latest.richness.noResearchHomeAndNoResearchArea,
      previous: previous?.richness.noResearchHomeAndNoResearchArea,
    },
    {
      label: 'Opens by stating the research',
      hint: 'First sentence describes the research rather than the person’s CV',
      direction: 'higher-is-better',
      current: latest.description.leadSentenceStatesResearch,
      previous: previous?.description.leadSentenceStatesResearch,
    },
    {
      label: 'Card summary is only an area echo',
      hint: 'The short description restates the topic chips and adds nothing',
      direction: 'lower-is-better',
      current: latest.description.shortDescriptionIsAreaEchoOnly,
      previous: previous?.description.shortDescriptionIsAreaEchoOnly,
    },
    {
      label: 'Generic “Faculty Research” title',
      hint: 'The card is titled from a role rather than from the research',
      direction: 'lower-is-better',
      current: latest.description.nameIsGenericFacultyResearchTitle,
      previous: previous?.description.nameIsGenericFacultyResearchTitle,
    },
    {
      label: 'Public description invariant fails',
      hint: 'Served copy the gate would refuse if it re-ran now',
      direction: 'lower-is-better',
      current: latest.integrity.publicDescriptionInvariantFails,
      previous: previous?.integrity.publicDescriptionInvariantFails,
    },
  ];
}
