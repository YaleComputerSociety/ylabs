/**
 * Department matching and the lab-science rule for named undergraduate research advisers
 * (#5473). A page that names an adviser beside an undergraduate's project is hosting evidence
 * only for lab-based sciences (owner decision, 2026-11-08): a humanities or social-science
 * essay adviser is not evidence that a student was in a lab.
 */

export type UndergradHostingRule = 'lab-science-program' | 'lab-science-adviser-department';

export const LAB_SCIENCE_ADVISER_DEPARTMENTS: readonly string[] = [
  'Psychology',
  'Psychiatry',
  'Neuroscience',
  'Neurobiology',
  'Neurology',
  'Computer Science',
  'Electrical & Computer Engineering',
  'Biomedical Engineering',
  'Child Study Center',
  'Radiology & Biomedical Imaging',
];

const UNIT_WORDS =
  /\b(?:departments?|dept|programs?\s+in|programmes?\s+in|section\s+of|division\s+of|interdepartmental|the)\b/g;
const CODE_PREFIX = /^[A-Z]{2,8}\s+-\s+/;
const GENERIC_DEPARTMENT_KEYS = new Set([
  'science',
  'sciences',
  'research',
  'studies',
  'program',
  'center',
  'school',
  'college',
  'yale',
  'medicine',
  'engineering',
]);
const MIN_DEPARTMENT_KEY_LENGTH = 5;
const NON_UNIT_SEGMENT =
  /\b(?:yale\s+(?:university|college|school)|new haven|connecticut|united states|usa)\b|^ct\b|\b\d{5}\b|^(?:of\s+)?medicine$/i;

export function departmentKey(value: string): string {
  return value
    .replace(CODE_PREFIX, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(UNIT_WORDS, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(?:of|and)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const usableKey = (key: string): boolean =>
  key.length >= MIN_DEPARTMENT_KEY_LENGTH && !GENERIC_DEPARTMENT_KEYS.has(key);

const containsPhrase = (haystack: string, needle: string): boolean =>
  ` ${haystack} `.includes(` ${needle} `);

export function affiliationDepartmentKeys(affiliation: string): string[] {
  return affiliation
    .split(/[,;]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !NON_UNIT_SEGMENT.test(segment))
    .map(departmentKey)
    .filter(usableKey);
}

export function departmentsAgree(
  sourceDepartments: readonly string[],
  researcherDepartments: readonly string[],
): boolean {
  const sourceKeys = sourceDepartments.flatMap(affiliationDepartmentKeys);
  const researcherKeys = researcherDepartments.map(departmentKey).filter(usableKey);
  return sourceKeys.some((source) =>
    researcherKeys.some(
      (researcher) => containsPhrase(researcher, source) || containsPhrase(source, researcher),
    ),
  );
}

const LAB_SCIENCE_KEYS = LAB_SCIENCE_ADVISER_DEPARTMENTS.map(departmentKey);

export function isLabScienceDepartment(department: string): boolean {
  const key = departmentKey(department);
  return LAB_SCIENCE_KEYS.some((labScience) => containsPhrase(key, labScience));
}

// A config with no rule predates #5473 and reads a science fellowship, so it keeps counting.
// A primary department decides alone, so a primary-Linguistics adviser whose row also lists
// Computer Science does not count (owner, 2026-11-08).
export function adviserPairCountsTowardHosting(
  rule: UndergradHostingRule | undefined,
  researcherOwnDepartments: readonly string[],
  primaryDepartment?: string,
): boolean {
  if (rule !== 'lab-science-adviser-department') return true;
  const primary = primaryDepartment?.trim();
  if (primary) return isLabScienceDepartment(primary);
  return researcherOwnDepartments.some(isLabScienceDepartment);
}
