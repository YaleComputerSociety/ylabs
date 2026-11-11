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

export interface PersonIdentityLike {
  personId: string;
  displayName?: string | null;
  netid?: string | null;
  email?: string | null;
  orcid?: string | null;
  distinctFromPersonIds?: ReadonlyArray<string>;
}

export interface BypassPlanInput {
  detached: DetachedLeadEdgeLike;
  detachedIdentity?: PersonIdentityLike;
  twinCandidates: ReadonlyArray<PersonIdentityLike>;
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

const normalized = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const emailLocalPart = (email: string | null | undefined): string =>
  normalized(email).split('@')[0] ?? '';

const bothPresentAndDiffer = (left: string, right: string): boolean =>
  left !== '' && right !== '' && left !== right;

/**
 * A shared display name is only a proposal that two records are one human. ORCID is
 * unique and validated, and an operator's distinct-person record is a judgement, so
 * either one settles it. A netid alone does not, because an alias twin stores an email
 * local part as its netid (#4988), so a netid conflict only counts when the emails also
 * disagree and neither netid is the other's email local part (#5854).
 */
export function identitiesNameDistinctHumans(
  left: PersonIdentityLike | undefined,
  right: PersonIdentityLike | undefined,
): boolean {
  if (!left || !right) return false;
  const leftId = String(left.personId);
  const rightId = String(right.personId);
  if ((left.distinctFromPersonIds ?? []).map(String).includes(rightId)) return true;
  if ((right.distinctFromPersonIds ?? []).map(String).includes(leftId)) return true;
  if (bothPresentAndDiffer(normalized(left.orcid), normalized(right.orcid))) return true;

  const leftNetid = normalized(left.netid);
  const rightNetid = normalized(right.netid);
  const netidsDiffer = bothPresentAndDiffer(leftNetid, rightNetid);
  const emailsDiffer = bothPresentAndDiffer(normalized(left.email), normalized(right.email));
  const netidIsAliasOfOtherEmail =
    leftNetid === emailLocalPart(right.email) || rightNetid === emailLocalPart(left.email);
  return netidsDiffer && emailsDiffer && !netidIsAliasOfOtherEmail;
}

/**
 * A detachment is keyed to a `personId`, so a second row for the same human
 * carries a fresh edge that the detachment never touches and the entity serves
 * the lead again. The repair archives that bypassing edge rather than repointing
 * it. The judgement was that this human does not lead this row, so only an edge on
 * the detachment's own row is in scope, and a same-name record whose identifiers
 * name a different human is that row's other lead rather than a twin (#5854).
 *
 * Nothing is minted to fill the slot. Where no other live lead edge remains the
 * row is left to the gate to hold on `missing_lead`, which `docs/decisions.md`
 * records as the intended outcome: a student writing to a lead the corpus cannot
 * support is worse than a lab that is held.
 */
export function planDetachmentBypassRepair(input: BypassPlanInput): BypassPlan {
  const twins = new Set(
    input.twinCandidates
      .filter((candidate) => !identitiesNameDistinctHumans(input.detachedIdentity, candidate))
      .map((candidate) => String(candidate.personId)),
  );
  const detachedPersonId = String(input.detached.personId);
  const detachedEntityId = String(input.detached.entityId);

  const bypassing = input.entityLeadEdges.filter(
    (edge) =>
      String(edge.entityId) === detachedEntityId &&
      twins.has(String(edge.personId)) &&
      edge.role === input.detached.role &&
      String(edge.edgeId) !== String(input.detached.edgeId) &&
      isLive(edge),
  );

  const bypassingIds = new Set(bypassing.map((edge) => String(edge.edgeId)));
  const surviving = input.entityLeadEdges.filter(
    (edge) =>
      String(edge.entityId) === detachedEntityId &&
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

export const PAST_BYPASS_ARCHIVE_CLASSES = [
  'consistent_with_a_detachment',
  'no_detachment_on_its_entity',
  'archived_a_distinct_human',
] as const;
export type PastBypassArchiveClass = (typeof PAST_BYPASS_ARCHIVE_CLASSES)[number];

export interface PastBypassArchiveInput {
  archivedEdge: LeadEdgeLike;
  archivedIdentity?: PersonIdentityLike;
  detachments: ReadonlyArray<DetachedLeadEdgeLike & { identity?: PersonIdentityLike }>;
}

export function classifyPastBypassArchive(input: PastBypassArchiveInput): PastBypassArchiveClass {
  const archivedEntityId = String(input.archivedEdge.entityId);
  const archivedPersonId = String(input.archivedEdge.personId);
  const sameEntity = input.detachments.filter(
    (detachment) =>
      String(detachment.entityId) === archivedEntityId &&
      detachment.role === input.archivedEdge.role &&
      String(detachment.personId) !== archivedPersonId,
  );
  if (sameEntity.length === 0) return 'no_detachment_on_its_entity';
  const archivedDisplayName = input.archivedIdentity?.displayName ?? '';
  const anySameHuman = sameEntity.some(
    (detachment) =>
      archivedDisplayName !== '' &&
      detachment.identity?.displayName === archivedDisplayName &&
      !identitiesNameDistinctHumans(detachment.identity, input.archivedIdentity),
  );
  return anySameHuman ? 'consistent_with_a_detachment' : 'archived_a_distinct_human';
}
