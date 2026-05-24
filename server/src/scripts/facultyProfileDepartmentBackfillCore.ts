import { canonicalizeProfileDepartmentsFromRows } from '../services/departmentResolver';

export interface FacultyProfileDepartmentUser {
  _id: unknown;
  netid?: string;
  fname?: string;
  lname?: string;
  userType?: string;
  primaryDepartment?: string;
  secondaryDepartments?: string[];
  departments?: string[];
}

export interface FacultyProfileDepartmentPlanRow {
  id: string;
  netid: string;
  name: string;
  before: {
    primaryDepartment: string;
    secondaryDepartments: string[];
    departments: string[];
  };
  after: {
    primaryDepartment: string;
    secondaryDepartments: string[];
    departments: string[];
  };
  unresolved: string[];
  ignored: string[];
}

export interface FacultyProfileDepartmentBackfillPlan {
  summary: {
    scanned: number;
    plannedUpdates: number;
    skippedUnresolved: number;
    unresolvedLabels: number;
    ignoredLabels: number;
  };
  planned: FacultyProfileDepartmentPlanRow[];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function planFacultyProfileDepartmentBackfill(
  users: FacultyProfileDepartmentUser[],
  departments: Parameters<typeof canonicalizeProfileDepartmentsFromRows>[1],
): FacultyProfileDepartmentBackfillPlan {
  const planned: FacultyProfileDepartmentPlanRow[] = [];
  let skippedUnresolved = 0;
  let unresolvedLabels = 0;
  let ignoredLabels = 0;

  for (const user of users) {
    const before = {
      primaryDepartment: String(user.primaryDepartment || '').trim(),
      secondaryDepartments: stringArray(user.secondaryDepartments),
      departments: stringArray(user.departments),
    };
    const canonical = canonicalizeProfileDepartmentsFromRows(before, departments);
    unresolvedLabels += canonical.unresolved.length;
    ignoredLabels += canonical.ignored.length;
    if (canonical.unresolved.length > 0) {
      skippedUnresolved += 1;
      continue;
    }

    const after = {
      primaryDepartment: canonical.primaryDepartment,
      secondaryDepartments: canonical.secondaryDepartments,
      departments: canonical.departments,
    };

    if (
      before.primaryDepartment === after.primaryDepartment &&
      arraysEqual(before.secondaryDepartments, after.secondaryDepartments) &&
      arraysEqual(before.departments, after.departments)
    ) {
      continue;
    }

    if (!after.primaryDepartment && after.departments.length === 0) continue;

    planned.push({
      id: String(user._id),
      netid: String(user.netid || ''),
      name: [user.fname, user.lname].filter(Boolean).join(' '),
      before,
      after,
      unresolved: canonical.unresolved,
      ignored: canonical.ignored,
    });
  }

  return {
    summary: {
      scanned: users.length,
      plannedUpdates: planned.length,
      skippedUnresolved,
      unresolvedLabels,
      ignoredLabels,
    },
    planned,
  };
}
