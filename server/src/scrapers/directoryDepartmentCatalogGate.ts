import type {
  UserDepartmentObservation,
  UserDepartmentScreenContext,
} from './userDepartmentObservationScreens';
import { TRAILING_UNIT_ACRONYM } from './utils/directoryExportDepartment';

export const YALE_DIRECTORY_SOURCE = 'yale-directory';

/**
 * Resolve-time half of #6129: a `yale-directory` home department fills or replaces only when the
 * catalog names it as a department or section. An acronym-suffixed spelling ("Biostatistics
 * (BIS)") is read as its catalog name; a center, a council or any other unit the catalog does
 * not name states nothing, so it can never take the field through the fill-only directory path
 * (#5741, #6049). No field is written, and nothing is gated without a catalog.
 */
export function withDirectoryDepartmentsCatalogGated<T extends UserDepartmentObservation>(
  observations: T[],
  { canonicalDepartment }: UserDepartmentScreenContext,
): T[] {
  if (!canonicalDepartment) return observations;
  const gated: T[] = [];
  for (const observation of observations) {
    if (
      observation.field !== 'primaryDepartment' ||
      observation.sourceName !== YALE_DIRECTORY_SOURCE
    ) {
      gated.push(observation);
      continue;
    }
    if (typeof observation.value !== 'string') continue;
    if (canonicalDepartment(observation.value)) {
      gated.push(observation);
      continue;
    }
    const decoded = canonicalDepartment(observation.value.replace(TRAILING_UNIT_ACRONYM, ''));
    if (decoded) gated.push({ ...observation, value: decoded });
  }
  return gated;
}
