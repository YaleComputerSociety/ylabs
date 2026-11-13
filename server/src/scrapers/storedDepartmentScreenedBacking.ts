import { storedDepartmentIsBacked } from './storedDepartmentBacking';
import {
  USER_DEPARTMENT_OBSERVATION_SCREENS,
  withUserDepartmentObservationsScreened,
  type UserDepartmentObservation,
  type UserDepartmentObservationScreen,
  type UserDepartmentScreenContext,
} from './userDepartmentObservationScreens';

const backs = (
  stored: unknown,
  reading: UserDepartmentObservation,
  context: UserDepartmentScreenContext,
): boolean =>
  reading.field === 'primaryDepartment' &&
  storedDepartmentIsBacked(stored, [reading], context.canonicalDepartment);

/**
 * Whether a stored `primaryDepartment` is backed by readings and every one of them is screened
 * (#6065). Such a value was written by a reading the resolver no longer lets speak, so it is
 * cleared the way a stored heading is (#5795) and the field resolves from what remains.
 *
 * Backing is #6049's own test (`storedDepartmentIsBacked`), so a value with no backing reading
 * is the never-backed case that rule owns and is left alone here, and so is everything while
 * the catalog is unavailable, because the export decode then refuses every code.
 */
export function storedDepartmentRestsOnlyOnScreenedReadings(
  stored: unknown,
  readings: readonly UserDepartmentObservation[],
  context: UserDepartmentScreenContext,
  screens: ReadonlyArray<UserDepartmentObservationScreen> = USER_DEPARTMENT_OBSERVATION_SCREENS,
): boolean {
  if (!context.canonicalDepartment) return false;
  if (typeof stored !== 'string' || !stored.trim()) return false;
  const backing = readings.filter((reading) => backs(stored, reading, context));
  if (backing.length === 0) return false;
  return backing.every(
    (reading) =>
      !withUserDepartmentObservationsScreened([reading], context, screens).some((kept) =>
        backs(stored, kept, context),
      ),
  );
}

/** Whether some reading backs the stored department and survives every screen. */
export function storedDepartmentHasUnscreenedReading(
  stored: unknown,
  readings: readonly UserDepartmentObservation[],
  context: UserDepartmentScreenContext,
): boolean {
  if (typeof stored !== 'string' || !stored.trim()) return false;
  return withUserDepartmentObservationsScreened(
    readings.filter((reading) => backs(stored, reading, context)),
    context,
  ).some((kept) => backs(stored, kept, context));
}
