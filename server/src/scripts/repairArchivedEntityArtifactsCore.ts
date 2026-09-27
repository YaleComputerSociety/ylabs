import mongoose from 'mongoose';
import {
  walkResearchEntityTombstoneChain,
  type ResearchEntityTombstoneNode,
} from '../services/researchEntityCanonicalTombstone';

export const archivedEntityArtifactTypes = ['RoleAssignment', 'AccessSignal'] as const;
export type ArchivedEntityArtifactType = (typeof archivedEntityArtifactTypes)[number];

export const archivedEntityRepairClasses = [
  'merge-survivor',
  'merge-dead-end',
  'no-canonical',
] as const;
export type ArchivedEntityRepairClass = (typeof archivedEntityRepairClasses)[number];

export const ARCHIVED_REASON_ABSENT = '(none)';

export interface ArchivedEntityNode {
  id: string;
  archived: boolean;
  canonicalGroupId?: string;
  archivedReason?: string;
  archivedAt?: Date;
}

export interface ArchivedEntityDisposition {
  archivedEntityId: string;
  repairClass: ArchivedEntityRepairClass;
  survivorId?: string;
  archivedReason: string;
  archivedAt?: Date;
}

export interface ArchivedEntityArtifact {
  artifactType: ArchivedEntityArtifactType;
  id: string;
  researchEntityId: string;
  personId?: string;
  role?: string;
  signalType?: string;
  derivationKey?: string;
}

export interface ArchivedEntityRepairScope {
  classes?: ReadonlySet<ArchivedEntityRepairClass>;
  archivedReasons?: ReadonlySet<string>;
  archivedSince?: Date;
  archivedBefore?: Date;
  entityIds?: ReadonlySet<string>;
}

interface PlanItemBase {
  artifactType: ArchivedEntityArtifactType;
  repairClass: ArchivedEntityRepairClass;
  archivedEntityId: string;
  archivedReason: string;
}

export interface ArchivedEntityArtifactRepairPlan {
  relink: Array<PlanItemBase & { id: string; canonicalResearchEntityId: string }>;
  mergeAndArchive: Array<
    PlanItemBase & { duplicateId: string; canonicalId: string; canonicalResearchEntityId: string }
  >;
  archiveWithoutCanonical: Array<PlanItemBase & { id: string }>;
  skipped: Array<
    PlanItemBase & { id: string; reason: 'merge-chain-dead-end' | 'missing-disposition' }
  >;
}

export interface ArchivedEntityRepairClassSummary {
  relink: number;
  mergeAndArchive: number;
  archiveWithoutCanonical: number;
  skipped: number;
  archivedEntities: number;
  byArtifactType: Partial<Record<ArchivedEntityArtifactType, number>>;
  byArchivedReason: Record<string, number>;
}

