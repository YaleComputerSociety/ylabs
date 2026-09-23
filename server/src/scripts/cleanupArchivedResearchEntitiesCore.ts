import { researchEntityTypes } from '../models/researchAccessTypes';

export interface ArchivedEntityLiveReference {
  collection: string;
  field: string;
  count: number;
}

export type ArchivedResearchEntityDeferralReason =
  | 'has_live_references'
  | 'merged_shell_is_canonical_mapping'
  | 'retired_entity_type';

export interface ArchivedResearchEntityCandidate {
  id: string;
  name?: string;
  slug?: string;
  entityType?: string;
  liveReferences: ArchivedEntityLiveReference[];
  redirectPresent?: boolean;
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
  requireRedirect?: boolean;
}): ArchivedResearchEntityCleanupPlan {
  const eligible: string[] = [];
  const blocked: BlockedArchivedResearchEntity[] = [];
  const deferredByReason: Record<ArchivedResearchEntityDeferralReason, number> = {
    has_live_references: 0,
    merged_shell_is_canonical_mapping: 0,
    retired_entity_type: 0,
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
    if (candidate.hasCanonicalTombstone === true || input.requireRedirect === true) {
      blocked.push({ ...identity, reason: 'merged_shell_is_canonical_mapping', references: [] });
      deferredByReason.merged_shell_is_canonical_mapping += 1;
      continue;
    }
    eligible.push(candidate.id);
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
