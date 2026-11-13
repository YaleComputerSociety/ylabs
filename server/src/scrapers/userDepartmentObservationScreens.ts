import { withoutUncataloguedBackfillHomeDepartments } from './backfillHomeDepartmentScreen';
import { withoutDepartmentHeadingObservations } from './departmentHeadingObservationScreen';
import { withDirectoryDepartmentsCatalogGated } from './directoryDepartmentCatalogGate';
import { withDirectoryExportDepartmentsDecoded } from './directoryExportDepartmentEvidence';
import { withoutWithheldRosterHomeDepartments } from './rosterHomeDepartmentScreen';
import type { CanonicalDepartment } from './utils/directoryExportDepartment';
import { withoutUncataloguedYsmHomeDepartments } from './ysmHomeDepartmentScreen';

export interface UserDepartmentObservation {
  field?: string;
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string;
}

export interface UserDepartmentScreenContext {
  canonicalDepartment: CanonicalDepartment | null;
}

export type UserDepartmentObservationScreen = <T extends UserDepartmentObservation>(
  observations: T[],
  context: UserDepartmentScreenContext,
) => T[];

/**
 * Every resolve-time derivation that stops a `user` department observation from speaking, in
 * the order the user resolver applies them. A screen writes no field: it drops or rewrites an
 * observation, and `storedDepartmentRestsOnlyOnScreenedReadings` reads the same list, so a
 * stored department only screened readings back is cleared by the screen that refused them.
 */
export const USER_DEPARTMENT_OBSERVATION_SCREENS: ReadonlyArray<UserDepartmentObservationScreen> = [
  (observations) => withoutWithheldRosterHomeDepartments(observations),
  (observations, { canonicalDepartment }) =>
    withDirectoryExportDepartmentsDecoded(observations, canonicalDepartment),
  withDirectoryDepartmentsCatalogGated,
  withoutUncataloguedBackfillHomeDepartments,
  (observations) => withoutDepartmentHeadingObservations(observations),
  withoutUncataloguedYsmHomeDepartments,
];

export function withUserDepartmentObservationsScreened<T extends UserDepartmentObservation>(
  observations: T[],
  context: UserDepartmentScreenContext,
  screens: ReadonlyArray<UserDepartmentObservationScreen> = USER_DEPARTMENT_OBSERVATION_SCREENS,
): T[] {
  return screens.reduce((kept, screen) => screen(kept, context), observations);
}
