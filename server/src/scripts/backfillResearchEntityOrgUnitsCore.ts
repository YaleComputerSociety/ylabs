import {
  applyResearchEntityOrgUnitCanonicalization,
  type OrgUnitCanonicalizer,
  setOrgUnitCanonicalizerForTesting,
} from '../scrapers/orgUnitCanonicalization';

export interface OrgUnitBackfillEntity {
  id: string;
  slug?: string;
  name?: string;
  school?: unknown;
  departments?: unknown;
  schools?: unknown;
}

export interface OrgUnitBackfillPlanRow {
  id: string;
  slug?: string;
  name?: string;
  changed: boolean;
  update: Record<string, unknown>;
  beforeSchool?: unknown;
  afterSchool?: unknown;
  beforeDepartments: string[];
  afterDepartments: string[];
  droppedDepartments: string[];
  beforeSchools: string[];
  afterSchools: string[];
}

export interface OrgUnitBackfillSummary {
  scanned: number;
  changed: number;
  departmentsDropped: number;
  schoolRewrites: number;
  departmentRewrites: number;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const sameStringArray = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export async function planOrgUnitBackfillRow(
  entity: OrgUnitBackfillEntity,
): Promise<OrgUnitBackfillPlanRow> {
  const hasSchool = Object.prototype.hasOwnProperty.call(entity, 'school');
  const hasDepartments = Object.prototype.hasOwnProperty.call(entity, 'departments');
  const set: Record<string, unknown> = {};
  if (hasSchool) set.school = entity.school;
  if (hasDepartments) set.departments = entity.departments;

  const canonicalization = await applyResearchEntityOrgUnitCanonicalization(set, {
    school: entity.school,
    departments: entity.departments,
  });

  const beforeDepartments = asStringArray(entity.departments);
  const afterDepartments = asStringArray(set.departments);
  const beforeSchools = asStringArray(entity.schools);
  const afterSchools = asStringArray(set.schools);

  const update: Record<string, unknown> = {};
  if (hasSchool && set.school !== entity.school) update.school = set.school;
  if (hasDepartments && !sameStringArray(beforeDepartments, afterDepartments)) {
    update.departments = afterDepartments;
  }
  if (!sameStringArray(beforeSchools, afterSchools)) update.schools = afterSchools;

  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    changed: Object.keys(update).length > 0,
    update,
    beforeSchool: entity.school,
    afterSchool: set.school,
    beforeDepartments,
    afterDepartments,
    droppedDepartments: canonicalization.droppedDepartments,
    beforeSchools,
    afterSchools,
  };
}

export function summarizeOrgUnitBackfill(rows: OrgUnitBackfillPlanRow[]): OrgUnitBackfillSummary {
  let changed = 0;
  let departmentsDropped = 0;
  let schoolRewrites = 0;
  let departmentRewrites = 0;
  for (const row of rows) {
    if (row.changed) changed += 1;
    departmentsDropped += row.droppedDepartments.length;
    if ('school' in row.update) schoolRewrites += 1;
    if ('departments' in row.update) departmentRewrites += 1;
  }
  return {
    scanned: rows.length,
    changed,
    departmentsDropped,
    schoolRewrites,
    departmentRewrites,
  };
}

export function useOrgUnitCanonicalizerForBackfill(
  canonicalizer: OrgUnitCanonicalizer | null,
): void {
  setOrgUnitCanonicalizerForTesting(canonicalizer);
}
