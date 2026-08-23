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
    writeResolvedMethods: vi.fn().mockResolvedValue({ applied: true, locked: false }),
    entityHasMethodsAfter: vi.fn().mockResolvedValue(true),
    ...overrides,
  });

  it('writes nothing in dry-run and marks eligible entities pending', async () => {
    const deps = baseDeps();
    const report = await runMethodsMaterializationBackfill(deps, { apply: false });

    expect(report.scanned).toBe(3);
    expect(report.eligible).toBe(2);
    expect(deps.writeResolvedMethods).not.toHaveBeenCalled();
    expect(report.tally['pending-apply']).toBe(2);
    expect(report.tally['skipped-archived']).toBe(1);
    expect(report.rows.map((row) => row.disposition)).toEqual([
      'pending-apply',
      'skipped-archived',
      'pending-apply',
    ]);
  });

  it('writes only resolved methods for eligible entities and never touches archived ones', async () => {
    const deps = baseDeps();
    const report = await runMethodsMaterializationBackfill(deps, { apply: true });

    expect(deps.writeResolvedMethods).toHaveBeenCalledTimes(2);
    expect(deps.writeResolvedMethods).toHaveBeenCalledWith(entity('a'));
    expect(deps.writeResolvedMethods).not.toHaveBeenCalledWith(entity('b', true));
    expect(report.tally['methods-materialized']).toBe(2);
    expect(report.tally['skipped-archived']).toBe(1);
  });

  it('records a manual lock as skipped without checking the resulting field', async () => {
    const entityHasMethodsAfter = vi.fn().mockResolvedValue(true);
    const deps = baseDeps({
      findEntitiesWithLiveMethodsObservation: vi.fn().mockResolvedValue([entity('a')]),
      writeResolvedMethods: vi.fn().mockResolvedValue({ applied: false, locked: true }),
      entityHasMethodsAfter,
    });
    const report = await runMethodsMaterializationBackfill(deps, { apply: true });

    expect(report.tally['skipped-locked']).toBe(1);
    expect(report.tally['methods-materialized']).toBe(0);
    expect(entityHasMethodsAfter).not.toHaveBeenCalled();
  });

  it('flags entities whose methods field is still missing after the write', async () => {
    const deps = baseDeps({
      findEntitiesWithLiveMethodsObservation: vi.fn().mockResolvedValue([entity('a')]),
      entityHasMethodsAfter: vi.fn().mockResolvedValue(false),
    });
    const report = await runMethodsMaterializationBackfill(deps, { apply: true });

    expect(report.tally['methods-still-missing']).toBe(1);
    expect(report.tally['methods-materialized']).toBe(0);
  });
});
