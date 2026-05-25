import { createHash } from 'crypto';

import { publicStudentVisibilityTiers } from '../models/studentVisibility';

export interface StudentVisibilityBackfillRunReport {
  mode: 'dry-run' | 'apply' | string;
  environment: string;
  db: string;
  collection: 'all' | 'research' | 'programs' | string;
  version: string;
  scanned: {
    research: number;
    programs: number;
  };
  counts: Record<string, number>;
  diagnostics: {
    applySafety: {
      safeToApply: boolean;
      recommendation: string;
      blockers: string[];
    };
    [key: string]: any;
  };
  samples: Record<string, unknown>;
}

export interface StudentVisibilityApprovalTarget {
  collection?: string;
  environment?: string;
  db?: string;
  version?: string;
}

export interface ApprovedStudentVisibilityReport {
  approved: true;
  target: {
    collection: string;
    environment: string;
    db: string;
    version: string;
  };
  reportHash: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function hashReport(report: StudentVisibilityBackfillRunReport): string {
  return createHash('sha256').update(JSON.stringify(stableValue(report))).digest('hex');
}

function totalScanned(report: StudentVisibilityBackfillRunReport): number {
  return Math.max(0, report.scanned?.research || 0) + Math.max(0, report.scanned?.programs || 0);
}

function publicCount(report: StudentVisibilityBackfillRunReport): number {
  return publicStudentVisibilityTiers.reduce(
    (total, tier) => total + Math.max(0, report.counts?.[tier] || 0),
    0,
  );
}

function assertTarget(report: StudentVisibilityBackfillRunReport, target?: StudentVisibilityApprovalTarget) {
  if (!target) return;
  for (const field of ['collection', 'environment', 'db', 'version'] as const) {
    if (target[field] && target[field] !== report[field]) {
      throw new Error(
        `Student visibility approval ${field} mismatch: expected ${target[field]}, got ${report[field]}.`,
      );
    }
  }
}

export function approveStudentVisibilityDryRunReport(
  report: StudentVisibilityBackfillRunReport,
  target?: StudentVisibilityApprovalTarget,
): ApprovedStudentVisibilityReport {
  assertTarget(report, target);

  if (report.mode !== 'dry-run') {
    throw new Error('Student visibility approval requires a dry-run report.');
  }
  if (totalScanned(report) === 0) {
    throw new Error('Student visibility approval requires at least one scanned row.');
  }
  if (publicCount(report) === 0) {
    throw new Error('Student visibility approval requires at least one public-tier row.');
  }
  if (!report.diagnostics?.applySafety?.safeToApply) {
    throw new Error('Student visibility approval requires safeToApply=true.');
  }
  if (report.diagnostics.applySafety.recommendation !== 'apply') {
    throw new Error('Student visibility approval requires an apply recommendation.');
  }

  return {
    approved: true,
    target: {
      collection: report.collection,
      environment: report.environment,
      db: report.db,
      version: report.version,
    },
    reportHash: hashReport(report),
  };
}

export function assertApprovedStudentVisibilityReport(
  report: StudentVisibilityBackfillRunReport,
  approval: ApprovedStudentVisibilityReport,
): void {
  if (!approval.approved) {
    throw new Error('Student visibility approval artifact is not approved.');
  }
  assertTarget(report, approval.target);
  if (hashReport(report) !== approval.reportHash) {
    throw new Error('Student visibility approval hash mismatch.');
  }
}
