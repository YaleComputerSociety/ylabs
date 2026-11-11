/**
 * The Yale directory's `unit` is the person's HR budget unit, not a curated department.
 * Measured on Development on 2026-11-11 over the 7,001 live directory records: 308 distinct
 * units, of which many name an administrative bucket ("Administration", "Other Units",
 * "Academic Faculty"), a degree or training program, an internal code ("MPATH-All",
 * "Psych Divisions-CNRU") or a non-academic office. Those are refused rather than served as a
 * department, because an empty department misleads nobody and "Business Office" does (#5741).
 */

const COSMETIC_SUFFIX = /\s*-\s*(?:all(?:\s+school)?|other)$|\s+other$/i;
const LEADING_INTERNAL_CODE = /^[A-Z]{3,}\s+(?=[A-Z][a-z])/;

export const DEPARTMENT_HEADING_CHROME_PATTERN = /^other\s+departments?\b/i;

const ADMINISTRATIVE_UNIT_PATTERNS: readonly RegExp[] = [
  DEPARTMENT_HEADING_CHROME_PATTERN,
  /\b(?:administration|admin|business (?:office|operations)|facilities)\b/i,
  /\b(?:dean'?s?|deans|deputy deans?|associate deans)\b/i,
  /\b(?:academic|research|faculty) affairs\b/i,
  /\boffice\b/i,
  /\bprovost\b/i,
  /\bresearch unit$/i,
  /\b(?:program|residency|rotc|head of college|gym|fellows|capstone|teaching)$/i,
  /\btraining program\b/i,
  /\bdiversity,? equity\b|^dei\b/i,
  /^[A-Z]{3,}$/,
  /\bfaculty$/i,
  /\bemeritus faculty\b/i,
  /^(?:CTR Study of RITM|TS\/OCD\/ADHD|YSM Central)$/i,
  /^(?:other units|academic faculty|clinical faculty|research and teaching unit|research|interdisciplinary|outpatient services|care centers|specialty services|student programs|global programs|non center-related faculty activity|other undergraduate education|education|divinity general|humanities studies|clinical scholars|health system affiliates|yale summer session|young global scholars|medical library|graduate school of arts and sciences|jackson school|in-home|young child|simulaton\/assessment|sailing center|agency staff - dwight hall)$/i,
];

const INTERNAL_UNIT_CODE_DEPARTMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^MCDB$/, 'Molecular, Cellular and Developmental Biology'],
  [/^MB and B$/i, 'Molecular Biophysics and Biochemistry'],
  [/^C And M Physiology$/i, 'Cellular and Molecular Physiology'],
  [/^MPATH$/, 'Pathology'],
  [/^MOBGYN$/, 'Obstetrics, Gynecology and Reproductive Sciences'],
  [/^MPEDI$/, 'Pediatrics'],
  [/^ECE Faculty$/, 'Electrical and Computer Engineering'],
  [/^CEE Faculty$/, 'Chemical and Environmental Engineering'],
  [/^MechE Faculty$/, 'Mechanical Engineering and Materials Science'],
  [/^BME Faculty$/, 'Biomedical Engineering'],
  [/^Psych Divisions\b/i, 'Psychiatry'],
];

const UNIT_CLASS_DEPARTMENTS: Readonly<Record<string, string>> = {
  MEDNEU: 'Neurology',
};

const LEADING_UNIT_CLASS = /^([A-Z]{6})\s+(?=\S)/;

export function isAdministrativeDirectoryUnit(unit: string): boolean {
  return ADMINISTRATIVE_UNIT_PATTERNS.some((pattern) => pattern.test(unit));
}

/**
 * `unitClass` is the directory's unit class code; the CSV export instead prefixes the unit with
 * it ("MEDNEU Multiple Sclerosis"). A class that is one department reads as that department.
 */
export function directoryUnitDepartment(unit: unknown, unitClass?: unknown): string | undefined {
  if (typeof unit !== 'string') return undefined;
  const collapsed = unit.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  const statedClass =
    (typeof unitClass === 'string' && unitClass.trim().toUpperCase()) ||
    LEADING_UNIT_CLASS.exec(collapsed)?.[1];
  const classDepartment = statedClass ? UNIT_CLASS_DEPARTMENTS[statedClass] : undefined;
  if (classDepartment) return classDepartment;
  const withoutSuffix = collapsed.replace(COSMETIC_SUFFIX, '').trim();
  const decoded = INTERNAL_UNIT_CODE_DEPARTMENTS.find(([code]) => code.test(withoutSuffix));
  if (decoded) return decoded[1];
  if (isAdministrativeDirectoryUnit(withoutSuffix)) return undefined;
  const department = withoutSuffix
    .replace(LEADING_INTERNAL_CODE, '')
    .replace(/^Dept of /i, 'Department of ')
    .trim();
  if (!department || isAdministrativeDirectoryUnit(department)) return undefined;
  return department;
}
