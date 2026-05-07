import { describe, it, expect, vi, afterEach } from 'vitest';
import { Observation } from '../../models/observation';
import { appendObservations, buildObservationFingerprint } from '../observationStore';

describe('buildObservationFingerprint', () => {
  it('is stable for same-source equivalent observations', () => {
    const a = buildObservationFingerprint({
      sourceName: 'openalex',
      entityType: 'paper',
      entityKey: 'W1',
      field: 'topics',
      value: [{ b: 2, a: 1 }, 'Quantum'],
    });
    const b = buildObservationFingerprint({
      sourceName: 'openalex',
      entityType: 'paper',
      entityKey: 'W1',
      field: 'topics',
      value: ['quantum', { a: 1, b: 2 }],
    });

    expect(a).toBe(b);
  });

  it('keeps same facts from different sources distinct', () => {
    const base = {
      entityType: 'researchGroup',
      entityKey: 'smith-lab',
      field: 'acceptingUndergrads',
      value: true,
    };

    expect(
      buildObservationFingerprint({ ...base, sourceName: 'openalex' }),
    ).not.toBe(
      buildObservationFingerprint({ ...base, sourceName: 'lab-microsite-undergrad-llm' }),
    );
  });
});

describe('appendObservations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts new observations and supersedes older same-source duplicates', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      {
        _id: 'new-1',
        observationFingerprint: 'fp:user:name',
      },
      {
        _id: 'new-2',
        observationFingerprint: 'fp:user:title',
      },
    ] as any);
    const updateMany = vi
      .spyOn(Observation, 'updateMany')
      .mockResolvedValueOnce({ modifiedCount: 2 } as any)
      .mockResolvedValueOnce({ modifiedCount: 0 } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'name',
          value: 'Ada Lovelace',
        },
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'title',
          value: 'Professor',
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'yale-directory',
        sourceWeight: 0.9,
        dryRun: false,
      },
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      observationFingerprint: 'fp:user:name',
      superseded: false,
      _id: { $ne: 'new-1' },
    });
    expect(updateMany.mock.calls[0][1]).toMatchObject({
      $set: { superseded: true, supersededBy: 'new-1' },
    });
    expect(result).toEqual({ inserted: 2, skipped: 0, superseded: 2 });
  });

  it('does not supersede anything during dry runs', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const updateMany = vi.spyOn(Observation, 'updateMany');

    const result = await appendObservations(
      [
        {
          entityType: 'paper',
          entityKey: 'W1',
          field: 'title',
          value: 'Paper',
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'openalex',
        sourceWeight: 0.85,
        dryRun: true,
      },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });
});
