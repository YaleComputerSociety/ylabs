import {
  buildOrgUnitResolverIndex,
  orgUnitMatchKey,
  resolveOrgUnitCanonical,
  type OrgUnitCanonical,
} from '../scrapers/orgUnitCanonicalization';
import type { OrgUnitKind } from '../models/orgUnit';

export interface DepartmentFacetAuditEntity {
  departments?: unknown;
  orgAffiliationLabels?: unknown;
}

export interface DepartmentFacetAuditRow {
  label: string;
  servedRows: number;
}

export interface DepartmentFacetAudit {
  servedRows: number;
  canonicalFacetValues: DepartmentFacetAuditRow[];
  /**
   * Labels a source presented as a department that no `org_units` row names. Most
   * are legitimately not departments (centers, hospital systems, graduate program
   * tracks, clinical sections, donor societies), so this is catalog debt to triage
   * by volume rather than a defect count to drive to zero (#2194).
   */
  uncatalogedLabels: DepartmentFacetAuditRow[];
  rowsWithNoCanonicalDepartment: number;
}

const DEPARTMENT_FACET_KINDS: OrgUnitKind[] = ['DEPARTMENT', 'DIVISION'];

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const byServedRowsDescending = (
  left: DepartmentFacetAuditRow,
  right: DepartmentFacetAuditRow,
): number => right.servedRows - left.servedRows || left.label.localeCompare(right.label);

function tallyRows(counts: Map<string, number>): DepartmentFacetAuditRow[] {
  return [...counts.entries()]
    .map(([label, servedRows]) => ({ label, servedRows }))
    .sort(byServedRowsDescending);
}

export function auditDepartmentFacetCatalog(
  entities: DepartmentFacetAuditEntity[],
  orgUnitRows: { slug: string; name: string; kind: OrgUnitKind; aliases?: string[] }[],
): DepartmentFacetAudit {
  const index: Map<string, OrgUnitCanonical> = buildOrgUnitResolverIndex(orgUnitRows);
  const canonical = new Map<string, number>();
  const uncataloged = new Map<string, number>();
  let rowsWithNoCanonicalDepartment = 0;

  for (const entity of entities) {
    const departments = asStringList(entity.departments)
      .map((value) => value.trim())
      .filter(Boolean);
    for (const label of new Set(departments)) {
      canonical.set(label, (canonical.get(label) ?? 0) + 1);
    }
    if (departments.length === 0) rowsWithNoCanonicalDepartment += 1;

    const labels = asStringList(entity.orgAffiliationLabels)
      .map((value) => value.trim())
      .filter(Boolean);
    for (const label of new Set(labels)) {
      if (resolveOrgUnitCanonical(index, label, DEPARTMENT_FACET_KINDS)) continue;
      if (!orgUnitMatchKey(label)) continue;
      uncataloged.set(label, (uncataloged.get(label) ?? 0) + 1);
    }
  }

  return {
    servedRows: entities.length,
    canonicalFacetValues: tallyRows(canonical),
    uncatalogedLabels: tallyRows(uncataloged),
    rowsWithNoCanonicalDepartment,
  };
}
