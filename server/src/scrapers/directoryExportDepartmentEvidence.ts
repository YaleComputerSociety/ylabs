import { getOrgUnitCanonicalizer } from './orgUnitCanonicalization';
import {
  decodeDirectoryExportDepartment,
  type CanonicalDepartment,
} from './utils/directoryExportDepartment';

export const DIRECTORY_EXPORT_SOURCE = 'yale-directory-csv';

export async function catalogDepartment(): Promise<CanonicalDepartment> {
  const canonicalizer = await getOrgUnitCanonicalizer();
  return (name: string) => {
    const canonical = canonicalizer.canonicalizeDepartments([name]);
    return canonical.values.length === 1 && canonical.unmatched.length === 0
      ? canonical.values[0]
      : undefined;
  };
}

interface DepartmentObservation {
  field?: string;
  value?: unknown;
  sourceName?: string;
}

/**
 * Resolve-time derivation (#5796): a department the directory export stated is read as its
 * catalog department, or states nothing when it decodes to none. No field is written.
 */
export function withDirectoryExportDepartmentsDecoded<T extends DepartmentObservation>(
  observations: T[],
  canonicalDepartment: CanonicalDepartment,
): T[] {
  const decoded: T[] = [];
  for (const observation of observations) {
    if (
      observation.field !== 'primaryDepartment' ||
      observation.sourceName !== DIRECTORY_EXPORT_SOURCE
    ) {
      decoded.push(observation);
      continue;
    }
    const result = decodeDirectoryExportDepartment(observation.value, canonicalDepartment);
    if (result.status === 'canonical') {
      decoded.push(
        result.department === observation.value
          ? observation
          : { ...observation, value: result.department },
      );
    } else if (result.status === 'not-export-code') {
      decoded.push(observation);
    }
  }
  return decoded;
}

/**
 * The stored value a resolve keeps for a department the import seeded from the export: its
 * catalog department, nothing when it decodes to none, or the value unchanged when it is not an
 * export code at all.
 */
export function storedDepartmentAfterExportDecode(
  stored: unknown,
  canonicalDepartment: CanonicalDepartment,
): { changed: false } | { changed: true; department: string | undefined } {
  const result = decodeDirectoryExportDepartment(stored, canonicalDepartment);
  if (result.status === 'not-export-code') return { changed: false };
  const department = result.status === 'canonical' ? result.department : undefined;
  return department === stored ? { changed: false } : { changed: true, department };
}
