/**
 * Read-time canonicalization of a researcher's raw HR/Workday `primaryDepartment`
 * for the detail-page PI/lead affiliation pill: strip the HR-code chrome, then
 * trust the remainder only when it names a real department or division.
 *
 * "Real" is decided by `pillEligibleLabels`, served from `org_units` - the same
 * authority the entity's own `departments` are canonicalized against. The local
 * department name table cannot answer this, because it carries no org-unit kind,
 * so schools in it passed as departments while real departments absent from it
 * were shown only by accident (#2860). Anything unresolved canonicalizes to null.
 */
import {
  DepartmentNameRecord,
  getDepartmentCanonicalLabel,
  getDepartmentDisplayLabel,
} from './departmentNames';

const LEADING_ORG_CODE_PATTERN = /^([A-Z][A-Z0-9]{1,6})\s+(.+)$/;
const LEADING_UNIT_NOUN_PATTERN = /^(?:the\s+)?(?:department|dept|division)\s+of\s+/i;
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
  let cleaned = value.replace(LEADING_UNIT_NOUN_PATTERN, '');
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

const collectDepartmentKeys = (values: readonly (string | undefined | null)[]): Set<string> =>
  new Set(
    values
      .filter((value): value is string => Boolean(value && value.trim()))
      .map(normalizeDepartmentKey)
      .filter(Boolean),
  );

export interface ResearcherDepartmentLabelOptions {
  pillEligibleLabels: readonly string[];
  entityDepartments?: Array<string | undefined | null>;
}

export const canonicalizeResearcherDepartmentLabel = (
  rawDepartment: string | undefined | null,
  departmentTable: DepartmentNameRecord[] | undefined,
  { pillEligibleLabels, entityDepartments = [] }: ResearcherDepartmentLabelOptions,
): string | null => {
  const base = (rawDepartment || '').trim().replace(/\s+/g, ' ');
  if (!base) return null;

  const cleaned = stripHrOrgUnitChrome(base);
  if (!cleaned) return null;

  const canonical = getDepartmentCanonicalLabel(cleaned, departmentTable);
  const canonicalKey = normalizeDepartmentKey(canonical);
  if (!canonicalKey || ADMINISTRATIVE_ONLY_KEYS.has(canonicalKey)) return null;

  const eligibleKeys = collectDepartmentKeys(pillEligibleLabels);
  if (eligibleKeys.has(canonicalKey)) return canonical;

  const entityKeys = collectDepartmentKeys(entityDepartments);
  if (entityKeys.has(canonicalKey)) return canonical;

  return null;
};