function objectIdOrNull(value: string | undefined): mongoose.Types.ObjectId | null {
  return value && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function tombstoneNode(node: ArchivedEntityNode): ResearchEntityTombstoneNode | null {
  const id = objectIdOrNull(node.id);
  if (!id) return null;
  return {
    _id: id,
    archived: node.archived,
    canonicalGroupId: objectIdOrNull(node.canonicalGroupId),
  };
}

export async function resolveArchivedEntityDispositions(
  archivedEntities: ArchivedEntityNode[],
  nodesById: ReadonlyMap<string, ArchivedEntityNode>,
): Promise<Map<string, ArchivedEntityDisposition>> {
  const findById = async (id: string): Promise<ResearchEntityTombstoneNode | null> => {
    const node = nodesById.get(id);
    return node ? tombstoneNode(node) : null;
  };
  const dispositions = new Map<string, ArchivedEntityDisposition>();
  for (const entity of archivedEntities) {
    const archivedReason = entity.archivedReason?.trim() || ARCHIVED_REASON_ABSENT;
    const base = { archivedEntityId: entity.id, archivedReason, archivedAt: entity.archivedAt };
    if (!entity.canonicalGroupId) {
      dispositions.set(entity.id, { ...base, repairClass: 'no-canonical' });
      continue;
    }
    const start = tombstoneNode(entity);
    const survivor = start ? await walkResearchEntityTombstoneChain(start, { findById }) : null;
    dispositions.set(
      entity.id,
      survivor
        ? { ...base, repairClass: 'merge-survivor', survivorId: String(survivor._id) }
        : { ...base, repairClass: 'merge-dead-end' },
    );
  }
  return dispositions;
}

export function dispositionMatchesScope(
  disposition: ArchivedEntityDisposition,
  scope: ArchivedEntityRepairScope,
): boolean {
  if (scope.classes && !scope.classes.has(disposition.repairClass)) return false;
  if (scope.archivedReasons && !scope.archivedReasons.has(disposition.archivedReason)) {
    return false;
  }
  if (scope.entityIds && !scope.entityIds.has(disposition.archivedEntityId)) return false;
  if (scope.archivedSince || scope.archivedBefore) {
    const archivedAt = disposition.archivedAt?.getTime();
    if (archivedAt === undefined || Number.isNaN(archivedAt)) return false;
    if (scope.archivedSince && archivedAt < scope.archivedSince.getTime()) return false;
    if (scope.archivedBefore && archivedAt >= scope.archivedBefore.getTime()) return false;
  }
  return true;
}

function artifactIdentityKey(artifact: ArchivedEntityArtifact): string {
  if (artifact.artifactType === 'RoleAssignment') {
    const personId = (artifact.personId || '').trim();
    const role = (artifact.role || '').trim();
    return personId && role ? `${artifact.artifactType}:${role}:${personId}` : '';
  }
  const signalType = (artifact.signalType || '').trim();
  const derivationKey = (artifact.derivationKey || '').trim();
  return signalType && derivationKey
    ? `${artifact.artifactType}:${signalType}:${derivationKey}`
    : '';
}

export function buildArchivedEntityArtifactRepairPlan({
  artifacts,
  dispositions,
  canonicalArtifacts = [],
}: {
  artifacts: ArchivedEntityArtifact[];
  dispositions: ReadonlyMap<string, ArchivedEntityDisposition>;
  canonicalArtifacts?: ArchivedEntityArtifact[];
}): ArchivedEntityArtifactRepairPlan {
  const survivorArtifactByIdentity = new Map<string, string>();
  for (const artifact of canonicalArtifacts) {
    const key = artifactIdentityKey(artifact);
    if (key) survivorArtifactByIdentity.set(`${artifact.researchEntityId}:${key}`, artifact.id);
  }

  const plan: ArchivedEntityArtifactRepairPlan = {
    relink: [],
    mergeAndArchive: [],
    archiveWithoutCanonical: [],
    skipped: [],
  };

  for (const artifact of artifacts) {
    const disposition = dispositions.get(artifact.researchEntityId);
    if (!disposition) {
      plan.skipped.push({
        artifactType: artifact.artifactType,
        repairClass: 'merge-dead-end',
        archivedEntityId: artifact.researchEntityId,
        archivedReason: ARCHIVED_REASON_ABSENT,
        id: artifact.id,
        reason: 'missing-disposition',
      });
      continue;
    }
    const base: PlanItemBase = {
      artifactType: artifact.artifactType,
      repairClass: disposition.repairClass,
      archivedEntityId: disposition.archivedEntityId,
      archivedReason: disposition.archivedReason,
    };

    if (disposition.repairClass === 'no-canonical') {
      plan.archiveWithoutCanonical.push({ ...base, id: artifact.id });
      continue;
    }
    if (disposition.repairClass === 'merge-dead-end' || !disposition.survivorId) {
      plan.skipped.push({ ...base, id: artifact.id, reason: 'merge-chain-dead-end' });
      continue;
    }

    const survivorId = disposition.survivorId;
    const identity = artifactIdentityKey(artifact);
    const survivorKey = identity ? `${survivorId}:${identity}` : '';
    const existing = survivorKey ? survivorArtifactByIdentity.get(survivorKey) : undefined;
    if (existing) {
      plan.mergeAndArchive.push({
        ...base,
        duplicateId: artifact.id,
        canonicalId: existing,
        canonicalResearchEntityId: survivorId,
      });
      continue;
    }

    plan.relink.push({ ...base, id: artifact.id, canonicalResearchEntityId: survivorId });
    if (survivorKey) survivorArtifactByIdentity.set(survivorKey, artifact.id);
  }

  return plan;
}

export function summarizeArchivedEntityArtifactRepairPlanByClass(
  plan: ArchivedEntityArtifactRepairPlan,
): Partial<Record<ArchivedEntityRepairClass, ArchivedEntityRepairClassSummary>> {
  const summaries: Partial<Record<ArchivedEntityRepairClass, ArchivedEntityRepairClassSummary>> =
    {};
  const entitiesByClass = new Map<ArchivedEntityRepairClass, Set<string>>();
  const record = (
    item: PlanItemBase,
    action: 'relink' | 'mergeAndArchive' | 'archiveWithoutCanonical' | 'skipped',
  ) => {
    const summary = (summaries[item.repairClass] ||= {
      relink: 0,
      mergeAndArchive: 0,
      archiveWithoutCanonical: 0,
      skipped: 0,
      archivedEntities: 0,
      byArtifactType: {},
      byArchivedReason: {},
    });
    summary[action] += 1;
    summary.byArtifactType[item.artifactType] =
      (summary.byArtifactType[item.artifactType] || 0) + 1;
    summary.byArchivedReason[item.archivedReason] =
      (summary.byArchivedReason[item.archivedReason] || 0) + 1;
    const entities = entitiesByClass.get(item.repairClass) || new Set<string>();
    entities.add(item.archivedEntityId);
    entitiesByClass.set(item.repairClass, entities);
    summary.archivedEntities = entities.size;
  };
  plan.relink.forEach((item) => record(item, 'relink'));
  plan.mergeAndArchive.forEach((item) => record(item, 'mergeAndArchive'));
  plan.archiveWithoutCanonical.forEach((item) => record(item, 'archiveWithoutCanonical'));
  plan.skipped.forEach((item) => record(item, 'skipped'));
  return summaries;
}

export function archivedEntityArtifactPlanWriteCount(
  plan: ArchivedEntityArtifactRepairPlan,
): number {
  return plan.relink.length + plan.mergeAndArchive.length + plan.archiveWithoutCanonical.length;
}
