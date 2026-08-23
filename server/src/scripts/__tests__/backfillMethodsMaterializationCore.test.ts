import { describe, expect, it, vi } from 'vitest';
import {
  runMethodsMaterializationBackfill,
  selectMaterializableMethodEntities,
  type MethodsMaterializationDeps,
  type MethodsMaterializationTargetEntity,
} from '../backfillMethodsMaterializationCore';

const entity = (
  entityId: string,
  archived = false,
): MethodsMaterializationTargetEntity => ({
  entityId,
  entityKey: `lab-${entityId}`,
  archived,
});

describe('selectMaterializableMethodEntities', () => {
  it('drops archived entities', () => {
    const eligible = selectMaterializableMethodEntities([
      entity('a'),
      entity('b', true),
      entity('c'),
    ]);
    expect(eligible.map((row) => row.entityId)).toEqual(['a', 'c']);
  });
});

describe('runMethodsMaterializationBackfill', () => {
  const baseDeps = (
    overrides: Partial<MethodsMaterializationDeps> = {},
  ): MethodsMaterializationDeps => ({
    findEntitiesWithLiveMethodsObservation: vi
      .fn()
      .mockResolvedValue([entity('a'), entity('b', true), entity('c')]),
    rematerializeEntityByKey: vi.fn().mockResolvedValue({ fieldsWritten: 4 }),
    entityHasMethodsAfter: vi.fn().mockResolvedValue(true),
    ...overrides,
  });

  it('writes nothing in dry-run and marks eligible entities pending', async () => {
    const deps = baseDeps();
    const report = await runMethodsMaterializationBackfill(deps, { apply: false });

    expect(report.scanned).toBe(3);
    expect(report.eligible).toBe(2);
    expect(deps.rematerializeEntityByKey).not.toHaveBeenCalled();
    expect(report.tally['pending-apply']).toBe(2);
    expect(report.tally['skipped-archived']).toBe(1);
    expect(report.rows.map((row) => row.disposition)).toEqual([
      'pending-apply',
      'skipped-archived',
      'pending-apply',
    ]);
  });

  it('re-materializes eligible entities and records methods landing on apply', async () => {
    const deps = baseDeps();
    const report = await runMethodsMaterializationBackfill(deps, { apply: true });

    expect(deps.rematerializeEntityByKey).toHaveBeenCalledTimes(2);
    expect(deps.rematerializeEntityByKey).toHaveBeenCalledWith('lab-a');
    expect(deps.rematerializeEntityByKey).not.toHaveBeenCalledWith('lab-b');
    expect(report.tally['methods-materialized']).toBe(2);
    expect(report.tally['skipped-archived']).toBe(1);
    expect(report.rows.find((row) => row.entityId === 'a')?.fieldsWritten).toBe(4);
  });

  it('flags entities whose methods field is still missing after re-materialize', async () => {
    const deps = baseDeps({
      findEntitiesWithLiveMethodsObservation: vi.fn().mockResolvedValue([entity('a')]),
      entityHasMethodsAfter: vi.fn().mockResolvedValue(false),
    });
    const report = await runMethodsMaterializationBackfill(deps, { apply: true });

    expect(report.tally['methods-still-missing']).toBe(1);
    expect(report.tally['methods-materialized']).toBe(0);
  });
});
