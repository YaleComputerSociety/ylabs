export type UmbrellaRelationshipTargetRepairSkipReason =
  | 'not-generated-target'
  | 'missing-canonical-target'
  | 'ambiguous-pi-lab'
  | 'no-pi-lab'
  | 'profile-backed-individual'
  | 'exact-user-needs-profile-enrichment'
  | 'no-user';

export interface UmbrellaRelationshipTargetRepairCandidate {
  relationshipId: string;
  sourceResearchEntityId: string;
  targetResearchEntityId: string;
  relationshipType: string;
  targetSlug?: string;
  targetName?: string;
  sourceUrl?: string;
  confidence?: number;
  canonicalTargetId?: string;
  canonicalTargetSlug?: string;
  profileUserId?: string;
  profileUserNetid?: string;
  skippedReason?: UmbrellaRelationshipTargetRepairSkipReason;
}

export interface UmbrellaRelationshipTargetRepairPlan {
  relink: Array<{
    relationshipId: string;
    canonicalTargetId: string;
    canonicalTargetSlug?: string;
  }>;
  archiveDuplicates: Array<{
    relationshipId: string;
    canonicalRelationshipId: string;
    canonicalTargetSlug?: string;
  }>;
  attachProfileBackedIndividuals: Array<{
    relationshipId: string;
    targetResearchEntityId: string;
    targetSlug?: string;
    targetName?: string;
    sourceUrl?: string;
    confidence?: number;
    userId: string;
    userNetid?: string;
  }>;
  skipped: Array<{
    relationshipId: string;
    targetSlug?: string;
    reason: UmbrellaRelationshipTargetRepairSkipReason;
  }>;
}

function relationshipIdentity(
  sourceResearchEntityId: string,
  targetResearchEntityId: string,
  relationshipType: string,
): string {
  return [sourceResearchEntityId, targetResearchEntityId, relationshipType].join(':');
}

function isGeneratedFacultyResearchArea(slug: string | undefined): boolean {
  return (slug || '').startsWith('faculty-research-area-');
}

export function buildUmbrellaRelationshipTargetRepairPlan(
  candidates: UmbrellaRelationshipTargetRepairCandidate[],
): UmbrellaRelationshipTargetRepairPlan {
  const activeByIdentity = new Map<string, UmbrellaRelationshipTargetRepairCandidate>();
  for (const candidate of candidates) {
    activeByIdentity.set(
      relationshipIdentity(
        candidate.sourceResearchEntityId,
        candidate.targetResearchEntityId,
        candidate.relationshipType,
      ),
      candidate,
    );
  }

  const plan: UmbrellaRelationshipTargetRepairPlan = {
    relink: [],
    archiveDuplicates: [],
    attachProfileBackedIndividuals: [],
    skipped: [],
  };

  for (const candidate of candidates) {
    if (!isGeneratedFacultyResearchArea(candidate.targetSlug)) continue;

    if (!candidate.canonicalTargetId && candidate.profileUserId) {
      plan.attachProfileBackedIndividuals.push({
        relationshipId: candidate.relationshipId,
        targetResearchEntityId: candidate.targetResearchEntityId,
        targetSlug: candidate.targetSlug,
        targetName: candidate.targetName,
        sourceUrl: candidate.sourceUrl,
        confidence: candidate.confidence,
        userId: candidate.profileUserId,
        userNetid: candidate.profileUserNetid,
      });
      continue;
    }

    if (!candidate.canonicalTargetId) {
      plan.skipped.push({
        relationshipId: candidate.relationshipId,
        targetSlug: candidate.targetSlug,
        reason: candidate.skippedReason || 'missing-canonical-target',
      });
      continue;
    }

    const canonicalIdentity = relationshipIdentity(
      candidate.sourceResearchEntityId,
      candidate.canonicalTargetId,
      candidate.relationshipType,
    );
    const canonicalRelationship = activeByIdentity.get(canonicalIdentity);
    if (canonicalRelationship && canonicalRelationship.relationshipId !== candidate.relationshipId) {
      plan.archiveDuplicates.push({
        relationshipId: candidate.relationshipId,
        canonicalRelationshipId: canonicalRelationship.relationshipId,
        canonicalTargetSlug: candidate.canonicalTargetSlug || canonicalRelationship.targetSlug,
      });
      continue;
    }

    plan.relink.push({
      relationshipId: candidate.relationshipId,
      canonicalTargetId: candidate.canonicalTargetId,
      canonicalTargetSlug: candidate.canonicalTargetSlug,
    });
  }

  return plan;
}
