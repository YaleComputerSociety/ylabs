import { describe, expect, it } from 'vitest';
import { CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS } from '../corpusQualityDashboardService';

/**
 * The split between live and measured is the panel's whole freshness contract, so
 * pin which metrics are which. Moving a metric across the line means changing
 * this list deliberately, not discovering later that a row silently went stale.
 *
 * Parity between the aggregation and the representation was measured on 3,120
 * served Development rows on 2026-09-14: identical counts for research website
 * (1276), topics (3026), topic total (15136), dead ends (69), and generic title
 * (1471). It is asserted against live data by `corpus:snapshot`, which keeps
 * recording the representation-derived value for the same metrics.
 */
describe('corpus quality freshness contract', () => {
  it('keeps exactly the representation-dependent metrics snapshot-only', () => {
    expect([...CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS]).toEqual([
      'leadSentenceStatesResearch',
      'shortDescriptionIsAreaEchoOnly',
      'publicDescriptionInvariantFails',
    ]);
  });

  it('does not list an aggregatable metric as snapshot-only', () => {
    const aggregatable = [
      'hasResearchWebsite',
      'hasTopic',
      'hasSourceUrl',
      'topicTotal',
      'noResearchWebsiteAndNoTopics',
      'nameIsGenericFacultyResearchTitle',
    ];

    for (const metric of aggregatable) {
      expect(CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS).not.toContain(metric);
    }
  });
});
