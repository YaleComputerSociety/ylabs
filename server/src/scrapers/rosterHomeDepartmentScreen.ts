import type { UserDepartmentObservation } from './userDepartmentObservationScreens';

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
 * Resolve-time half of #6071: a `dept-faculty-roster` home department naming a center or
 * program roster that now withholds it states nothing. The lane emitted those before the flag,
 * and with field retraction off they stay live. No field is written.
 */
export function withoutWithheldRosterHomeDepartments<T extends UserDepartmentObservation>(
  observations: T[],
): T[] {
  return observations.filter(
    (observation) =>
      observation.field !== 'primaryDepartment' ||
      observation.sourceName !== DEPT_FACULTY_ROSTER_SOURCE ||
      typeof observation.value !== 'string' ||
      !ROSTER_DEPT_NAMES_WITHHOLDING_HOME_DEPARTMENT.has(observation.value),
  );
}
