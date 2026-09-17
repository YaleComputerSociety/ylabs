export const SCHOOL_AS_DEPARTMENT_ROLLBACK_REASON =
  'school-wide faculty directory reported its school as a department (#2838)';

export interface SchoolAsDepartmentObservationRow {
  id: string;
  entityKey: string;
  field: string;
  value: unknown;
  sourceUrl?: string;
}

export interface SchoolAsDepartmentPlanRow {
  entityKey: string;
  observationIds: string[];
  fields: string[];
  claimedDepartment: string;
}

export interface SchoolAsDepartmentPlan {
  scanned: number;
  rows: SchoolAsDepartmentPlanRow[];
  observationsToRetire: number;
  skippedNotASchool: number;
}

const firstStringValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim());
    return typeof first === 'string' ? first.trim() : '';
  }
  return '';
};

/**
 * Groups the department-claiming observations whose value is a school into one row
 * per person, so the retirement and the re-materialize that follows it are both
 * keyed the way the materializer is.
 *
 * `isSchoolName` is supplied by the caller from the live `org_units` catalog rather
 * than hardcoded, so the repair covers every lane that ever stamped a school into
 * the department slot instead of only the two that do today.
 */
export function planSchoolAsDepartmentRetirement(
  observations: SchoolAsDepartmentObservationRow[],
  isSchoolName: (value: string) => boolean,
): SchoolAsDepartmentPlan {
  const byEntityKey = new Map<string, SchoolAsDepartmentPlanRow>();
  let skippedNotASchool = 0;

  for (const observation of observations) {
    const claimed = firstStringValue(observation.value);
    if (!claimed || !isSchoolName(claimed)) {
      skippedNotASchool += 1;
      continue;
    }
    const existing = byEntityKey.get(observation.entityKey);
    if (existing) {
      existing.observationIds.push(observation.id);
      if (!existing.fields.includes(observation.field)) existing.fields.push(observation.field);
      continue;
    }
    byEntityKey.set(observation.entityKey, {
      entityKey: observation.entityKey,
      observationIds: [observation.id],
      fields: [observation.field],
      claimedDepartment: claimed,
    });
  }

  const rows = [...byEntityKey.values()].sort((left, right) =>
    left.entityKey.localeCompare(right.entityKey),
  );
  return {
    scanned: observations.length,
    rows,
    observationsToRetire: rows.reduce((total, row) => total + row.observationIds.length, 0),
    skippedNotASchool,
  };
}
