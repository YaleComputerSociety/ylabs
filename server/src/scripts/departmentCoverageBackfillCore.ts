import {
  canonicalizeDepartmentListFromRows,
  type CanonicalDepartmentListResult,
} from '../services/departmentResolver';

export interface DepartmentBackfillEntity {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  departments?: string[];
  manuallyLockedFields?: string[];
}

export interface DepartmentBackfillPlanRow {
  id: string;
  slug: string;
  name: string;
  before: string[];
  after: string[];
  unresolved: string[];
  ignored: string[];
}

export interface DepartmentBackfillPlan {
  summary: {
    scanned: number;
    plannedUpdates: number;
    skippedLocked: number;
    unresolvedLabels: number;
    ignoredLabels: number;
  };
  planned: DepartmentBackfillPlanRow[];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function planDepartmentCoverageBackfill(
  entities: DepartmentBackfillEntity[],
  departments: Parameters<typeof canonicalizeDepartmentListFromRows>[1],
): DepartmentBackfillPlan {
  const planned: DepartmentBackfillPlanRow[] = [];
  let skippedLocked = 0;
  let unresolvedLabels = 0;
  let ignoredLabels = 0;

  for (const entity of entities) {
    const locked = stringArray(entity.manuallyLockedFields).includes('departments');
    if (locked) {
      skippedLocked += 1;
      continue;
    }

    const before = stringArray(entity.departments);
    const canonical: CanonicalDepartmentListResult = canonicalizeDepartmentListFromRows(
      before,
      departments,
    );
    unresolvedLabels += canonical.unresolved.length;
    ignoredLabels += canonical.ignored.length;
    if (canonical.unresolved.length > 0) continue;
    if (canonical.departments.length === 0 || arraysEqual(before, canonical.departments)) continue;

    planned.push({
      id: String(entity._id),
      slug: String(entity.slug || ''),
      name: String(entity.displayName || entity.name || ''),
      before,
      after: canonical.departments,
      unresolved: canonical.unresolved,
      ignored: canonical.ignored,
    });
  }

  return {
    summary: {
      scanned: entities.length,
      plannedUpdates: planned.length,
      skippedLocked,
      unresolvedLabels,
      ignoredLabels,
    },
    planned,
  };
}
