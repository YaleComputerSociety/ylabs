import type {
  UserDepartmentObservation,
  UserDepartmentScreenContext,
} from './userDepartmentObservationScreens';

export const YSM_FACULTY_DIRECTORY_SOURCE = 'ysm-faculty-directory';

/**
 * Resolve-time half of #6070: a `ysm-faculty-directory` home department the catalog does not
 * name states nothing. The lane used to take the first entry of a list that also carries the
 * profile's organizations (centers, houses, labs, societies), and those readings stay stored
 * until the next walk. No field is written, and nothing is screened without a catalog.
 */
export function withoutUncataloguedYsmHomeDepartments<T extends UserDepartmentObservation>(
  observations: T[],
  { canonicalDepartment }: UserDepartmentScreenContext,
): T[] {
  if (!canonicalDepartment) return observations;
  return observations.filter(
    (observation) =>
      observation.field !== 'primaryDepartment' ||
      observation.sourceName !== YSM_FACULTY_DIRECTORY_SOURCE ||
      (typeof observation.value === 'string' && Boolean(canonicalDepartment(observation.value))),
  );
}
