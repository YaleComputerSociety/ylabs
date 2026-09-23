import { OrgUnit } from '../models/orgUnit';
import { Signal } from '../models/signal';
import { orgUnitMatchKey } from '../scrapers/orgUnitCanonicalization';
import { readOrgUnitCourseCreditRouteValue } from '../scrapers/orgUnitSignalMaterializer';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { isPublicHttpUrl } from '../utils/urlSafety';

/**
 * Department context a research entity inherits from its department (#2214).
 *
 * The fact is stored on the department's `OrgUnit` and read here, so a served
 * entity page can show it while naming the department as the source. It is never
 * copied onto the entity, because a department course page does not say anything
 * about an individual lab, and a department-to-all-entities write is the
 * cross-graft error the decision record forbids.
 */

export const MAX_DEPARTMENT_CONTEXT_NAMES = 40;

export interface PublicDepartmentCourseCreditRoute {
  departmentName: string;
  evidenceQuote: string;
  sourceUrl: string;
  observedAt?: string;
}

const publicRoute = (
  departmentName: string,
  signal: Record<string, any>,
): PublicDepartmentCourseCreditRoute | null => {
  const value = readOrgUnitCourseCreditRouteValue(signal.value);
  if (!value) return null;
  const sourceUrl = typeof signal.source?.url === 'string' ? signal.source.url : '';
  if (!sourceUrl || !isPublicHttpUrl(sourceUrl)) return null;
  const evidenceQuote = sanitizeEvidenceExcerpt(value.evidenceQuote).trim();
  if (!evidenceQuote) return null;
  return {
    departmentName,
    evidenceQuote,
    sourceUrl,
    ...(signal.observedAt ? { observedAt: new Date(signal.observedAt).toISOString() } : {}),
  };
};

/**
 * Resolves by name or alias, because `research_entities.departments[]` stores a
 * canonical `OrgUnit` name string and there is no id link between the two.
 */
export async function listDepartmentCourseCreditRoutes(
  departmentNames: string[],
): Promise<PublicDepartmentCourseCreditRoute[]> {
  const requested = Array.from(
    new Set(
      departmentNames
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_DEPARTMENT_CONTEXT_NAMES);
  if (requested.length === 0) return [];

  const orgUnits = await OrgUnit.find({
    archived: { $ne: true },
    $or: [{ name: { $in: requested } }, { aliases: { $in: requested } }],
  })
    .select('_id name')
    .lean();
  if (orgUnits.length === 0) return [];

  const nameByOrgUnitId = new Map<string, string>();
  const requestedByMatchKey = new Map<string, string>();
  for (const name of requested) requestedByMatchKey.set(orgUnitMatchKey(name), name);
  for (const unit of orgUnits as any[]) {
    // Prefer the entity's own spelling of the department over the canonical one
    // only when they normalize to the same unit, so the rendered attribution
    // matches the department pill the same page already shows.
    const spelled =
      requestedByMatchKey.get(orgUnitMatchKey(String(unit.name))) || String(unit.name);
    nameByOrgUnitId.set(String(unit._id), spelled);
  }

  const signals = await Signal.find({
    orgUnitId: { $in: (orgUnits as any[]).map((unit) => unit._id) },
    type: 'COURSE_CREDIT_PATHWAY',
    archived: { $ne: true },
  })
    .select('orgUnitId value source observedAt')
    .sort({ observedAt: -1 })
    .lean();

  const byDepartment = new Map<string, PublicDepartmentCourseCreditRoute>();
  for (const signal of signals as any[]) {
    const departmentName = nameByOrgUnitId.get(String(signal.orgUnitId));
    if (!departmentName || byDepartment.has(departmentName)) continue;
    const route = publicRoute(departmentName, signal);
    if (route) byDepartment.set(departmentName, route);
  }

  return Array.from(byDepartment.values()).sort((left, right) =>
    left.departmentName.localeCompare(right.departmentName),
  );
}
