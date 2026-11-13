import {
  decodeDirectoryExportDepartment,
  type CanonicalDepartment,
} from './utils/directoryExportDepartment';

export interface DepartmentBackingObservation {
  value?: unknown;
}

function looseDepartmentKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function departmentForms(
  value: unknown,
  canonicalDepartment: CanonicalDepartment | null,
): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const forms = [value];
  if (canonicalDepartment) {
    const catalogName = canonicalDepartment(value);
    if (catalogName) forms.push(catalogName);
    const decoded = decodeDirectoryExportDepartment(value, canonicalDepartment);
    if (decoded.status === 'canonical' && decoded.department) forms.push(decoded.department);
  }
  return forms.map(looseDepartmentKey).filter(Boolean);
}

/**
 * Whether any `primaryDepartment` observation, live or superseded, states the stored value
 * (#6049). Superseded readings count, because a retracted claim is history and still backs
 * the value it once set, the same line the never-backed provenance rule draws
 * (`docs/decisions.md`). The comparison is deliberately loose (case, `&`, punctuation, the
 * catalog name and the export-code decode), so a spelling the materializer would have written
 * from that reading never reads as unbacked.
 */
export function storedDepartmentIsBacked(
  stored: unknown,
  observations: readonly DepartmentBackingObservation[],
  canonicalDepartment: CanonicalDepartment | null,
): boolean {
  const storedForms = new Set(departmentForms(stored, canonicalDepartment));
  if (storedForms.size === 0) return true;
  return observations.some((observation) =>
    departmentForms(observation.value, canonicalDepartment).some((form) => storedForms.has(form)),
  );
}
