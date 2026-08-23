import { describe, expect, it, vi } from 'vitest';
import {
  runInferredPiLeadMaterializationBackfill,
  selectLaggingInferredPiEntities,
  type InferredPiLeadMaterializationDeps,
} from '../backfillInferredPiLeadMaterializationCore';

const entity = (entityId: string) => ({ entityId, entityKey: `nih-pi-${entityId}` });

describe('selectLaggingInferredPiEntities', () => {
  it('keeps only entities without a current lead', () => {
    const lagging = selectLaggingInferredPiEntities(
      [entity('a'), entity('b'), entity('c')],
      new Set(['b']),
    );
    expect(lagging.map((row) => row.entityId)).toEqual(['a', 'c']);
  });
});

describe('runInferredPiLeadMaterializationBackfill', () => {
  const baseDeps = (
    overrides: Partial<InferredPiLeadMaterializationDeps> = {},
  ): InferredPiLeadMaterializationDeps => ({
    findEntitiesWithInferredPiObservations: vi
      .fn()
      .mockResolvedValue([entity('a'), entity('b')]),
    findEntityIdsWithCurrentLead: vi.fn().mockResolvedValue(new Set(['b'])),
    loadCurrentObservationsForEntity: vi
      .fn()
      .mockResolvedValue([{ field: 'inferredPiUserId', value: 'user-a' }]),
    materializeInferredPiLead: vi.fn().mockResolvedValue(undefined),
    hasCurrentLeadAfter: vi.fn().mockResolvedValue(true),
    ...overrides,
  });

  it('does not materialize anything in dry-run and marks lagging entities pending', async () => {
    const deps = baseDeps();
    const report = await runInferredPiLeadMaterializationBackfill(deps, { apply: false });

    expect(report.scanned).toBe(2);
    expect(report.lagging).toBe(1);
    expect(deps.materializeInferredPiLead).not.toHaveBeenCalled();
    expect(report.rows).toEqual([{ entityId: 'a', entityKey: 'nih-pi-a', disposition: 'pending-apply' }]);
    expect(report.tally['pending-apply']).toBe(1);
  });

  it('materializes only the lagging entity and records the attached lead on apply', async () => {
    const deps = baseDeps();
    const report = await runInferredPiLeadMaterializationBackfill(deps, { apply: true });

    expect(deps.materializeInferredPiLead).toHaveBeenCalledTimes(1);
    expect(deps.materializeInferredPiLead).toHaveBeenCalledWith('a', [
      { field: 'inferredPiUserId', value: 'user-a' },
    ]);
    expect(report.tally['materialized-lead']).toBe(1);
    expect(report.rows[0].disposition).toBe('materialized-lead');
  });

  it('records still-unresolved when materialization does not attach a lead', async () => {
    const deps = baseDeps({ hasCurrentLeadAfter: vi.fn().mockResolvedValue(false) });
    const report = await runInferredPiLeadMaterializationBackfill(deps, { apply: true });

    expect(deps.materializeInferredPiLead).toHaveBeenCalledTimes(1);
    expect(report.tally['still-unresolved']).toBe(1);
    expect(report.tally['materialized-lead']).toBe(0);
  });
});
