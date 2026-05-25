import { describe, expect, it } from 'vitest';

import {
  approveStudentVisibilityDryRunReport,
  assertApprovedStudentVisibilityReport,
  type StudentVisibilityBackfillRunReport,
} from '../studentVisibilityApprovalRules';

const baseReport = (
  overrides: Partial<StudentVisibilityBackfillRunReport> = {},
): StudentVisibilityBackfillRunReport => ({
  mode: 'dry-run',
  environment: 'development',
  db: 'ylabs-dev',
  collection: 'research',
  version: 'student-visibility-v1',
  scanned: { research: 2, programs: 0 },
  counts: { student_ready: 1, operator_review: 1 },
  diagnostics: {
    research: {
      scanned: 2,
      publicCount: 1,
      applySafety: {
        safeToApply: true,
        recommendation: 'apply',
        blockers: [],
      },
    },
    programs: {
      scanned: 0,
      publicCount: 0,
      applySafety: {
        safeToApply: true,
        recommendation: 'apply',
        blockers: [],
      },
    },
    applySafety: {
      safeToApply: true,
      recommendation: 'apply',
      blockers: [],
    },
  },
  samples: { research: [], programs: [] },
  ...overrides,
});

describe('studentVisibilityApprovalRules', () => {
  it('approves a safe dry-run report and verifies the matching artifact', () => {
    const report = baseReport();
    const approval = approveStudentVisibilityDryRunReport(report, {
      collection: 'research',
      environment: 'development',
      db: 'ylabs-dev',
      version: 'student-visibility-v1',
    });

    expect(approval.approved).toBe(true);
    expect(approval.target).toMatchObject({
      collection: 'research',
      environment: 'development',
      db: 'ylabs-dev',
      version: 'student-visibility-v1',
    });

    expect(() => assertApprovedStudentVisibilityReport(report, approval)).not.toThrow();
  });

  it('rejects reports that are not safe dry-run apply recommendations', () => {
    const rejectedReports = [
      baseReport({ mode: 'apply' }),
      baseReport({ scanned: { research: 0, programs: 0 } }),
      baseReport({ counts: { operator_review: 2 } }),
      baseReport({
        diagnostics: {
          ...baseReport().diagnostics,
          applySafety: {
            safeToApply: false,
            recommendation: 'repair_source_materialization_first',
            blockers: ['public collapse'],
          },
        },
      }),
      baseReport({
        diagnostics: {
          ...baseReport().diagnostics,
          applySafety: {
            safeToApply: true,
            recommendation: 'repair_source_materialization_first',
            blockers: [],
          },
        },
      }),
    ];

    for (const report of rejectedReports) {
      expect(() => approveStudentVisibilityDryRunReport(report)).toThrow();
    }
  });

  it('rejects intended target mismatches and tampered reports', () => {
    const report = baseReport();
    expect(() =>
      approveStudentVisibilityDryRunReport(report, {
        collection: 'programs',
        environment: 'development',
        db: 'ylabs-dev',
        version: 'student-visibility-v1',
      }),
    ).toThrow(/collection/);

    const approval = approveStudentVisibilityDryRunReport(report);
    expect(() =>
      assertApprovedStudentVisibilityReport(
        baseReport({ counts: { student_ready: 0, operator_review: 2 } }),
        approval,
      ),
    ).toThrow(/hash/);
  });
});
