import type {
  UserDepartmentObservation,
  UserDepartmentScreenContext,
} from './userDepartmentObservationScreens';

export const OFFICIAL_PROFILE_PI_BACKFILL_SOURCE = 'official-profile-pi-backfill';

/**
 * Resolve-time half of #6074: an `official-profile-pi-backfill` home department the catalog
 * does not name states nothing. The lane used to emit the first element classed
 * "department", which on several schools' profiles is a faculty-type heading or a center, and
 * those readings stay stored until the next walk. No field is written, and nothing is screened
 * without a catalog.
 */
export function withoutUncataloguedBackfillHomeDepartments<T extends UserDepartmentObservation>(
  observations: T[],
  { canonicalDepartment }: UserDepartmentScreenContext,
): T[] {
  if (!canonicalDepartment) return observations;
  return observations.filter(
    (observation) =>
      observation.field !== 'primaryDepartment' ||
      observation.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
      (typeof observation.value === 'string' && Boolean(canonicalDepartment(observation.value))),
  );
}
