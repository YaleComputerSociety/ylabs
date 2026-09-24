/**
 * The classification behind `research-entity:audit-kind-typing` (#2884).
 *
 * The `LAB` versus `FACULTY_RESEARCH_AREA` rule was emergent rather than expressed,
 * so a mis-typed row was invisible. This reports the three contradiction sets the
 * 2026-09-21 decision in `docs/decisions.md` names, and reports only: nothing here
 * demotes, merges or suppresses a row, because a contradicting row may be mis-typed
 * or mis-named and the name is the field already in doubt.
 */
import {
  researchEntityTypeNameContradiction,
  type ResearchEntityTypeNameContradiction,
} from '../utils/researchHomeNameIdentityAuthority';

export const KIND_TYPING_CONTRADICTION_EXIT_CODE = 2;

/** The roles that make a person the research home's owner rather than a member. */
export const RESEARCH_HOME_LEAD_ROLES: ReadonlySet<string> = new Set([
  'PI',
  'CO_PI',
  'DIRECTOR',
  'CO_DIRECTOR',
  'LEAD',
]);

export interface KindTypingEntityInput {
  id: string;
  slug?: unknown;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
  studentVisibilityTier?: unknown;
  websiteUrl?: unknown;
}

export interface KindTypingLeadEdgeInput {
  personId: string;
  role?: unknown;
  entityId: string;
}

export interface KindTypingContradictionRow {
  slug: string;
  entityType: string;
  contradiction: ResearchEntityTypeNameContradiction;
  served: boolean;
  hasOwnWebsiteUrl: boolean;
}

export interface KindTypingDualLeadGroup {
  labEntitySlugs: string[];
  facultyResearchAreaEntitySlugs: string[];
  servedLabs: number;
  servedFacultyResearchAreas: number;
}

export interface KindTypingAuditReport {
  labRows: number;
  facultyResearchAreaRows: number;
  servedLabRows: number;
  servedFacultyResearchAreaRows: number;
  servedLabNamesOrganizational: number;
  servedFacultyResearchAreaNamesOrganizational: number;
  contradictions: KindTypingContradictionRow[];
  contradictionCounts: Record<Exclude<ResearchEntityTypeNameContradiction, ''>, number>;
  dualLeadGroups: KindTypingDualLeadGroup[];
  dualLeadPeople: number;
  dualLeadPeopleWithBothServed: number;
  status: 'clean' | 'contradictions';
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isServed = (value: unknown): boolean => textValue(value) === 'student_ready';

export function summarizeResearchEntityKindTyping(args: {
  entities: readonly KindTypingEntityInput[];
  leadEdges: readonly KindTypingLeadEdgeInput[];
}): KindTypingAuditReport {
  const labs = args.entities.filter((row) => textValue(row.entityType).toUpperCase() === 'LAB');
  const areas = args.entities.filter(
    (row) => textValue(row.entityType).toUpperCase() === 'FACULTY_RESEARCH_AREA',
  );

  const contradictions: KindTypingContradictionRow[] = [];
  const contradictionCounts = {
    lab_named_as_a_topic: 0,
    faculty_research_area_named_as_an_organization: 0,
  };
  for (const row of [...labs, ...areas]) {
    const contradiction = researchEntityTypeNameContradiction(row);
    if (!contradiction) continue;
    contradictionCounts[contradiction] += 1;
    contradictions.push({
      slug: textValue(row.slug),
      entityType: textValue(row.entityType).toUpperCase(),
      contradiction,
      served: isServed(row.studentVisibilityTier),
      hasOwnWebsiteUrl: Boolean(textValue(row.websiteUrl)),
    });
  }

  const byId = new Map(args.entities.map((row) => [row.id, row]));
  const byPerson = new Map<string, KindTypingDualLeadGroup>();
  for (const edge of args.leadEdges) {
    if (!RESEARCH_HOME_LEAD_ROLES.has(textValue(edge.role).toUpperCase())) continue;
    const row = byId.get(edge.entityId);
    if (!row) continue;
    const entityType = textValue(row.entityType).toUpperCase();
    if (entityType !== 'LAB' && entityType !== 'FACULTY_RESEARCH_AREA') continue;
    const group =
      byPerson.get(edge.personId) ||
      ({
        labEntitySlugs: [],
        facultyResearchAreaEntitySlugs: [],
        servedLabs: 0,
        servedFacultyResearchAreas: 0,
      } satisfies KindTypingDualLeadGroup);
    const slug = textValue(row.slug);
    if (entityType === 'LAB') {
      if (!group.labEntitySlugs.includes(slug)) group.labEntitySlugs.push(slug);
      if (isServed(row.studentVisibilityTier)) group.servedLabs += 1;
    } else {
      if (!group.facultyResearchAreaEntitySlugs.includes(slug)) {
        group.facultyResearchAreaEntitySlugs.push(slug);
      }
      if (isServed(row.studentVisibilityTier)) group.servedFacultyResearchAreas += 1;
    }
    byPerson.set(edge.personId, group);
  }

  const dualLeadGroups = [...byPerson.values()].filter(
    (group) => group.labEntitySlugs.length > 0 && group.facultyResearchAreaEntitySlugs.length > 0,
  );

  const contradictionRows = contradictions.length;
  return {
    labRows: labs.length,
    facultyResearchAreaRows: areas.length,
    servedLabRows: labs.filter((row) => isServed(row.studentVisibilityTier)).length,
    servedFacultyResearchAreaRows: areas.filter((row) => isServed(row.studentVisibilityTier))
      .length,
    servedLabNamesOrganizational: labs.filter(
      (row) => isServed(row.studentVisibilityTier) && !researchEntityTypeNameContradiction(row),
    ).length,
    servedFacultyResearchAreaNamesOrganizational: areas.filter(
      (row) => isServed(row.studentVisibilityTier) && researchEntityTypeNameContradiction(row),
    ).length,
    contradictions,
    contradictionCounts,
    dualLeadGroups,
    dualLeadPeople: dualLeadGroups.length,
    dualLeadPeopleWithBothServed: dualLeadGroups.filter(
      (group) => group.servedLabs > 0 && group.servedFacultyResearchAreas > 0,
    ).length,
    status: contradictionRows > 0 || dualLeadGroups.length > 0 ? 'contradictions' : 'clean',
  };
}
