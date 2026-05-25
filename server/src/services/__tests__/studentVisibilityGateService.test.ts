import { describe, expect, it, vi } from 'vitest';

import {
  isBlockingVisibilityReason,
  runStudentVisibilityGateForPlans,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';

const safePlan = (overrides: Partial<StudentVisibilityGatePlan> = {}): StudentVisibilityGatePlan => ({
  collection: 'research',
  recordId: 'entity-safe',
  label: 'Safe Lab',
  currentTier: 'operator_review',
  computedTier: 'student_ready',
  tier: 'student_ready',
  reasons: ['source_backed_description', 'concrete_next_step'],
  sourceNames: ['department-undergrad-research'],
  nextRepairAction: 'Operator review.',
  ...overrides,
});

const heldPlan = (overrides: Partial<StudentVisibilityGatePlan> = {}): StudentVisibilityGatePlan => ({
  collection: 'research',
  recordId: 'entity-held',
  label: 'Held Lab',
  currentTier: 'operator_review',
  computedTier: 'operator_review',
  tier: 'operator_review',
  reasons: ['missing_description', 'missing_action_evidence', 'concrete_next_step'],
  sourceNames: ['ysm-atoz-index'],
  nextRepairAction: 'Backfill a source-backed research description.',
  ...overrides,
});

describe('studentVisibilityGateService', () => {
  it('classifies missing-data reasons as blockers and evidence reasons as signals', () => {
    expect(isBlockingVisibilityReason('missing_description')).toBe(true);
    expect(isBlockingVisibilityReason('thin_description')).toBe(true);
    expect(isBlockingVisibilityReason('content_page_risk')).toBe(true);
    expect(isBlockingVisibilityReason('source_backed_description')).toBe(false);
    expect(isBlockingVisibilityReason('concrete_next_step')).toBe(false);
  });

  it('promotes public-safe records and resolves any open release queue item', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    const report = await runStudentVisibilityGateForPlans([safePlan()], {
      mode: 'apply',
      deps,
    });

    expect(report.counts).toMatchObject({ promoted: 1, held: 0, resolved: 1 });
    expect(deps.updateRecordVisibility).toHaveBeenCalledWith(
      'research',
      'entity-safe',
      expect.objectContaining({
        studentVisibilityTier: 'student_ready',
        studentVisibilityComputedTier: 'student_ready',
        studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      }),
    );
    expect(deps.resolveQueueItem).toHaveBeenCalledWith(
      'research',
      'entity-safe',
      expect.objectContaining({ resolvedByTier: 'student_ready' }),
    );
    expect(deps.upsertOpenQueueItem).not.toHaveBeenCalled();
  });

  it('holds unsafe records in the release queue with blockers and evidence signals split', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    const report = await runStudentVisibilityGateForPlans([heldPlan()], {
      mode: 'apply',
      deps,
    });

    expect(report.counts).toMatchObject({ promoted: 0, held: 1, resolved: 0 });
    expect(report.reasonCounts).toMatchObject({
      missing_description: 1,
      missing_action_evidence: 1,
      concrete_next_step: 1,
    });
    expect(deps.updateRecordVisibility).toHaveBeenCalledWith(
      'research',
      'entity-held',
      expect.objectContaining({ studentVisibilityTier: 'operator_review' }),
    );
    expect(deps.upsertOpenQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'research',
        recordId: 'entity-held',
        blockerReasons: ['missing_description', 'missing_action_evidence'],
        evidenceSignals: ['concrete_next_step'],
        status: 'open',
      }),
    );
    expect(deps.resolveQueueItem).not.toHaveBeenCalled();
  });

  it('dry-runs without writing visibility fields or queue rows', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    const report = await runStudentVisibilityGateForPlans([safePlan(), heldPlan()], {
      mode: 'dry-run',
      deps,
    });

    expect(report.mode).toBe('dry-run');
    expect(report.counts).toMatchObject({ scanned: 2, promoted: 1, held: 1, resolved: 1 });
    expect(deps.updateRecordVisibility).not.toHaveBeenCalled();
    expect(deps.upsertOpenQueueItem).not.toHaveBeenCalled();
    expect(deps.resolveQueueItem).not.toHaveBeenCalled();
  });
});
