import { describe, it, expect, vi, afterEach } from 'vitest';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  OBSERVATION_REFERENCE_SPECS,
  buildObservationReferencePipeline,
  buildSupersededObservationPruneFilter,
  pruneSupersededObservations,
} from '../observationRetention';

const NOW = new Date('2026-05-14T12:00:00Z');
const CUTOFF = new Date('2026-04-14T12:00:00Z');

function mockReferencedObservationRows(rows: Array<{ _id: unknown }> = []) {
  return vi.spyOn(Observation.db, 'collection').mockReturnValue({
    aggregate: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    }),
  } as any);
}

describe('observation retention', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a compact-retention filter that only targets old superseded observations', () => {
    expect(
      buildSupersededObservationPruneFilter({
        cutoff: CUTOFF,
        sourceName: 'openalex',
        keepRunIds: ['recent-run-1', 'recent-run-2'],
        protectedObservationIds: ['referenced-observation'],
      }),
    ).toEqual({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      sourceName: 'openalex',
      scrapeRunId: { $nin: ['recent-run-1', 'recent-run-2'] },
      _id: { $nin: ['referenced-observation'] },
    });
  });

  it('builds reference scans for direct and field-provenance observation references', () => {
    expect(OBSERVATION_REFERENCE_SPECS).toEqual(
      expect.arrayContaining([
        { collection: 'observations', field: 'supersededBy' },
        { collection: 'entry_pathways', field: 'sourceEvidenceIds' },
        { collection: 'access_signals', field: 'sourceEvidenceId' },
        { collection: 'access_signals', field: 'observationId' },
        { collection: 'contact_routes', field: 'sourceEvidenceId' },
        { collection: 'contact_routes', field: 'sourceEvidenceIds' },
        { collection: 'posted_opportunities', field: 'sourceEvidenceIds' },
        { collection: 'undergraduate_logistics_claims', field: 'sourceEvidenceIds' },
        {
          collection: 'research_entities',
          field: 'fieldProvenance',
          kind: 'provenance-map',
        },
      ]),
    );
    expect(
      buildObservationReferencePipeline({
        collection: 'entry_pathways',
        field: 'sourceEvidenceIds',
      }),
    ).toEqual([
      { $project: { observationId: '$sourceEvidenceIds' } },
      { $unwind: '$observationId' },
      { $match: { observationId: { $type: 'objectId' } } },
      { $group: { _id: '$observationId' } },
    ]);
    expect(
      buildObservationReferencePipeline({
        collection: 'research_entities',
        field: 'fieldProvenance',
        kind: 'provenance-map',
      }),
    ).toEqual([
      {
        $project: {
          provenanceValues: {
            $cond: [
              { $eq: [{ $type: '$fieldProvenance' }, 'object'] },
              { $objectToArray: '$fieldProvenance' },
              [],
            ],
          },
        },
      },
      { $unwind: '$provenanceValues' },
      { $project: { observationId: '$provenanceValues.v.observationId' } },
      { $match: { observationId: { $type: 'objectId' } } },
      { $group: { _id: '$observationId' } },
    ]);
  });

  it('dry-runs by counting candidates and never deleting', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1', 'recent-run-2', 'recent-run-3'] },
    ] as any);
    mockReferencedObservationRows();
    const countDocuments = vi.spyOn(Observation, 'countDocuments').mockResolvedValue(42 as any);
    const deleteMany = vi.spyOn(Observation, 'deleteMany');

    const result = await pruneSupersededObservations({
      now: NOW,
      olderThanDays: 30,
      keepRuns: 3,
      apply: false,
    });

    expect(countDocuments).toHaveBeenCalledWith({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      scrapeRunId: { $nin: ['recent-run-1', 'recent-run-2', 'recent-run-3'] },
    });
    expect(countDocuments).toHaveBeenCalledTimes(2);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      apply: false,
      eligibleCandidates: 42,
      protectedCandidates: 0,
      candidates: 42,
      deleted: 0,
      cutoff: CUTOFF.toISOString(),
      keepRuns: 3,
      retainedRuns: 3,
      sourceName: undefined,
    });
  });

  it('applies the same safe filter when deletion is explicitly requested', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1'] },
    ] as any);
    mockReferencedObservationRows();
    vi.spyOn(Observation, 'countDocuments').mockResolvedValue(5 as any);
    const deleteMany = vi
      .spyOn(Observation, 'deleteMany')
      .mockResolvedValue({ deletedCount: 5 } as any);

    const result = await pruneSupersededObservations({
      now: NOW,
      olderThanDays: 30,
      keepRuns: 1,
      sourceName: 'openalex',
      apply: true,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      sourceName: 'openalex',
      scrapeRunId: { $nin: ['recent-run-1'] },
    });
    expect(result.deleted).toBe(5);
  });

  it('excludes observations referenced by durable materialized records', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1'] },
    ] as any);
    mockReferencedObservationRows([{ _id: 'referenced-observation' }]);
    vi.spyOn(Observation, 'countDocuments')
      .mockResolvedValueOnce(5 as any)
      .mockResolvedValueOnce(4 as any);
    const deleteMany = vi
      .spyOn(Observation, 'deleteMany')
      .mockResolvedValue({ deletedCount: 4 } as any);

    const result = await pruneSupersededObservations({
      now: NOW,
      olderThanDays: 30,
      keepRuns: 1,
      apply: true,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      scrapeRunId: { $nin: ['recent-run-1'] },
      _id: { $nin: ['referenced-observation'] },
    });
    expect(result).toMatchObject({
      eligibleCandidates: 5,
      protectedCandidates: 1,
      candidates: 4,
      deleted: 4,
    });
  });
});
