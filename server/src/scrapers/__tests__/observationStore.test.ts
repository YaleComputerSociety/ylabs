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
      entityType: 'researchEntity',
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

  it('ignores value drift for latest-wins fields so new observations supersede the prior one', () => {
    const base = {
      sourceName: 'lab-microsite-description-llm',
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
    };
    for (const field of ['fullDescription', 'shortDescription', 'researchAreas', 'methods']) {
      const v1 = buildObservationFingerprint({ ...base, field, value: 'The Smith Lab studies X.' });
      const v2 = buildObservationFingerprint({
        ...base,
        field,
        value: 'The Smith Lab investigates X and Y.',
      });
      expect(v1).toBe(v2);
    }
  });

  it('still distinguishes values for non-latest-wins fields', () => {
    const base = {
      sourceName: 'centers-institutes-index',
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
      field: 'websiteUrl',
    };
    expect(
      buildObservationFingerprint({ ...base, value: 'https://a.yale.edu' }),
    ).not.toBe(buildObservationFingerprint({ ...base, value: 'https://b.yale.edu' }));
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
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({
      modifiedCount: 2,
    } as any);

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
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite.mock.calls[0][0][0]).toMatchObject({
      updateMany: {
        filter: {
          observationFingerprint: 'fp:user:name',
          superseded: false,
          _id: { $ne: 'new-1' },
        },
        update: {
          $set: { superseded: true, supersededBy: 'new-1' },
        },
      },
    });
    expect(result).toEqual({ inserted: 2, skipped: 0, superseded: 2 });
  });

  it('supersedes duplicate fingerprints with one bulk write per append batch', async () => {
    vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      {
        _id: 'new-1',
        observationFingerprint: 'fp:user:name',
      },
      {
        _id: 'new-2',
        observationFingerprint: 'fp:user:title',
      },
    ] as any);
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({
      modifiedCount: 2,
    } as any);

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

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite.mock.calls[0][0]).toHaveLength(2);
    expect(result).toEqual({ inserted: 2, skipped: 0, superseded: 2 });
  });

  it('does not supersede anything during dry runs', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite');

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
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });
});
