import { describe, expect, it } from 'vitest';
import { approveStudentVisibilityBackfill } from '../studentVisibilityApprovalRules';

describe('approveStudentVisibilityBackfill', () => {
  it('approves a safe dry-run report with public-tier rows', () => {
    const result = approveStudentVisibilityBackfill({
      mode: 'dry-run',
      scanned: { research: 3, programs: 0 },
      counts: { student_ready: 1, limited_but_safe: 2 },
      diagnostics: {
        applySafety: {
          safeToApply: true,
          recommendation: 'apply',
          blockers: [],
        },
      },
    });

    expect(result).toEqual({
      approved: true,
      approvedForApply: true,
      reasons: [
        'Dry-run report is safe to apply under current student-visibility rules.',
        'Scanned 3 record(s) with 3 public-tier record(s).',
      ],
      blockers: [],
    });
  });

  it('blocks apply-mode, unsafe, or empty-public reports', () => {
    const result = approveStudentVisibilityBackfill({
      mode: 'apply',
      scanned: { research: 3, programs: 0 },
      counts: { operator_review: 3 },
      diagnostics: {
        applySafety: {
          safeToApply: false,
          recommendation: 'repair_source_materialization_first',
          blockers: ['research computed public tier count 0 is below minimum 1'],
        },
      },
    });

    expect(result.approved).toBe(false);
    expect(result.approvedForApply).toBe(false);
    expect(result.blockers).toEqual([
      'Expected dry-run report, got apply.',
      'research computed public tier count 0 is below minimum 1',
      'Backfill recommendation is repair_source_materialization_first, not apply.',
      'Backfill report has zero public-tier records.',
    ]);
  });
});
