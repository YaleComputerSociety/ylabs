import { OFFICIAL_PROFILE_PI_BACKFILL_SOURCE } from './directoryContradictedProfileNetid';
import type {
  UserDepartmentObservation,
  UserDepartmentScreenContext,
} from './userDepartmentObservationScreens';

export { OFFICIAL_PROFILE_PI_BACKFILL_SOURCE } from './directoryContradictedProfileNetid';

/**
 * Resolve-time half of #6074: a stored `official-profile-pi-backfill` home department the
 * catalog does not name states nothing. The lane's emit is gated since #6099, but readings it
 * stored before then still carry faculty-type headings and center names. No field is written,
 * and with no catalog nothing is screened, so a catalog outage can never drive the shared
 * #6065 clear.
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
