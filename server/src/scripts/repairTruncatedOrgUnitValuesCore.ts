import { denoiseOrgUnitValue, orgUnitMatchKey } from '../scrapers/orgUnitCanonicalization';

/**
 * The pre-#2502 denoiser, reproduced so each row's repair is derived from its own
 * evidence rather than from a hand-written list of bad strings.
 *
 * It stripped any leading all-caps token of two to seven characters as a Yale HR
 * org code, which truncated `"MR Core"` to `"Core"` and `"YCRG Operations"` to
 * `"Operations"` - the latter resolving to the School of Management's Operations
 * department on served rows (#2500).
 */
const PRE_FIX_LEADING_TOKEN = /^([A-Z][A-Z0-9]{1,6})\s+(?=.*[a-z])(.+)$/;

export function preFixDenoiseOrgUnitValue(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(PRE_FIX_LEADING_TOKEN);
  if (!match) return trimmed;
  const remainder = match[2].trim();
  return remainder.length >= 3 ? remainder : trimmed;
}

export interface TruncatedValueRepairEntity {
  slug: string;
  departments?: unknown;
  orgAffiliationLabels?: unknown;
  studentVisibilityTier?: unknown;
}

export type TruncatedValueRepairPlacement = 'department' | 'affiliation';

export interface TruncatedValueRepair {
  raw: string;
  truncated: string;
  placement: TruncatedValueRepairPlacement;
  field: 'departments' | 'orgAffiliationLabels';
}

export interface TruncatedValueRepairPlanRow {
  slug: string;
  tier: string;
  repairs: TruncatedValueRepair[];
  skippedIndependent: { raw: string; truncated: string }[];
  beforeDepartments: string[];
  afterDepartments: string[];
  beforeOrgAffiliationLabels: string[];
  afterOrgAffiliationLabels: string[];
  changed: boolean;
  update: Record<string, unknown>;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const sameKey = (left: string, right: string): boolean =>
  Boolean(orgUnitMatchKey(left)) && orgUnitMatchKey(left) === orgUnitMatchKey(right);

/**
 * Restores the values a false HR-code strip truncated, using the row's own
 * non-superseded `departments` observations as the source of the untruncated form.
 *
 * Placement is decided by the shared canonicalizer rather than assumed: a restored
 * value that resolves to a real department goes back to `departments`, and one that
 * does not becomes an affiliation label, exactly as ingest would place it now.
 *
 * A truncated form that another raw value on the same row independently asserts is
 * skipped, never repaired. `ysm-faculty-joseph-king` is the case that makes this
 * load-bearing: its observation carries both `"Neurosurgery"` and
 * `"VA Neurosurgery"`, so removing the truncation would delete a real department.
 */
export function planTruncatedValueRepair(
  entity: TruncatedValueRepairEntity,
  observedRawValues: string[],
  canonicalizeDepartment: (value: string) => string | null,
): TruncatedValueRepairPlanRow {
  const beforeDepartments = asStringArray(entity.departments);
  const beforeOrgAffiliationLabels = asStringArray(entity.orgAffiliationLabels);
  const departments = [...beforeDepartments];
  const labels = [...beforeOrgAffiliationLabels];
  const repairs: TruncatedValueRepair[] = [];
  const skippedIndependent: { raw: string; truncated: string }[] = [];

  const raws = [...new Set(observedRawValues.map((value) => value.trim()).filter(Boolean))];
  for (const raw of raws) {
    const truncated = preFixDenoiseOrgUnitValue(raw);
    if (truncated === raw) continue;
    // Still stripped by the current denoiser, so it is a genuine HR code and the
    // stored short form is correct.
    if (denoiseOrgUnitValue(raw) !== raw) continue;

    const field = departments.includes(truncated)
      ? 'departments'
      : labels.includes(truncated)
        ? 'orgAffiliationLabels'
        : null;
    if (!field) continue;

    if (raws.some((other) => other !== raw && sameKey(other, truncated))) {
      skippedIndependent.push({ raw, truncated });
      continue;
    }

    if (field === 'departments') departments.splice(departments.indexOf(truncated), 1);
    else labels.splice(labels.indexOf(truncated), 1);

    const canonical = canonicalizeDepartment(raw);
    const placement: TruncatedValueRepairPlacement = canonical ? 'department' : 'affiliation';
    const restored = canonical || raw;
    if (placement === 'department') {
      if (!departments.includes(restored)) departments.push(restored);
    } else if (!labels.includes(restored)) {
      labels.push(restored);
    }
    repairs.push({ raw, truncated, placement, field });
  }

  const update: Record<string, unknown> = {};
  const sameList = (left: string[], right: string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  if (!sameList(beforeDepartments, departments)) update.departments = departments;
  if (!sameList(beforeOrgAffiliationLabels, labels)) update.orgAffiliationLabels = labels;

  return {
    slug: entity.slug,
    tier: text(entity.studentVisibilityTier),
    repairs,
    skippedIndependent,
    beforeDepartments,
    afterDepartments: departments,
    beforeOrgAffiliationLabels,
    afterOrgAffiliationLabels: labels,
    changed: Object.keys(update).length > 0,
    update,
  };
}

export function summarizeTruncatedValueRepair(rows: TruncatedValueRepairPlanRow[]): {
  scanned: number;
  changed: number;
  departmentRepairs: number;
  affiliationRepairs: number;
  skippedIndependent: number;
  servedChanged: number;
} {
  let departmentRepairs = 0;
  let affiliationRepairs = 0;
  let skippedIndependent = 0;
  for (const row of rows) {
    for (const repair of row.repairs) {
      if (repair.field === 'departments') departmentRepairs += 1;
      else affiliationRepairs += 1;
    }
    skippedIndependent += row.skippedIndependent.length;
  }
  return {
    scanned: rows.length,
    changed: rows.filter((row) => row.changed).length,
    departmentRepairs,
    affiliationRepairs,
    skippedIndependent,
    servedChanged: rows.filter((row) => row.changed && row.tier === 'student_ready').length,
  };
}
