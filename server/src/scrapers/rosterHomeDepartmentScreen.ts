import type {
  UserDepartmentObservation,
  UserDepartmentScreenContext,
} from './userDepartmentObservationScreens';

export const DEPT_FACULTY_ROSTER_SOURCE = 'dept-faculty-roster';

/**
 * The `deptName` of every roster config set to `withholdsHomeDepartment` whose name no other
 * config emits as a home department. Kept here rather than read from the configs so the
 * resolver does not load the roster lane; a guard test holds it equal to the configs (#6071).
 */
export const ROSTER_DEPT_NAMES_WITHHOLDING_HOME_DEPARTMENT: ReadonlySet<string> = new Set([
  'Physician Associate Program',
  'Stem Cell Center',
  'West Campus Institutes',
]);

/**
 * Resolve-time half of #6071: a `dept-faculty-roster` home department states nothing when it
 * names a center or program roster that now withholds it, or when the catalog does not name
 * it. The second test catches the earlier `deptName` spellings those rosters emitted before a
 * rename, such as the long West Campus institute list, which no literal name can keep up
 * with. Every home department the lane emits today is catalogued, so the catalog test screens
 * only stored readings. With no catalog, only the withheld names are screened. No field is
 * written.
 */
export function withoutWithheldRosterHomeDepartments<T extends UserDepartmentObservation>(
  observations: T[],
  { canonicalDepartment }: UserDepartmentScreenContext,
): T[] {
  const speaks = (value: unknown): boolean =>
    typeof value === 'string' &&
    !ROSTER_DEPT_NAMES_WITHHOLDING_HOME_DEPARTMENT.has(value) &&
    (!canonicalDepartment || Boolean(canonicalDepartment(value)));
  return observations.filter(
    (observation) =>
      observation.field !== 'primaryDepartment' ||
      observation.sourceName !== DEPT_FACULTY_ROSTER_SOURCE ||
      speaks(observation.value),
  );
}
