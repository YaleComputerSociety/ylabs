import { describe, expect, it } from 'vitest';
import {
  planYaleStatusCacheBackfill,
  type YaleStatusCacheDoc,
} from '../backfillYaleStatusCacheCore';

const baseDoc: YaleStatusCacheDoc = {
  id: 'entity-1',
  label: 'Claude Rawson Research',
  activeAtYaleCache: true,
  yaleStatusCache: 'unknown',
  studentVisibilityTier: 'student_ready',
  shortDescription:
    'Studies eighteenth-century English literature, satire, and the works of Jonathan Swift.',
  fullDescription:
    'Claude Rawson studies eighteenth-century English literature, satire, and the works of Jonathan Swift. Current projects examine the reception of Swift among later satirists.',
  sourceUrls: ['https://english.yale.edu/in-memoriam/claude-rawson'],
};

describe('planYaleStatusCacheBackfill', () => {
  it('skips entities with no yale-status signal', () => {
    const plan = planYaleStatusCacheBackfill([
      { ...baseDoc, sourceUrls: ['https://english.yale.edu/people/claude-rawson'] },
    ]);

    expect(plan.scanned).toBe(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.flipToSuppressedCount).toBe(0);
  });

  it('plans a departed-marked entity to gain the cache value and flip to suppressed', () => {
    const plan = planYaleStatusCacheBackfill([baseDoc]);

    expect(plan.scanned).toBe(1);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]).toMatchObject({
      id: 'entity-1',
      reason: 'deceased',
      previousActiveAtYaleCache: true,
      previousStudentVisibilityTier: 'student_ready',
      nextStudentVisibilityTier: 'suppressed',
      willFlipToSuppressed: true,
    });
    expect(plan.countsByReason).toEqual({ deceased: 1 });
    expect(plan.flipToSuppressedCount).toBe(1);
  });

  it('does not double count an entity that is already suppressed', () => {
    const plan = planYaleStatusCacheBackfill([{ ...baseDoc, studentVisibilityTier: 'suppressed' }]);

    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].willFlipToSuppressed).toBe(false);
    expect(plan.flipToSuppressedCount).toBe(0);
  });

  it('preserves the prior real reasons and appends inactive_at_yale rather than fabricating a fresh reason set', () => {
    const plan = planYaleStatusCacheBackfill([
      {
        ...baseDoc,
        studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      },
    ]);

    expect(plan.toUpdate[0].nextStudentVisibilityReasons).toEqual(
      expect.arrayContaining([
        'source_backed_description',
        'concrete_next_step',
        'inactive_at_yale',
      ]),
    );
  });

  it('preserves an explicit operator override tier instead of forcing suppressed', () => {
    const plan = planYaleStatusCacheBackfill([
      {
        ...baseDoc,
        studentVisibilityOverrideTier: 'student_ready',
      },
    ]);

    expect(plan.toUpdate[0]).toMatchObject({
      nextStudentVisibilityTier: 'student_ready',
      nextStudentVisibilityComputedTier: 'suppressed',
      operatorOverridePreserved: true,
      willFlipToSuppressed: false,
    });
  });
});
