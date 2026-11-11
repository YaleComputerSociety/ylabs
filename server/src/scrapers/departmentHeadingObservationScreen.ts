import { isDepartmentHeadingChrome } from './utils/departmentHeadingChrome';

interface DepartmentObservation {
  field?: string;
  value?: unknown;
}

/**
 * A profile page's affiliation group heading ("Other Departments & Organizations") is not a
 * department (#5795). It introduces the person's secondary affiliations, so the units after it
 * are not the primary appointment either: on a measured YSPH page the primary unit is listed
 * under Appointments, and the first unit after the heading is a secondary one. The lane stops
 * reading the heading at scrape; this resolve-time derivation keeps observations stored before
 * that from speaking: the heading leaves every `departments` list and a `primaryDepartment`
 * that is the heading states nothing. No field is written.
 */
export function withoutDepartmentHeadingObservations<T extends DepartmentObservation>(
  observations: T[],
): T[] {
  const screened: T[] = [];
  for (const observation of observations) {
    if (observation.field === 'departments' && Array.isArray(observation.value)) {
      const kept = observation.value.filter((value) => !isDepartmentHeadingChrome(value));
      if (kept.length === 0) continue;
      screened.push(
        kept.length === observation.value.length ? observation : { ...observation, value: kept },
      );
      continue;
    }
    if (observation.field === 'primaryDepartment' && isDepartmentHeadingChrome(observation.value)) {
      continue;
    }
    screened.push(observation);
  }
  return screened;
}
