export interface StudentVisibilityBackfillDryRunReport {
  mode?: string;
  environment?: string;
  db?: string;
  collection?: string;
  version?: string;
  scanned?: {
    research?: number;
    programs?: number;
  };
  counts?: Record<string, number>;
  diagnostics?: {
    applySafety?: {
      safeToApply?: boolean;
      recommendation?: string;
      blockers?: string[];
    };
  };
}

export interface StudentVisibilityApprovalDecision {
  approved: boolean;
  approvedForApply: boolean;
  reasons: string[];
  blockers: string[];
}

export function approveStudentVisibilityBackfill(
  report: StudentVisibilityBackfillDryRunReport,
): StudentVisibilityApprovalDecision {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const scannedResearch = report.scanned?.research || 0;
  const scannedPrograms = report.scanned?.programs || 0;
  const scannedTotal = scannedResearch + scannedPrograms;
  const safety = report.diagnostics?.applySafety;

  if (report.mode !== 'dry-run') {
    blockers.push(`Expected dry-run report, got ${report.mode || 'unknown'}.`);
  }
  if (scannedTotal === 0) {
    blockers.push('Backfill report scanned zero records.');
  }
  if (!safety?.safeToApply) {
    blockers.push(...(safety?.blockers || ['Backfill safety gate did not mark the report safe.']));
  }
  if (safety?.recommendation && safety.recommendation !== 'apply') {
    blockers.push(`Backfill recommendation is ${safety.recommendation}, not apply.`);
  }

  const publicCount =
    (report.counts?.student_ready || 0) + (report.counts?.limited_but_safe || 0);
  if (publicCount === 0) {
    blockers.push('Backfill report has zero public-tier records.');
  }

  if (blockers.length === 0) {
    reasons.push('Dry-run report is safe to apply under current student-visibility rules.');
    reasons.push(`Scanned ${scannedTotal} record(s) with ${publicCount} public-tier record(s).`);
  }

  return {
    approved: blockers.length === 0,
    approvedForApply: blockers.length === 0,
    reasons,
    blockers,
  };
}
