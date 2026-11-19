export type RosterHomeDepartmentWithholding =
  | 'secondary'
  | 'joint'
  | 'adjunct'
  | 'courtesy'
  | 'visiting'
  | 'another-department-first'
  | 'unit-outside-this-department';

/** What the catalog says about a title's parenthetical, when it is asked. */
export type RosterTitleUnit =
  { kind: 'section'; value: string } | { kind: 'other-unit' } | { kind: 'not-a-unit' };

export type RosterHomeDepartmentStatement =
  { kind: 'assert'; value: string } | { kind: 'withhold'; reason: RosterHomeDepartmentWithholding };

const APPOINTMENT_MARKERS: ReadonlyArray<[RegExp, RosterHomeDepartmentWithholding]> = [
  [/\bsecondary\b/i, 'secondary'],
  [/\bjoint\b/i, 'joint'],
  [/\badjunct\b/i, 'adjunct'],
  [/\bcourtesy\b/i, 'courtesy'],
  [/\bvisiting\b/i, 'visiting'],
];

const MIN_DEPARTMENT_NAME_CHARS = 5;

const NOT_A_SCHOOL_OF = '(?<!\\bschool\\s)\\bof\\s';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const bareDepartmentName = (name: string): string =>
  name
    .trim()
    .replace(/^(department|section|division) of\s+/i, '')
    .trim();

/**
 * The spellings a title uses for a department. A YSM title says "Professor of Medicine" for
 * Internal Medicine, so that one department also matches a bare "of Medicine".
 */
function departmentPatterns(deptName: string): string[] {
  const bare = bareDepartmentName(deptName);
  const words = bare
    .split(/\s+|&/)
    .filter((word) => word && word.toLowerCase() !== 'and')
    .map(escapeRegExp)
    .join('(?:[\\s,&-]|\\band\\b)+');
  const patterns = words ? [`\\b${words}\\b`] : [];
  if (/^internal medicine$/i.test(bare)) {
    patterns.push(`(?<=${NOT_A_SCHOOL_OF})medicine\\b`);
  }
  return patterns;
}

/**
 * Where a title names an appointment: its start, a clause after a semicolon, comma or spaced
 * dash, or after "of" (not "School of") or "in", the FAS form ("Lecturer in History").
 */
const APPOINTMENT_CONTEXT = `(?<=^|[;,]\\s*|\\s[-\u2013]\\s+|${NOT_A_SCHOOL_OF}\\s*|\\bin\\s)`;

function firstMention(title: string, deptName: string, context = ''): number {
  const positions = departmentPatterns(deptName)
    .map((pattern) => title.search(new RegExp(`${context}${pattern}`, 'i')))
    .filter((position) => position >= 0);
  return positions.length ? Math.min(...positions) : -1;
}

/**
 * The parenthetical a title attaches to this department, as in "of Medicine (Digestive Diseases)".
 * Most are not units at all ("On Leave Fall 2026", "retired"), so only the catalog can say
 * whether one names a section.
 */
export function rosterTitleSectionParenthetical(
  title: string | undefined,
  deptName: string,
): string | undefined {
  if (!title) return undefined;
  for (const pattern of departmentPatterns(deptName)) {
    const match = new RegExp(`${pattern}\\s*\\(([^()]{3,60})\\)`, 'i').exec(title);
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Whether a department roster may file its own department as a listed person's
 * `primaryDepartment`, read from the person's title on that page (#6274). It withholds only on
 * positive evidence that the home appointment is elsewhere: an appointment marker
 * (secondary, joint, adjunct, courtesy, visiting) that comes before this department's first
 * mention, or another department named before this one. A marker after this department
 * qualifies a later appointment ("of Pathology and (by courtesy) of Urology") or is not a
 * marker at all ("Joint Reconstruction"), so it leaves this department's claim alone.
 * A title that attaches a catalogued unit to this department, as a YSM title does with a
 * section, withholds the parent: it states the section when the catalog places it under this
 * department, and nothing when the unit sits elsewhere. A parenthetical the catalog does not
 * hold as a unit, or one read with no catalog, says nothing about the appointment.
 *
 * A page that states nothing (no title, or a title naming no department) still asserts the
 * roster's department, so a person listed on one roster keeps it: the lane cannot see whether
 * another roster lists the person, and a roster reading ranks below a first-hand profile, so a
 * person's own profile still decides when one exists.
 */
export function rosterHomeDepartmentStatement(input: {
  deptName: string;
  title?: string;
  departmentNames: Iterable<string>;
  classifyUnit?: (parenthetical: string) => RosterTitleUnit;
}): RosterHomeDepartmentStatement {
  const title = input.title?.trim();
  if (!title) return { kind: 'assert', value: input.deptName };
  const ownPosition = firstMention(title, input.deptName);
  for (const [marker, reason] of APPOINTMENT_MARKERS) {
    const markerPosition = title.search(marker);
    if (markerPosition < 0) continue;
    if (ownPosition >= 0 && markerPosition > ownPosition) continue;
    return { kind: 'withhold', reason };
  }
  const own = bareDepartmentName(input.deptName).toLowerCase();
  const otherPositions = [...new Set(input.departmentNames)]
    .filter((name) => {
      const bare = bareDepartmentName(name).toLowerCase();
      return bare.length >= MIN_DEPARTMENT_NAME_CHARS && bare !== own;
    })
    .map((name) => firstMention(title, name, APPOINTMENT_CONTEXT))
    .filter((position) => position >= 0);
  const firstOther = otherPositions.length ? Math.min(...otherPositions) : -1;
  if (firstOther >= 0 && (ownPosition < 0 || firstOther < ownPosition)) {
    return { kind: 'withhold', reason: 'another-department-first' };
  }
  const parenthetical = rosterTitleSectionParenthetical(title, input.deptName);
  const unit = parenthetical && input.classifyUnit ? input.classifyUnit(parenthetical) : undefined;
  if (unit?.kind === 'section') return { kind: 'assert', value: unit.value };
  if (unit?.kind === 'other-unit')
    return { kind: 'withhold', reason: 'unit-outside-this-department' };
  return { kind: 'assert', value: input.deptName };
}
