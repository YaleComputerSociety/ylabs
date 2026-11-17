import {
  createOrgUnitCanonicalizer,
  getOrgUnitCanonicalizer,
  type OrgUnitCanonicalizer,
} from '../scrapers/orgUnitCanonicalization';
import { sanitizeLogValue } from './logSanitizer';

type DepartmentCanonicalizer = Pick<OrgUnitCanonicalizer, 'canonicalizeDepartments'>;

const PASS_THROUGH_CANONICALIZER: DepartmentCanonicalizer = createOrgUnitCanonicalizer(new Map());

export async function servedDepartmentCanonicalizer(): Promise<DepartmentCanonicalizer> {
  try {
    return await getOrgUnitCanonicalizer();
  } catch (error) {
    console.error(
      'Org-unit catalog read failed; member departments serve as stored:',
      sanitizeLogValue(error),
    );
    return PASS_THROUGH_CANONICALIZER;
  }
}

export function catalogDepartmentDisplayName(
  canonicalizer: DepartmentCanonicalizer,
  raw: unknown,
): unknown {
  if (typeof raw !== 'string' || !raw.trim()) return raw;
  const { values, unmatched } = canonicalizer.canonicalizeDepartments([raw]);
  return values.length === 1 && unmatched.length === 0 ? values[0] : raw;
}

export function withCatalogDepartmentName<T extends Record<string, any>>(
  canonicalizer: DepartmentCanonicalizer,
  publicUser: T,
): T {
  if (!publicUser.primaryDepartment && !publicUser.primary_department) return publicUser;
  const department = catalogDepartmentDisplayName(
    canonicalizer,
    publicUser.primaryDepartment || publicUser.primary_department,
  );
  return { ...publicUser, primaryDepartment: department, primary_department: department };
}
