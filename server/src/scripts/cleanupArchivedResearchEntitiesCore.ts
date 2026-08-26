export interface ArchivedEntityLiveReference {
  collection: string;
  field: string;
  count: number;
}

export type ArchivedResearchEntityDeferralReason = 'has_live_references' | 'missing_redirect';

export interface ArchivedResearchEntityCandidate {
  id: string;
  name?: string;
  slug?: string;
  liveReferences: ArchivedEntityLiveReference[];
  redirectPresent?: boolean;
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

export function buildArchivedResearchEntityCleanupPlan(input: {
  candidates: ArchivedResearchEntityCandidate[];
  requireRedirect?: boolean;
}): ArchivedResearchEntityCleanupPlan {
  const eligible: string[] = [];
  const blocked: BlockedArchivedResearchEntity[] = [];
  const deferredByReason: Record<ArchivedResearchEntityDeferralReason, number> = {
    has_live_references: 0,
    missing_redirect: 0,
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
    if (input.requireRedirect && candidate.redirectPresent !== true) {
      blocked.push({ ...identity, reason: 'missing_redirect', references: [] });
      deferredByReason.missing_redirect += 1;
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
