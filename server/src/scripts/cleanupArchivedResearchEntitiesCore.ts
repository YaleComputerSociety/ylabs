import { researchEntityTypes } from '../models/researchAccessTypes';

export interface ArchivedEntityLiveReference {
  collection: string;
  field: string;
  count: number;
}

export type ArchivedResearchEntityDeferralReason =
  | 'has_live_references'
  | 'merged_shell_is_canonical_mapping'
  | 'retired_entity_type'
  | 'sole_surviving_record_of_slug';

export interface ArchivedResearchEntityCandidate {
  id: string;
  name?: string;
  slug?: string;
  entityType?: string;
  liveReferences: ArchivedEntityLiveReference[];
  hasCanonicalTombstone?: boolean;
}

export interface BlockedArchivedResearchEntity {
  id: string;
  name?: string;
  slug?: string;
  reason: ArchivedResearchEntityDeferralReason;
  references: ArchivedEntityLiveReference[];
}

export interface ArchivedResearchEntityCleanupPlan {
  scanned: number;
  eligibleCount: number;
  blockedCount: number;
  eligible: string[];
  blocked: BlockedArchivedResearchEntity[];
  deferredByReason: Record<ArchivedResearchEntityDeferralReason, number>;
}

/**
 * Retirement residue: rows archived because their `entityType` was retired from the
 * product model (see `research-entity:retire-program-entities`). Archiving them was
 * chosen over hard deletion precisely because it is reversible, so this op must not
 * quietly complete the deletion its sibling deliberately declined to do.
 */
export function isRetiredEntityTypeResidue(entityType: string | undefined): boolean {
  return (
    typeof entityType === 'string' &&
    entityType !== '' &&
    !(researchEntityTypes as readonly string[]).includes(entityType)
  );
}

export function buildArchivedResearchEntityCleanupPlan(input: {
  candidates: ArchivedResearchEntityCandidate[];
  mergeResidueOnly?: boolean;
}): ArchivedResearchEntityCleanupPlan {
  const eligible: string[] = [];
  const blocked: BlockedArchivedResearchEntity[] = [];
  const deferredByReason: Record<ArchivedResearchEntityDeferralReason, number> = {
    has_live_references: 0,
    merged_shell_is_canonical_mapping: 0,
    retired_entity_type: 0,
    sole_surviving_record_of_slug: 0,
  };

  for (const candidate of input.candidates) {
    const identity = {
      id: candidate.id,
      ...(candidate.name ? { name: candidate.name } : {}),
      ...(candidate.slug ? { slug: candidate.slug } : {}),
    };
    const references = candidate.liveReferences.filter((reference) => reference.count > 0);
    if (references.length > 0) {
      blocked.push({ ...identity, reason: 'has_live_references', references });
      deferredByReason.has_live_references += 1;
      continue;
    }
    if (isRetiredEntityTypeResidue(candidate.entityType)) {
      blocked.push({ ...identity, reason: 'retired_entity_type', references: [] });
      deferredByReason.retired_entity_type += 1;
      continue;
    }
    // A merged shell IS the canonical mapping (#3027): its slug occupies the unique
    // index so no re-scrape can re-mint the duplicate, and its `canonicalGroupId`
    // routes that re-scraped evidence to the survivor. Deleting it frees the slug,
    // so the next sweep of the still-live source mints the duplicate again. Never
    // deletable, whatever a redirect row says.
    if (candidate.hasCanonicalTombstone === true || input.mergeResidueOnly === true) {
      blocked.push({ ...identity, reason: 'merged_shell_is_canonical_mapping', references: [] });
      deferredByReason.merged_shell_is_canonical_mapping += 1;
      continue;
    }
    // The least-recorded row was the one this op would delete (#2795). This arm
    // demanded a `research_entity_redirects` row; that ledger is retired (#3027), so
    // it now tests the condition the redirect was standing in for. With no
    // `canonicalGroupId`, nothing routes this slug, so the row itself is the only
    // surviving record of what it was, and its name, citations and description are
    // the material anyone would need to work out where it should point. Deleting it
    // turns a fixable 404 into a permanent one, so the absence of a record is the
    // strongest reason to refuse rather than a licence to delete.
    //
    // With the arm above this one, that makes no archived row deletable and
    // `eligibleCount` 0 by construction. A genuine deletion needs its own safety
    // argument rather than a loosened arm here.
    blocked.push({ ...identity, reason: 'sole_surviving_record_of_slug', references: [] });
    deferredByReason.sole_surviving_record_of_slug += 1;
  }

  return {
    scanned: input.candidates.length,
    eligibleCount: eligible.length,
    blockedCount: blocked.length,
    eligible,
    blocked,
    deferredByReason,
  };
}
