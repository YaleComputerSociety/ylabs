export interface ArchivedEntityLiveReference {
  collection: string;
  field: string;
  count: number;
}

export interface ArchivedResearchEntityCandidate {
  id: string;
  name?: string;
  slug?: string;
  liveReferences: ArchivedEntityLiveReference[];
}

export interface BlockedArchivedResearchEntity {
  id: string;
  name?: string;
  slug?: string;
  references: ArchivedEntityLiveReference[];
}

export interface ArchivedResearchEntityCleanupPlan {
  scanned: number;
  eligibleCount: number;
  blockedCount: number;
  eligible: string[];
  blocked: BlockedArchivedResearchEntity[];
}

export function buildArchivedResearchEntityCleanupPlan(input: {
  candidates: ArchivedResearchEntityCandidate[];
}): ArchivedResearchEntityCleanupPlan {
  const eligible: string[] = [];
  const blocked: BlockedArchivedResearchEntity[] = [];

  for (const candidate of input.candidates) {
    const references = candidate.liveReferences.filter((reference) => reference.count > 0);
    if (references.length === 0) {
      eligible.push(candidate.id);
      continue;
    }
    blocked.push({
      id: candidate.id,
      ...(candidate.name ? { name: candidate.name } : {}),
      ...(candidate.slug ? { slug: candidate.slug } : {}),
      references,
    });
  }

  return {
    scanned: input.candidates.length,
    eligibleCount: eligible.length,
    blockedCount: blocked.length,
    eligible,
    blocked,
  };
}
