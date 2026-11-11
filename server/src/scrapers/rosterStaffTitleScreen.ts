import {
  statesAnyFacultyAppointment,
  titleStatesOnlyAStaffRole,
} from './sources/yaleDirectoryScraper';

export const STAFF_SCREENED_ROSTER_ROLES: ReadonlySet<string> = new Set([
  'core-faculty',
  'affiliated',
  'affiliate',
]);

/**
 * A faculty-default roster role read as staff when the listing's own title or the member's
 * profile title names only a staff role and neither states a faculty appointment. Mixed
 * "Faculty & Staff" pages give every link the lane's default role, so the title is the only
 * evidence the listing is staff (#5746). Derived on every resolve; it writes no field.
 * The membership key carries the role, so the materializer's edge and a roster lane's read
 * snapshot must both screen here or retirement reads every screened edge as absent.
 */
export function screenedRosterRole(
  role: string,
  titles: ReadonlyArray<string | null | undefined>,
): string {
  if (!STAFF_SCREENED_ROSTER_ROLES.has(role)) return role;
  const stated = titles.map((title) => (title ?? '').trim()).filter(Boolean);
  if (stated.length === 0 || stated.some((title) => statesAnyFacultyAppointment(title))) {
    return role;
  }
  return stated.some((title) => titleStatesOnlyAStaffRole(title)) ? 'staff' : role;
}
