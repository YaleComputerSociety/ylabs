/**
 * Department name parsing and abbreviation utilities.
 */

const PREFIXED_DEPARTMENT_PATTERN = /^([A-Za-z&/]+)\s*-\s*(.+)$/;

export interface DepartmentNameRecord {
  abbreviation?: string;
  name?: string;
  displayName?: string;
  aliases?: string[];
}

interface DepartmentLabelOptions {
  preferDisplayName?: boolean;
}

/**
 * Extract abbreviation from a department string.
 * Handles "ABBR - Name" format or returns first 4 chars uppercase.
 */
export const getDepartmentAbbreviation = (department: string): string => {
  const match = department.match(PREFIXED_DEPARTMENT_PATTERN);
  if (match) {
    return match[1].toUpperCase();
  }

  return department
    .replace(/[^a-zA-Z]/g, '')
    .substring(0, 4)
    .toUpperCase();
};

export const getDepartmentDisplayLabel = (department: string): string => {
  const value = department.trim();
  const match = value.match(PREFIXED_DEPARTMENT_PATTERN);
  return match ? match[2].trim() : value;
};

const normalizeDepartmentLabel = (department: string): string =>
  getDepartmentDisplayLabel(department)
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const buildDepartmentLabelMap = (
  departmentTable: DepartmentNameRecord[] | undefined,
  options: DepartmentLabelOptions = {},
): Map<string, string> => {
  const map = new Map<string, string>();

  for (const row of departmentTable || []) {
    const canonical = (
      (options.preferDisplayName ? row.displayName : '') ||
      row.name ||
      (row.displayName ? getDepartmentDisplayLabel(row.displayName) : '') ||
      ''
    ).trim();
    if (!canonical) continue;
    const values = [
      row.abbreviation,
      row.name,
      row.displayName,
      row.displayName ? getDepartmentDisplayLabel(row.displayName) : undefined,
      ...(row.aliases || []),
    ];

    for (const value of values) {
      if (!value) continue;
      const key = normalizeDepartmentLabel(value);
      if (key) map.set(key, canonical);
    }
  }

  return map;
};

export const getDepartmentCanonicalLabel = (
  department: string,
  departmentTable?: DepartmentNameRecord[],
  options?: DepartmentLabelOptions,
): string => {
  const labelMap = buildDepartmentLabelMap(departmentTable, options);
  const fallback = getDepartmentDisplayLabel(department);
  return labelMap.get(normalizeDepartmentLabel(department)) || fallback;
};

export const getUniqueDepartmentLabels = (
  departments: string[] | undefined,
  departmentTable?: DepartmentNameRecord[],
  options?: DepartmentLabelOptions,
): string[] => {
  const labels: string[] = [];
  const seen = new Set<string>();
  const labelMap = buildDepartmentLabelMap(departmentTable, options);

  for (const department of departments || []) {
    const fallback = getDepartmentDisplayLabel(department);
    const label = labelMap.get(normalizeDepartmentLabel(department)) || fallback;
    if (!label) continue;
    const key = normalizeDepartmentLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  return labels;
};
