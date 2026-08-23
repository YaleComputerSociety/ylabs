/**
 * Read-time canonicalization of a researcher's raw HR/Workday `primaryDepartment`
 * for the detail-page PI/lead affiliation pill. Mirrors the intent of the
 * server-side org-unit denoise the browse facet relies on: strip the HR-code
 * chrome, then trust the remainder only when it resolves to a real department
 * (a configured department or one of the entity's already-clean departments).
 * Anything else canonicalizes to null so chrome never reaches a student.
 */
import {
  DepartmentNameRecord,
  getDepartmentCanonicalLabel,
  getDepartmentDisplayLabel,
} from './departmentNames';

const LEADING_ORG_CODE_PATTERN = /^([A-Z][A-Z0-9]{1,6})\s+(?=.*[a-z])(.+)$/;
const TRAILING_BUSINESS_OPERATIONS_PATTERN = /\s+business operations\s*$/i;
const TRAILING_ALL_QUALIFIER_PATTERN = /\s*-\s*all\s*$/i;

const ADMINISTRATIVE_ONLY_KEYS = new Set(
  ['Administration', 'None', 'Social Sciences', 'Veterinary Sciences'].map(normalizeDepartmentKey),
);

function normalizeDepartmentKey(value: string): string {
  return getDepartmentDisplayLabel(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripHrOrgUnitChrome(value: string): string {
  let cleaned = value;
  const codeMatch = cleaned.match(LEADING_ORG_CODE_PATTERN);
  if (codeMatch && codeMatch[2].trim().length >= 3) {
    cleaned = codeMatch[2].trim();
  }
  let previous = '';
  while (previous !== cleaned) {
    previous = cleaned;
    cleaned = cleaned
      .replace(TRAILING_BUSINESS_OPERATIONS_PATTERN, '')
      .replace(TRAILING_ALL_QUALIFIER_PATTERN, '')
      .trim();
  }
  return cleaned;
}

const collectDepartmentKeys = (values: Array<string | undefined | null>): Set<string> =>
  new Set(
    values
      .filter((value): value is string => Boolean(value && value.trim()))
      .map(normalizeDepartmentKey)
      .filter(Boolean),
  );

export const canonicalizeResearcherDepartmentLabel = (
  rawDepartment: string | undefined | null,
  departmentTable?: DepartmentNameRecord[],
  entityDepartments: Array<string | undefined | null> = [],
): string | null => {
  const base = (rawDepartment || '').trim().replace(/\s+/g, ' ');
  if (!base) return null;

  const cleaned = stripHrOrgUnitChrome(base);
  if (!cleaned) return null;

  const canonical = getDepartmentCanonicalLabel(cleaned, departmentTable);
  const canonicalKey = normalizeDepartmentKey(canonical);
  if (!canonicalKey || ADMINISTRATIVE_ONLY_KEYS.has(canonicalKey)) return null;

  const hadHrChrome = cleaned !== base;
  if (!hadHrChrome) return canonical;

  const configuredKeys = collectDepartmentKeys(
    (departmentTable || []).map(
      (row) =>
        row.name || (row.displayName ? getDepartmentDisplayLabel(row.displayName) : '') || '',
    ),
  );
  if (configuredKeys.has(canonicalKey)) return canonical;

  const entityKeys = collectDepartmentKeys(entityDepartments);
  if (entityKeys.has(canonicalKey)) return canonical;

  return null;
};
