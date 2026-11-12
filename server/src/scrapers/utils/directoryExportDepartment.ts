import { directoryUnitDepartment } from './directoryUnitDepartment';

/**
 * The 2026-05-15 Yale directory CSV export (`yale-directory-csv`) and the import that seeded
 * researchers from it stored the raw HR org-unit string as a department: an HR prefix
 * ("FASHIS History", "MEDNEU Multiple Sclerosis") or a subject-code dash form
 * ("HIST - History"). Decoded here to a catalog department or refused, never served raw (#5796).
 */
export const DIRECTORY_EXPORT_CODE_PATTERN = /^[A-Z]{4,}\s/;

const HR_PREFIXED = /^([A-Z]{6})\s+(.+)$/;
const SUBJECT_DASH = /^[A-Z]{4}\s+-\s+(.+)$/;
const TRAILING_ACRONYM = /\s+\([A-Z&]{2,}\)$/;

const SECTION_PARENTS: ReadonlyArray<readonly [string, RegExp, string]> = [
  [
    'MEDNEU',
    /^(?:Epilepsy|General Neurology|Movement Disorders|Multiple Sclerosis|Neurology - All)$/,
    'Neurology',
  ],
  [
    'MEDINT',
    /^(?:Cardiology|General Medicine Other|Infectious Diseases|Pulmonary Other|Digestive Diseases Other|Nephrology Other)$/,
    'Internal Medicine',
  ],
  ['MEDCCC', /^Medical Oncology$/, 'Internal Medicine'],
  ['MEDPED', /^(?:Neonatology|Infectious Disease)$/, 'Pediatrics'],
  [
    'MEDOBG',
    /^(?:Reproductive Sciences|MOBGYN-All)$/,
    'Obstetrics, Gynecology & Reproductive Sciences',
  ],
  ['MEDDRA', /^Radiology$/, 'Radiology & Biomedical Imaging'],
  ['ARCSCH', /^School of Architecture(?: - All)?$/, 'Architecture'],
];

/**
 * Values the #5796 review could not place with confidence. They are refused rather than guessed
 * into a parent department.
 */
const UNSURE_UNITS: ReadonlySet<string> = new Set([
  'MEDCSC Developmental Disabilities',
  'MEDNEU Neurology Neuroscience',
  'MEDCCC Hematology',
]);

export type DirectoryExportDepartment =
  | { status: 'not-export-code' }
  | { status: 'canonical'; department: string }
  | { status: 'refused' };

export type CanonicalDepartment = (name: string) => string | undefined;

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

function candidateUnit(value: string): { prefix?: string; unit: string } | undefined {
  const hr = HR_PREFIXED.exec(value);
  if (hr) return { prefix: hr[1], unit: collapse(hr[2]) };
  const dash = SUBJECT_DASH.exec(value);
  if (dash) return { unit: collapse(dash[1]) };
  return undefined;
}

/**
 * A value that is neither an HR-prefixed unit nor a subject-code dash form is an acronym name
 * ("FRESH Collaborative", "CPIRT - Center for ...") and is refused before any prefix is stripped,
 * so a fragment such as "Collaborative" can never reach the catalog.
 */
export function decodeDirectoryExportDepartment(
  raw: unknown,
  canonicalDepartment: CanonicalDepartment,
): DirectoryExportDepartment {
  if (typeof raw !== 'string') return { status: 'not-export-code' };
  const value = collapse(raw);
  if (!DIRECTORY_EXPORT_CODE_PATTERN.test(value)) return { status: 'not-export-code' };
  if (UNSURE_UNITS.has(value)) return { status: 'refused' };

  const candidate = candidateUnit(value);
  if (!candidate) return { status: 'refused' };

  const section = SECTION_PARENTS.find(
    ([prefix, unit]) => prefix === candidate.prefix && unit.test(candidate.unit),
  );
  const names = section
    ? [section[2]]
    : [directoryUnitDepartment(candidate.unit)]
        .filter((name): name is string => Boolean(name))
        .flatMap((name) => [name, name.replace(TRAILING_ACRONYM, '')]);

  for (const name of names) {
    const department = canonicalDepartment(name);
    if (department) return { status: 'canonical', department };
  }
  return { status: 'refused' };
}
