import { describe, expect, it } from 'vitest';
import {
  PAGE_GROUNDING_VERIFIED_SINCE,
  buildWriterEvidenceSnippets,
  ingestVerifiedRunIds,
  markIngestVerifiedObservations,
} from '../coverageSynthesisCore';

const NOW = new Date('2026-10-04T00:00:00Z');
const LANE = 'lab-microsite-description-llm';
const VERIFIED_RUN = 'a'.repeat(24);
const EARLY_RUN = 'b'.repeat(24);
const BACKFILL_RUN = 'c'.repeat(24);
const PAGE_TEXT =
  'The laboratory studies how coastal salt marshes store carbon in sediment and how tidal flooding shapes the roots of marsh grasses along the Atlantic coast.';

const runs = [
  { _id: VERIFIED_RUN, sourceName: LANE, startedAt: new Date('2026-09-15T00:00:00Z') },
  { _id: EARLY_RUN, sourceName: LANE, startedAt: new Date('2026-08-01T00:00:00Z') },
];

const laneObservation = (scrapeRunId: string, field = 'fullDescription') => ({
  field,
  value: PAGE_TEXT,
  sourceName: LANE,
  sourceUrl: 'https://marsh.example.edu/',
  confidence: 0.82,
  scrapeRunId,
});

const evidenceFor = (observations: ReturnType<typeof laneObservation>[]) =>
  buildWriterEvidenceSnippets(
    markIngestVerifiedObservations(observations, ingestVerifiedRunIds(runs)),
    [],
    { now: NOW },
  ).map((snippet) => snippet.text);

describe('ingest-verified extraction is writer evidence (#4867, owner decision)', () => {
  it('admits a fullDescription the lane verified against its fetched page', () => {
    expect(evidenceFor([laneObservation(VERIFIED_RUN)])).toEqual([PAGE_TEXT]);
  });

  it('refuses a backfill-shaped value, whose run id no recorded lane run carries', () => {
    expect(evidenceFor([laneObservation(BACKFILL_RUN)])).toEqual([]);
  });

  it('refuses a value from a lane run that predates the ingest check', () => {
    expect(ingestVerifiedRunIds(runs).has(EARLY_RUN)).toBe(false);
    expect(evidenceFor([laneObservation(EARLY_RUN)])).toEqual([]);
  });

  it('refuses the lane card, which can be synthesized rather than copied', () => {
    expect(evidenceFor([laneObservation(VERIFIED_RUN, 'shortDescription')])).toEqual([]);
  });

  it('does not admit another model lane on a recorded run id', () => {
    const other = { ...laneObservation(VERIFIED_RUN), sourceName: 'lab-microsite-undergrad-llm' };
    expect(
      buildWriterEvidenceSnippets(
        markIngestVerifiedObservations([other], ingestVerifiedRunIds(runs)),
        [],
        {
          now: NOW,
        },
      ),
    ).toEqual([]);
  });

  it('refuses a value from a lane run an operator invalidated', () => {
    const quarantinedRun = 'f'.repeat(24);
    const quarantined = {
      _id: quarantinedRun,
      sourceName: LANE,
      startedAt: new Date('2026-09-20T00:00:00Z'),
      invalidated: true,
    };
    expect(
      buildWriterEvidenceSnippets(
        markIngestVerifiedObservations(
          [laneObservation(quarantinedRun)],
          ingestVerifiedRunIds([...runs, quarantined]),
        ),
        [],
        { now: NOW },
      ),
    ).toEqual([]);
  });

  it('counts only runs started once the check reached the lane', () => {
    const atFloor = {
      _id: 'd'.repeat(24),
      sourceName: LANE,
      startedAt: PAGE_GROUNDING_VERIFIED_SINCE,
    };
    const otherLane = { _id: 'e'.repeat(24), sourceName: 'dept-faculty-roster', startedAt: NOW };
    expect([...ingestVerifiedRunIds([atFloor, otherLane])]).toEqual(['d'.repeat(24)]);
  });
});
