import { getOrgUnitCanonicalizer } from './orgUnitCanonicalization';
import {
  decodeDirectoryExportDepartment,
  type CanonicalDepartment,
} from './utils/directoryExportDepartment';

export const DIRECTORY_EXPORT_SOURCE = 'yale-directory-csv';

const CATALOG_AVAILABILITY_PROBE = 'Department Catalog Availability Probe';

const noCatalogDepartment: CanonicalDepartment = () => undefined;

/**
 * The catalog department for a name, or null when `org_units` holds no department rows. The
 * canonicalizer suspends fail-closed then, and an unavailable catalog must not read every export
 * code as a non-department and clear it.
 */
export async function catalogDepartment(): Promise<CanonicalDepartment | null> {
  const canonicalizer = await getOrgUnitCanonicalizer();
  const probe = canonicalizer.canonicalizeDepartments([CATALOG_AVAILABILITY_PROBE]);
  if (probe.values.includes(CATALOG_AVAILABILITY_PROBE) && probe.unmatched.length > 0) return null;
  return (name: string) => {
    const canonical = canonicalizer.canonicalizeDepartments([name]);
    return canonical.values.length === 1 && canonical.unmatched.length === 0
      ? canonical.values[0]
      : undefined;
  };
}

export async function catalogSchoolForDepartment(): Promise<
  ((department: string) => string | undefined) | null
> {
  const canonicalDepartment = await catalogDepartment();
  if (!canonicalDepartment) return null;
  const canonicalizer = await getOrgUnitCanonicalizer();
  return (department: string) => {
    const canonical = canonicalDepartment(department);
    return canonical ? canonicalizer.schoolForDepartment(canonical) || undefined : undefined;
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
  canonicalDepartment: CanonicalDepartment | null,
): T[] {
  const decode = canonicalDepartment ?? noCatalogDepartment;
  const decoded: T[] = [];
  for (const observation of observations) {
    if (
      observation.field !== 'primaryDepartment' ||
      observation.sourceName !== DIRECTORY_EXPORT_SOURCE
    ) {
      decoded.push(observation);
      continue;
    }
    const result = decodeDirectoryExportDepartment(observation.value, decode);
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
 * export code at all or the catalog is unavailable.
 */
export function storedDepartmentAfterExportDecode(
  stored: unknown,
  canonicalDepartment: CanonicalDepartment | null,
): { changed: false } | { changed: true; department: string | undefined } {
  if (!canonicalDepartment) return { changed: false };
  const result = decodeDirectoryExportDepartment(stored, canonicalDepartment);
  if (result.status === 'not-export-code') return { changed: false };
  const department = result.status === 'canonical' ? result.department : undefined;
  return department === stored ? { changed: false } : { changed: true, department };
}
