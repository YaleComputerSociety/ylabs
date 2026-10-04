import { OrgUnit } from '../models/orgUnit';

/**
 * Department-scoped observation fields (#2214).
 *
 * A department course page establishes a fact about the department, so the fact
 * is recorded against the department's `OrgUnit` and never attached to the
 * research entities in it. Since #4637 nothing materializes it into a `Signal`:
 * the observation stays as evidence a future lane can read.
 */

export const ORG_UNIT_COURSE_CREDIT_ROUTE_FIELD = 'courseCreditRoute';

export interface OrgUnitCourseCreditRouteValue {
  schemaVersion: 1;
  evidenceQuote: string;
  supportingQuoteCount: number;
}

export interface OrgUnitCourseCreditRouteAbsenceValue {
  schemaVersion: 1;
  routeStated: false;
}

export type OrgUnitCourseCreditRouteObservationValue =
  OrgUnitCourseCreditRouteValue | OrgUnitCourseCreditRouteAbsenceValue;

/**
 * `research_entities.departments[]` and this lane's configs both store a
 * department name string, and there is no id link to `OrgUnit`, so the slug has
 * to be resolved by name or alias. Returns null rather than guessing, so a
 * department the org chart does not know produces no observation.
 */
export async function resolveOrgUnitSlugForDepartmentName(
  departmentName: string,
): Promise<string | null> {
  const name = (departmentName || '').trim();
  if (!name) return null;
  const unit = await OrgUnit.findOne({
    archived: { $ne: true },
    $or: [{ name }, { aliases: name }],
  })
    .select('slug')
    .lean();
  return unit ? String((unit as any).slug) : null;
}
