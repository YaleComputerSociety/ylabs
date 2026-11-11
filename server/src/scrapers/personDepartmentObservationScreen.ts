import {
  DEPARTMENT_HEADING_CHROME_PATTERN,
  directoryUnitDepartment,
} from './utils/directoryUnitDepartment';

const DIRECTORY_DEPARTMENT_SOURCES: ReadonlySet<string> = new Set([
  'yale-directory',
  'yale-directory-csv',
]);

interface DepartmentScreenObservation {
  field?: string;
  value?: unknown;
  sourceName?: string;
}

const isHeadingChrome = (value: unknown): boolean =>
  typeof value === 'string' && DEPARTMENT_HEADING_CHROME_PATTERN.test(value.trim());

/**
 * Resolve-time derivation over a person's department evidence (#5741): a page heading read as a
 * department ("Other Departments & Organizations") speaks for no department from any lane, and a
 * directory unit is read through the same screen and decode the directory lane applies at
 * scrape, so observations stored before that screen resolve the same way. No field is written.
 */
export function screenedPersonDepartmentObservations<T extends DepartmentScreenObservation>(
  observations: T[],
): T[] {
  const screened: T[] = [];
  for (const observation of observations) {
    if (observation.field === 'departments' && Array.isArray(observation.value)) {
      const kept = observation.value.filter((value) => !isHeadingChrome(value));
      if (kept.length === 0) continue;
      screened.push(
        kept.length === observation.value.length ? observation : { ...observation, value: kept },
      );
      continue;
    }
    if (observation.field !== 'primaryDepartment') {
      screened.push(observation);
      continue;
    }
    if (isHeadingChrome(observation.value)) continue;
    if (!DIRECTORY_DEPARTMENT_SOURCES.has(String(observation.sourceName ?? ''))) {
      screened.push(observation);
      continue;
    }
    const department = directoryUnitDepartment(observation.value);
    if (!department) continue;
    screened.push(
      department === observation.value ? observation : { ...observation, value: department },
    );
  }
  return screened;
}
