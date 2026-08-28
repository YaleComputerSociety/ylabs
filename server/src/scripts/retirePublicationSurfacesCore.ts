/**
 * Pure contract for `retire:publication-surfaces`.
 *
 * Retires the publication mirror that the product model excludes from the
 * directory: `paper` and `scholarlyLink` observations, plus the
 * `research_scholarly_links` and `research_scholarly_attributions`
 * collections.
 *
 * `user` and `researchGroupMember` observations are NOT retired. Those names
 * are residue from the retired User and ResearchGroupMember models, but the
 * lanes are live: they still carry person and roster provenance that
 * materializes into Researcher and RoleAssignment. Renaming those enum values
 * is a separate migration.
 */

export const RETIRED_OBSERVATION_ENTITY_TYPES = ['paper', 'scholarlyLink'] as const;

export const PRESERVED_OBSERVATION_ENTITY_TYPES = [
  'researchEntity',
  'researchEntityRelationship',
  'fellowship',
  'user',
  'researchGroupMember',
] as const;

export const RETIRED_SCHOLARLY_COLLECTIONS = [
  'research_scholarly_links',
  'research_scholarly_attributions',
] as const;

export interface ScholarlyLinkAttachmentSnapshot {
  totalLinks: number;
  linksWithResearchEntityId: number;
  linksWithResolvableOwner: number;
}

/**
 * Fails closed when any scholarly link is still reachable from the product.
 *
 * These rows are only safe to drop because every one of them is unattachable:
 * no `researchEntityId`, and a `userId` that resolves to neither a Researcher
 * nor an Account, so neither serving path in researchGroupService can return
 * them. On a database where they ARE attached, retiring them would remove
 * live PI profile links, so refuse instead of guessing.
 */
export function assertScholarlyLinksAreUnattachable(
  snapshot: ScholarlyLinkAttachmentSnapshot,
): void {
  if (snapshot.linksWithResearchEntityId > 0) {
    throw new Error(
      `retire:publication-surfaces refused: ${snapshot.linksWithResearchEntityId} of ${snapshot.totalLinks} scholarly links carry a researchEntityId and are servable. Re-audit before retiring.`,
    );
  }
  if (snapshot.linksWithResolvableOwner > 0) {
    throw new Error(
      `retire:publication-surfaces refused: ${snapshot.linksWithResolvableOwner} of ${snapshot.totalLinks} scholarly links resolve to a Researcher or Account owner. Re-audit before retiring.`,
    );
  }
}

export interface RetirePublicationSurfacesInvariantInput {
  retiredObservationsAfter: number;
  preservedObservationsBefore: Record<string, number>;
  preservedObservationsAfter: Record<string, number>;
  remainingScholarlyCollections: readonly string[];
}

export function assertRetirePublicationSurfacesInvariants(
  input: RetirePublicationSurfacesInvariantInput,
): void {
  if (input.retiredObservationsAfter !== 0) {
    throw new Error(
      `retire:publication-surfaces invariant violated: ${input.retiredObservationsAfter} retired-type observations remain after apply.`,
    );
  }
  if (input.remainingScholarlyCollections.length > 0) {
    throw new Error(
      `retire:publication-surfaces invariant violated: collections still present after apply: ${input.remainingScholarlyCollections.join(', ')}.`,
    );
  }
  for (const entityType of PRESERVED_OBSERVATION_ENTITY_TYPES) {
    const before = input.preservedObservationsBefore[entityType] ?? 0;
    const after = input.preservedObservationsAfter[entityType] ?? 0;
    if (before !== after) {
      throw new Error(
        `retire:publication-surfaces invariant violated: ${entityType} observations changed from ${before} to ${after}. Only paper and scholarlyLink rows may be removed.`,
      );
    }
  }
}
