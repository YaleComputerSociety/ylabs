import { afterEach, describe, expect, it, vi } from 'vitest';

import { Observation } from '../../models/observation';
import { Paper } from '../../models/paper';
import { PaperAuthor } from '../../models/paperAuthor';
import { materializeEntity, materializeFromRun } from '../entityMaterializer';

const RUN_ID = '64f000000000000000000001';
const originalRollbackValue = process.env.RETIRED_PAPER_PIPELINE_ROLLBACK;

function restoreRollbackEnvironment(): void {
  if (originalRollbackValue === undefined) {
    delete process.env.RETIRED_PAPER_PIPELINE_ROLLBACK;
    return;
  }
  process.env.RETIRED_PAPER_PIPELINE_ROLLBACK = originalRollbackValue;
}

afterEach(() => {
  restoreRollbackEnvironment();
  vi.restoreAllMocks();
});

describe('retired paper materializer quarantine', () => {
  it('skips direct paper materialization before Observation, Paper, or Meili work', async () => {
    delete process.env.RETIRED_PAPER_PIPELINE_ROLLBACK;
    const observationFind = vi.spyOn(Observation, 'find');
    const paperFindOne = vi.spyOn(Paper, 'findOne');
    const paperUpdateOne = vi.spyOn(Paper, 'updateOne');
    const paperCreate = vi.spyOn(Paper, 'create');
    const paperFindById = vi.spyOn(Paper, 'findById');

    await expect(
      materializeEntity('paper', { entityKey: 'doi:10.1000/example' }),
    ).resolves.toMatchObject({
      entityType: 'paper',
      entityKey: 'doi:10.1000/example',
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'retired-paper-pipeline',
    });

    expect(observationFind).not.toHaveBeenCalled();
    expect(paperFindOne).not.toHaveBeenCalled();
    expect(paperUpdateOne).not.toHaveBeenCalled();
    expect(paperCreate).not.toHaveBeenCalled();
    expect(paperFindById).not.toHaveBeenCalled();
  });

  it('keeps the direct paper rollback path reachable with explicit opt-in', async () => {
    process.env.RETIRED_PAPER_PIPELINE_ROLLBACK = 'true';
    const observationFind = vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    } as any);

    const result = await materializeEntity('paper', {
      entityKey: 'doi:10.1000/example',
    });

    expect(observationFind).toHaveBeenCalledWith({
      entityType: 'paper',
      entityKey: 'doi:10.1000/example',
      superseded: false,
    });
    expect(result.skipped).toBeUndefined();
    expect(result.fieldsWritten).toBe(0);
  });

  it('skips paper run writes while continuing non-paper materialization', async () => {
    delete process.env.RETIRED_PAPER_PIPELINE_ROLLBACK;
    const observationFind = vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    } as any);
    vi.spyOn(Observation, 'aggregate')
      .mockResolvedValueOnce([
        {
          _id: {
            entityType: 'listing',
            entityKey: '64f000000000000000000002',
          },
        },
      ] as any)
      .mockResolvedValueOnce([] as any);
    const paperFind = vi.spyOn(Paper, 'find');
    const paperBulkWrite = vi.spyOn(Paper, 'bulkWrite');
    const paperAuthorBulkWrite = vi.spyOn(PaperAuthor, 'bulkWrite');

    const result = await materializeFromRun(RUN_ID, { dryRun: true });

    expect(result).toMatchObject({
      materialized: 1,
      created: 0,
      updated: 1,
      skipped: 0,
      errors: 0,
    });
    expect(observationFind).toHaveBeenCalledTimes(1);
    expect(observationFind).toHaveBeenCalledWith({
      entityType: 'listing',
      entityKey: '64f000000000000000000002',
      superseded: false,
    });
    expect(paperFind).not.toHaveBeenCalled();
    expect(paperBulkWrite).not.toHaveBeenCalled();
    expect(paperAuthorBulkWrite).not.toHaveBeenCalled();
  });

  it('keeps bulk paper dry-run materialization reachable with explicit opt-in', async () => {
    process.env.RETIRED_PAPER_PIPELINE_ROLLBACK = 'true';
    const observationFind = vi.spyOn(Observation, 'find').mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            entityKey: 'doi:10.1000/example',
            field: 'title',
            value: 'Rollback fixture',
            sourceName: 'crossref',
            confidence: 0.9,
            observedAt: new Date('2026-07-01T00:00:00Z'),
            sourceUrl: 'https://doi.org/10.1000/example',
          },
        ]),
      }),
    } as any);
    vi.spyOn(Observation, 'aggregate').mockResolvedValue([] as any);
    const paperFind = vi.spyOn(Paper, 'find').mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as any);
    const paperBulkWrite = vi.spyOn(Paper, 'bulkWrite');
    const paperAuthorBulkWrite = vi.spyOn(PaperAuthor, 'bulkWrite');

    const result = await materializeFromRun(RUN_ID, { dryRun: true });

    expect(observationFind).toHaveBeenCalledWith({
      scrapeRunId: expect.anything(),
      entityType: 'paper',
      superseded: false,
    });
    expect(paperFind).toHaveBeenCalled();
    expect(result).toMatchObject({
      materialized: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      errors: 0,
    });
    expect(paperBulkWrite).not.toHaveBeenCalled();
    expect(paperAuthorBulkWrite).not.toHaveBeenCalled();
  });
});
