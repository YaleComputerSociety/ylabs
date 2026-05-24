import {
  summarizeIssueCounts,
  type CoverageAuditRow,
} from './researchEntityCoverageAuditCore';

export const DEFAULT_REPAIR_ISSUES = [
  'NO_DEPARTMENTS',
  'INFERRED_PI_WITHOUT_MEMBERSHIP',
  'MISSING_DESCRIPTION',
  'NO_RESEARCH_AREAS',
  'NO_PUBLIC_CONTACT_ROUTE',
  'NO_PATHWAYS',
  'MICROSITE_OBSERVED_NO_ACTIONABLE_ARTIFACTS',
] as const;

export function parseIssueList(value?: string): string[] {
  if (!value) return [...DEFAULT_REPAIR_ISSUES];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function selectRepairRows(
  rows: CoverageAuditRow[],
  issueFilter: string[],
): CoverageAuditRow[] {
  if (issueFilter.length === 0) return rows;
  const issues = new Set(issueFilter);
  return rows.filter((row) => row.issues.some((issue) => issues.has(issue)));
}

export function summarizeRepairRows(rows: CoverageAuditRow[]) {
  return {
    selectedCount: rows.length,
    issueCounts: summarizeIssueCounts(rows),
    averageIssueScore:
      rows.length === 0
        ? 0
        : Math.round(
            (rows.reduce((total, row) => total + row.issueScore, 0) / rows.length) * 100,
          ) / 100,
  };
}
