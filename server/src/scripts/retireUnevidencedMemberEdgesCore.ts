/**
 * Plans the retirement of a non-lead member edge that cites nothing, on a
 * person-scoped research entity (#3161).
 *
 * A served person-scoped row listing five people as that person's graduate
 * students on no evidence is a claim about real people on a public page. This is
 * the stored residue of the whole-directory lane #2837 fixed: every edge in the
 * cohort was written in a single pass before that fix, and none has been written
 * since, so the plan is a one-time repair rather than a guard against a live
 * producer.
 */

export const UNEVIDENCED_MEMBER_EDGE_RETIREMENT_NOTE =
  'Retired by role-assignments:retire-unevidenced-member-edges (#3161): a non-lead member edge on a person-scoped entity citing no rosterProvenance. No page asserts this membership.';

/**
 * A lead edge is out of scope. The lead-graft lanes own it, it is the only edge
 * most of these rows have left, and retiring it here would blank the row rather
 * than remove a claim it cannot support.
 */
export const LEAD_ROLE_ASSIGNMENT_ROLES = new Set([
  'PI',
  'CO_PI',
  'DIRECTOR',
  'CO_DIRECTOR',
  'LEAD',
  'FACULTY_LEAD',
  'PRINCIPAL_INVESTIGATOR',
]);

/**
 * A person-scoped entity is one whose page reads as one person's research. On an
 * organization, an unattributed `CORE_FACULTY` edge is an attribution gap on a
 * body that genuinely has hundreds of affiliated faculty, which is a different
 * decision and deliberately not this repair: including them would turn a 53-edge
 * repair into a 1,019-edge one.
 */
export const PERSON_SCOPED_ENTITY_TYPES = new Set([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
]);

export interface UnevidencedMemberEdgeInput {
  id: string;
  entityId: string;
  role: string;
  hasRosterProvenance: boolean;
  archived: boolean;
}

export interface UnevidencedMemberEdgeEntityInput {
  id: string;
  slug: string;
  entityType: string;
  served: boolean;
}

export interface UnevidencedMemberEdgePlanRow {
  id: string;
  entityId: string;
  slug: string;
  role: string;
}

export interface UnevidencedMemberEdgePlan {
  retire: UnevidencedMemberEdgePlanRow[];
  /** Edges left on each touched row after the plan applies, so a caller can see no row is blanked. */
  remainingByEntityId: Record<string, number>;
  skipped: {
    leadRole: number;
    hasProvenance: number;
    notPersonScoped: number;
    notServed: number;
    unknownEntity: number;
    alreadyArchived: number;
  };
}

export function planUnevidencedMemberEdgeRetirements(
  edges: UnevidencedMemberEdgeInput[],
  entities: UnevidencedMemberEdgeEntityInput[],
): UnevidencedMemberEdgePlan {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const retire: UnevidencedMemberEdgePlanRow[] = [];
  const skipped = {
    leadRole: 0,
    hasProvenance: 0,
    notPersonScoped: 0,
    notServed: 0,
    unknownEntity: 0,
    alreadyArchived: 0,
  };

  const liveByEntityId = new Map<string, number>();
  for (const edge of edges) {
    if (edge.archived) continue;
    liveByEntityId.set(edge.entityId, (liveByEntityId.get(edge.entityId) || 0) + 1);
  }

  for (const edge of edges) {
    if (edge.archived) {
      skipped.alreadyArchived += 1;
      continue;
    }
    if (edge.hasRosterProvenance) {
      skipped.hasProvenance += 1;
      continue;
    }
    if (LEAD_ROLE_ASSIGNMENT_ROLES.has(edge.role)) {
      skipped.leadRole += 1;
      continue;
    }
    const entity = entityById.get(edge.entityId);
    if (!entity) {
      skipped.unknownEntity += 1;
      continue;
    }
    if (!PERSON_SCOPED_ENTITY_TYPES.has(entity.entityType)) {
      skipped.notPersonScoped += 1;
      continue;
    }
    if (!entity.served) {
      skipped.notServed += 1;
      continue;
    }
    retire.push({ id: edge.id, entityId: edge.entityId, slug: entity.slug, role: edge.role });
  }

  const retiredByEntityId = new Map<string, number>();
  for (const row of retire) {
    retiredByEntityId.set(row.entityId, (retiredByEntityId.get(row.entityId) || 0) + 1);
  }
  const remainingByEntityId: Record<string, number> = {};
  for (const [entityId, retiredCount] of retiredByEntityId) {
    remainingByEntityId[entityId] = (liveByEntityId.get(entityId) || 0) - retiredCount;
  }

  return { retire, remainingByEntityId, skipped };
}

/**
 * A row that would keep no edge at all is a finding rather than a step, because
 * removing every member leaves a served page asserting nobody, which is a worse
 * surface than the one being repaired.
 */
export function entityIdsLeftWithNoEdge(plan: UnevidencedMemberEdgePlan): string[] {
  return Object.entries(plan.remainingByEntityId)
    .filter(([, remaining]) => remaining <= 0)
    .map(([entityId]) => entityId);
}
