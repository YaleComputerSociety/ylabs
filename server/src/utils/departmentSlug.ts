/**
 * Canonical department slug helpers for the per-department research page
 * (issue #1649).
 *
 * Slugs are derived from the same normalized department label the served DTO and
 * the client browse facet already agree on, so a `/research/department/<slug>`
 * URL lines up with the department-facet values rather than introducing a third
 * spelling. The school-name guard rejects a slug that actually names a Yale
 * school so the school-vs-department conflation fixed in #1384/#1316 cannot
 * resurface as a department destination.
 */
import { SCHOOL_PROFILE_HOSTS } from '../scrapers/orgUnitCanonicalization';

const PREFIXED_DEPARTMENT_PATTERN = /^([A-Za-z&/]+)\s*-\s*(.+)$/;

/** Strip a leading `ABBR - ` org-code prefix, mirroring the served DTO. */
export function departmentDisplayLabel(department: string): string {
  const value = department.trim();
  const match = value.match(PREFIXED_DEPARTMENT_PATTERN);
  return match ? match[2].trim() : value;
}

/**
 * The canonical comparison key for a department string: display label, lower
 * case, `&`->`and`, every other non-alphanumeric run collapsed to a single
 * space. Identical to the client `normalizeDepartmentLabel` and the DTO
 * `normalizedDepartmentLabel` so all three surfaces bucket variants together.
 */
export function normalizedDepartmentLabelKey(department: string): string {
  return departmentDisplayLabel(department)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MAX_DEPARTMENT_SLUG_LENGTH = 120;

/** Slug form of the normalized department key (spaces -> hyphens). */
export function toDepartmentSlug(department: string): string {
  return normalizedDepartmentLabelKey(department)
    .replace(/\s+/g, '-')
    .slice(0, MAX_DEPARTMENT_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
}

/**
 * Reverse a URL slug back to the department comparison key so it can be matched
 * against `normalizedDepartmentLabelKey` of stored department values. Returns an
 * empty string for anything that is not a plausible slug.
 */
export function departmentSlugToLabelKey(slug: unknown): string {
  if (typeof slug !== 'string') return '';
  const trimmed = slug.trim();
  if (!trimmed || trimmed.length > MAX_DEPARTMENT_SLUG_LENGTH) return '';
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) return '';
  return normalizedDepartmentLabelKey(trimmed.replace(/-+/g, ' '));
}

const YALE_SCHOOL_ONLY_LABELS = [
  'Yale College',
  'Graduate School of Arts and Sciences',
  'Faculty of Arts and Sciences',
  'School of Engineering and Applied Science',
  'Jackson School of Global Affairs',
];

const YALE_SCHOOL_LABEL_KEYS = new Set(
  [...Object.values(SCHOOL_PROFILE_HOSTS), ...YALE_SCHOOL_ONLY_LABELS].map(
    normalizedDepartmentLabelKey,
  ),
);

/**
 * True when the comparison key names a Yale school rather than a department.
 * A school is never a valid per-department destination (#1384): schools sit
 * above the department level and the department page must not aggregate an
 * entire school under one URL.
 */
export function isYaleSchoolLabelKey(labelKey: string): boolean {
  return YALE_SCHOOL_LABEL_KEYS.has(labelKey);
}
