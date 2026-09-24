export const BYPASS_EDGE_VERDICTS = ['archive_bypassing_edge', 'keep_no_bypass'] as const;
export type BypassEdgeVerdict = (typeof BYPASS_EDGE_VERDICTS)[number];

export interface DetachedLeadEdgeLike {
  edgeId: string;
  personId: string;
  entityId: string;
  role: string;
}

export interface LeadEdgeLike {
  edgeId: string;
  personId: string;
  entityId: string;
  role: string;
  archived: boolean;
  reviewStatus?: string | null;
}

export const DETACHED_REVIEW_STATUS = 'DISPUTED';

export interface BypassPlanInput {
  detached: DetachedLeadEdgeLike;
  /** Person ids that are the same human as the detached person, excluding it. */
  twinPersonIds: ReadonlyArray<string>;
  /** Every lead edge on the detached edge's entity, in any state. */
  entityLeadEdges: ReadonlyArray<LeadEdgeLike>;
}

export interface BypassPlan {
  entityId: string;
  verdict: BypassEdgeVerdict;
  /** Live, non-detached edges held by a twin on the same entity and role. */
  bypassingEdgeIds: string[];
  /**
   * Live lead edges that would remain if the bypassing edges were archived, held
   * by somebody other than the detached person or its twins. This is what decides
   * whether the row is held on `missing_lead` or keeps a lead, and it must be
   * read with the CANONICAL role values: `role_assignments.role` stores `PI`,
   * while the served-member comparison set holds the legacy `pi`, so filtering
   * stored edges by the legacy set matches nothing and reads as 0 (#3182).
   */
  survivingLeadEdgeIds: string[];
}

const isLive = (edge: LeadEdgeLike): boolean =>
  !edge.archived && edge.reviewStatus !== DETACHED_REVIEW_STATUS;

/**
 * A detachment is keyed to a `personId`, so a second row for the same human
 * carries a fresh edge that the detachment never touches and the entity serves
 * the lead again. The repair archives that bypassing edge rather than repointing
 * it, because the operator's judgement was about the human and not about the row.
 *
 * Nothing is minted to fill the slot. Where no other live lead edge remains the
 * row is left to the gate to hold on `missing_lead`, which `docs/decisions.md`
 * records as the intended outcome: a student writing to a lead the corpus cannot
 * support is worse than a lab that is held.
 */
export function planDetachmentBypassRepair(input: BypassPlanInput): BypassPlan {
  const twins = new Set(input.twinPersonIds.map(String));
  const detachedPersonId = String(input.detached.personId);

  const bypassing = input.entityLeadEdges.filter(
    (edge) =>
      twins.has(String(edge.personId)) &&
      edge.role === input.detached.role &&
      String(edge.edgeId) !== String(input.detached.edgeId) &&
      isLive(edge),
  );

  const bypassingIds = new Set(bypassing.map((edge) => String(edge.edgeId)));
  const surviving = input.entityLeadEdges.filter(
    (edge) =>
      !bypassingIds.has(String(edge.edgeId)) &&
      String(edge.personId) !== detachedPersonId &&
      !twins.has(String(edge.personId)) &&
      isLive(edge),
  );

  return {
    entityId: String(input.detached.entityId),
    verdict: bypassing.length > 0 ? 'archive_bypassing_edge' : 'keep_no_bypass',
    bypassingEdgeIds: Array.from(bypassingIds),
    survivingLeadEdgeIds: surviving.map((edge) => String(edge.edgeId)),
  };
}
