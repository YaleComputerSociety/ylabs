import {
  decodeDirectoryExportDepartment,
  type CanonicalDepartment,
} from '../scrapers/utils/directoryExportDepartment';

export const DIRECTORY_EXPORT_DEPARTMENT_FIELDS = ['primaryDepartment', 'secondaryDepartments'];
export const DIRECTORY_EXPORT_DEPARTMENT_ROLLBACK_REASON =
  'directory export org-unit code stated as a department (#5796)';

export interface StoredDepartmentRow {
  id: string;
  primaryDepartment: string;
}

export interface StoredDepartmentPlan {
  canonical: Array<{ id: string; from: string; to: string }>;
  cleared: Array<{ id: string; from: string }>;
}

/**
 * The stored value for every researcher whose department is an export code: its catalog
 * department, or cleared when it decodes to none. A value that is not an export code is left
 * alone, so a real department another lane wrote is never touched.
 */
export function planStoredDirectoryExportDepartments(
  rows: StoredDepartmentRow[],
  canonicalDepartment: CanonicalDepartment,
): StoredDepartmentPlan {
  const plan: StoredDepartmentPlan = { canonical: [], cleared: [] };
  for (const row of rows) {
    const decoded = decodeDirectoryExportDepartment(row.primaryDepartment, canonicalDepartment);
    if (decoded.status === 'canonical') {
      if (decoded.department !== row.primaryDepartment) {
        plan.canonical.push({ id: row.id, from: row.primaryDepartment, to: decoded.department });
      }
    } else if (decoded.status === 'refused') {
      plan.cleared.push({ id: row.id, from: row.primaryDepartment });
    }
  }
  return plan;
}
