import { afterEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import { appendObservations, collapseLatestWins } from '../observationStore';
import {
  resolveAllFields,
  resolveFieldRanked,
  type ResolverObservation,
} from '../confidenceResolver';

const USEFUL_DESCRIPTION =
  'The laboratory investigates how gene regulatory networks control immune cell differentiation, ' +
  'developing single-cell sequencing methods and computational models and validating predictions ' +
  'with targeted CRISPR screens.';
const DEGRADED_DESCRIPTION = 'Immunology.';

const SOURCE = 'lab-microsite-description-llm';

function appendCtx() {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: SOURCE,
    sourceWeight: 0.82,
    dryRun: false,
  };
}

function fullDescriptionObservation(
  value: string,
  observedAt: Date,
  sourceName = SOURCE,
): ResolverObservation {
  return { field: 'fullDescription', value, sourceName, confidence: 0.82, observedAt };
}

describe('C4_LOSSLESS_INGEST ingest gating', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.C4_LOSSLESS_INGEST;
  });

  it('flag OFF: still drops a degraded description that would supersede a clean same-source value', async () => {
    delete process.env.C4_LOSSLESS_INGEST;
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'synthetic-lab',
          field: 'fullDescription',
          value: DEGRADED_DESCRIPTION,
        },
      ],
      appendCtx(),
      { loadActiveProse: async () => USEFUL_DESCRIPTION },
    );
    expect(insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('flag ON: keeps the degraded description (lossless) and does not supersede latest-wins rows', async () => {
    process.env.C4_LOSSLESS_INGEST = 'true';
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([{ _id: 'new-1', observationFingerprint: 'fp:desc' }] as any);
    const bulkWrite = vi
      .spyOn(Observation, 'bulkWrite')
      .mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'synthetic-lab',
          field: 'fullDescription',
          value: DEGRADED_DESCRIPTION,
        },
      ],
      appendCtx(),
      { loadActiveProse: async () => USEFUL_DESCRIPTION },
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    // latest-wins fields are not value-less-superseded under lossless ingest.
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(result.superseded).toBe(0);
  });
});

describe('C4 decide-late read: paraphrase flood + read-time preference', () => {
  it('collapses a same-source paraphrase flood to one value with no spurious conflict', () => {
    const flood: ResolverObservation[] = Array.from({ length: 12 }, (_, i) =>
      fullDescriptionObservation(`${USEFUL_DESCRIPTION} Variant ${i}.`, new Date(2026, 0, i + 1)),
    );
    const collapsed = collapseLatestWins(flood, 'researchEntity');
    expect(collapsed).toHaveLength(1);
    const resolved = resolveAllFields(collapsed);
    expect(resolved.fullDescription?.hasConflict).toBe(false);
    expect(resolved.fullDescription?.value).toBe(`${USEFUL_DESCRIPTION} Variant 11.`);
  });

  it('is idempotent: collapsing twice equals collapsing once', () => {
    const flood: ResolverObservation[] = Array.from({ length: 5 }, (_, i) =>
      fullDescriptionObservation(`${USEFUL_DESCRIPTION} v${i}.`, new Date(2026, 0, i + 1)),
    );
    const once = collapseLatestWins(flood, 'researchEntity');
    const twice = collapseLatestWins(once, 'researchEntity');
    expect(twice).toEqual(once);
  });

  it('read-time preference: a useful value stays available as a ranked candidate over a degraded higher-weight one', () => {
    // Full retained log (lossless): a degraded value from the higher-weight source A
    // and a useful value from source B. collapseLatestWins keeps both (different sources),
    // so the materializer's ranked-useful preference can pick the useful one.
    const log: ResolverObservation[] = [
      {
        field: 'fullDescription',
        value: DEGRADED_DESCRIPTION,
        sourceName: 'source-a',
        confidence: 0.95,
        observedAt: new Date(2026, 0, 10),
      },
      {
        field: 'fullDescription',
        value: USEFUL_DESCRIPTION,
        sourceName: 'source-b',
        confidence: 0.5,
        observedAt: new Date(2026, 0, 1),
      },
    ];
    const collapsed = collapseLatestWins(log, 'researchEntity');
    expect(collapsed).toHaveLength(2);
    const ranked = resolveFieldRanked('fullDescription', collapsed);
    expect(ranked.some((candidate) => candidate.value === USEFUL_DESCRIPTION)).toBe(true);
  });
});
