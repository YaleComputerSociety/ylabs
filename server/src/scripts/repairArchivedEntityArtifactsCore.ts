export type ArchivedEntityArtifactType =
  | 'EntryPathway'
  | 'AccessSignal'
  | 'ContactRoute'
  | 'PostedOpportunity';

export interface ArchivedEntityArtifact {
  artifactType: ArchivedEntityArtifactType;
  id: string;
  researchEntityId: string;
  canonicalResearchEntityId: string;
  derivationKey?: string;
  signalType?: string;
  entryPathwayId?: string;
}

export interface ArchivedEntityArtifactRepairPlan {
  relink: Array<{
    artifactType: ArchivedEntityArtifactType;
    id: string;
    canonicalResearchEntityId: string;
  }>;
  mergeAndArchive: Array<{
    artifactType: ArchivedEntityArtifactType;
    duplicateId: string;
    canonicalId: string;
  }>;
  archiveWithoutCanonical: Array<{
    artifactType: ArchivedEntityArtifactType;
    id: string;
  }>;
  skipped: Array<{
    artifactType: ArchivedEntityArtifactType;
    id: string;
    reason: 'missing-canonical-entity' | 'missing-artifact-identity';
  }>;
}

function artifactIdentityKey(artifact: ArchivedEntityArtifact): string {
  const derivationKey = (artifact.derivationKey || '').trim();
  if (!derivationKey) return '';

  if (artifact.artifactType === 'AccessSignal') {
    const signalType = (artifact.signalType || '').trim();
    return signalType ? `${artifact.artifactType}:${signalType}:${derivationKey}` : '';
  }

  if (artifact.artifactType === 'PostedOpportunity') {
    const entryPathwayId = (artifact.entryPathwayId || '').trim();
    return entryPathwayId ? `${artifact.artifactType}:${entryPathwayId}:${derivationKey}` : '';
  }

  return `${artifact.artifactType}:${derivationKey}`;
}

export function buildArchivedEntityArtifactRepairPlan({
  artifacts,
  canonicalArtifacts = [],
}: {
  artifacts: ArchivedEntityArtifact[];
  canonicalArtifacts?: ArchivedEntityArtifact[];
}): ArchivedEntityArtifactRepairPlan {
  const canonicalByIdentity = new Map<string, ArchivedEntityArtifact>();
  for (const artifact of canonicalArtifacts) {
    const key = artifactIdentityKey(artifact);
    if (key) canonicalByIdentity.set(`${artifact.canonicalResearchEntityId}:${key}`, artifact);
  }

  const plan: ArchivedEntityArtifactRepairPlan = {
    relink: [],
    mergeAndArchive: [],
    archiveWithoutCanonical: [],
    skipped: [],
  };

  for (const artifact of artifacts) {
    if (!artifact.canonicalResearchEntityId) {
      plan.archiveWithoutCanonical.push({
        artifactType: artifact.artifactType,
        id: artifact.id,
      });
      continue;
    }

    const identity = artifactIdentityKey(artifact);
    const canonicalMatch = identity
      ? canonicalByIdentity.get(`${artifact.canonicalResearchEntityId}:${identity}`)
      : undefined;
    if (canonicalMatch?.id) {
      plan.mergeAndArchive.push({
        artifactType: artifact.artifactType,
        duplicateId: artifact.id,
        canonicalId: canonicalMatch.id,
      });
      continue;
    }

    plan.relink.push({
      artifactType: artifact.artifactType,
      id: artifact.id,
      canonicalResearchEntityId: artifact.canonicalResearchEntityId,
    });
  }

  return plan;
}
