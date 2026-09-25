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
 *
 * The three topic metrics crossed the line in #3379, deliberately and for the
 * reason this file exists. Parity held in September only because BOTH sides read
 * the stored array: the unsourced domain-coherence guard rewrites `researchAreas`
 * at serve time and the representation's chain stopped short of it. Measured on
 * 3,386 served Development rows on 2026-09-25, the corpus stores 16,017 chips and
 * serves 15,222, and 77 rows serve no topic while storing one. The guard reads
 * `fieldProvenance` and the row's own prose, so no aggregation can reproduce it,
 * and the three metrics that depend on the chip list are now snapshot-backed.
 */
describe('corpus quality freshness contract', () => {
  it('keeps exactly the representation-dependent metrics snapshot-only', () => {
    expect([...CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS]).toEqual([
      'leadSentenceStatesResearch',
      'shortDescriptionIsAreaEchoOnly',
      'publicDescriptionInvariantFails',
      'hasTopic',
      'topicTotal',
      'noResearchWebsiteAndNoTopics',
    ]);
  });

  it('does not list an aggregatable metric as snapshot-only', () => {
    const aggregatable = [
      'hasResearchWebsite',
      'hasSourceUrl',
      'nameIsGenericFacultyResearchTitle',
    ];

    for (const metric of aggregatable) {
      expect(CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS).not.toContain(metric);
    }
  });
});
