import { describe, it, expect, vi, afterEach } from 'vitest';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  buildSupersededObservationPruneFilter,
  pruneSupersededObservations,
} from '../observationRetention';

const NOW = new Date('2026-05-14T12:00:00Z');
const CUTOFF = new Date('2026-04-14T12:00:00Z');

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
      }),
    ).toEqual({
      superseded: true,
      observedAt: { $lt: CUTOFF },
      sourceName: 'openalex',
      scrapeRunId: { $nin: ['recent-run-1', 'recent-run-2'] },
    });
  });

  it('dry-runs by counting candidates and never deleting', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1', 'recent-run-2', 'recent-run-3'] },
    ] as any);
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
    expect(deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      apply: false,
      candidates: 42,
      deleted: 0,
      cutoff: CUTOFF.toISOString(),
      keepRuns: 3,
      keptRunIds: ['recent-run-1', 'recent-run-2', 'recent-run-3'],
      sourceName: undefined,
    });
  });

  it('applies the same safe filter when deletion is explicitly requested', async () => {
    vi.spyOn(ScrapeRun, 'aggregate').mockResolvedValue([
      { _id: 'openalex', runIds: ['recent-run-1'] },
    ] as any);
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
});
