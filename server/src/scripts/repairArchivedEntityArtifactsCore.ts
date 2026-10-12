import mongoose from 'mongoose';
import {
  tombstoneTerminalCauseIsMalformed,
  walkResearchEntityTombstoneChainWithCause,
  type ResearchEntityTombstoneNode,
  type ResearchEntityTombstoneTerminalCause,
} from '../services/researchEntityCanonicalTombstone';
import {
  planRoleEdgeSettlements,
  type RoleEdgeSettlement,
} from '../services/archivedResearchEntityRoleEdges';
import {
  planAccessSignalSettlements,
  type AccessSignalSettlement,
} from '../services/archivedResearchEntityAccessSignals';

export const archivedEntityArtifactTypes = ['RoleAssignment', 'AccessSignal'] as const;
export type ArchivedEntityArtifactType = (typeof archivedEntityArtifactTypes)[number];

export const archivedEntityRepairClasses = [
  'merge-survivor',
  'merge-no-live-home',
  'merge-dead-end',
  'no-canonical',
] as const;
export type ArchivedEntityRepairClass = (typeof archivedEntityRepairClasses)[number];

export const ARCHIVED_REASON_ABSENT = '(none)';

export const OPERATOR_ARCHIVED_REASON_PREFIX = 'operator:';

export const roleEdgeDispositions = ['settle', 'detach-disputed'] as const;
export type RoleEdgeDisposition = (typeof roleEdgeDispositions)[number];

export function isOperatorArchivedReason(archivedReason: string): boolean {
  return (
    archivedReason.startsWith(OPERATOR_ARCHIVED_REASON_PREFIX) &&
    archivedReason.length > OPERATOR_ARCHIVED_REASON_PREFIX.length
  );
}

export function disputedDetachmentReviewNote(archivedReason: string): string {
  return `Detached by an operator: the research row was archived as ${archivedReason}, so its lead claim is disputed rather than ended (#4917).`;
}

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
  terminalCause?: ResearchEntityTombstoneTerminalCause;
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
  detachDisputed: Array<PlanItemBase & { id: string }>;
  skipped: Array<
    PlanItemBase & {
      id: string;
      reason: 'merge-chain-dead-end' | 'missing-disposition' | 'not-an-operator-archive';
    }
  >;
}

export interface ArchivedEntityRepairClassSummary {
  relink: number;
  mergeAndArchive: number;
  archiveWithoutCanonical: number;
  detachDisputed: number;
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
    const chain = start
      ? await walkResearchEntityTombstoneChainWithCause(start, { findById })
      : { canonical: null, terminalCause: 'absent_target' as const };
    if (chain.canonical) {
      dispositions.set(entity.id, {
        ...base,
        repairClass: 'merge-survivor',
        survivorId: String(chain.canonical._id),
      });
      continue;
    }
    dispositions.set(entity.id, {
      ...base,
      repairClass: tombstoneTerminalCauseIsMalformed(chain.terminalCause)
        ? 'merge-dead-end'
        : 'merge-no-live-home',
      terminalCause: chain.terminalCause,
    });
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

export function buildArchivedEntityArtifactRepairPlan({
  artifacts,
  dispositions,
  canonicalArtifacts = [],
  roleEdgeDisposition = 'settle',
}: {
  artifacts: ArchivedEntityArtifact[];
  dispositions: ReadonlyMap<string, ArchivedEntityDisposition>;
  canonicalArtifacts?: ArchivedEntityArtifact[];
  roleEdgeDisposition?: RoleEdgeDisposition;
}): ArchivedEntityArtifactRepairPlan {
  const plan: ArchivedEntityArtifactRepairPlan = {
    relink: [],
    mergeAndArchive: [],
    archiveWithoutCanonical: [],
    detachDisputed: [],
    skipped: [],
  };
  const settleableRoleEdges: ArchivedEntityArtifact[] = [];
  const settleableSignals: ArchivedEntityArtifact[] = [];

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

    if (disposition.repairClass === 'merge-dead-end') {
      plan.skipped.push({ ...base, id: artifact.id, reason: 'merge-chain-dead-end' });
      continue;
    }
    if (artifact.artifactType === 'RoleAssignment' && roleEdgeDisposition === 'detach-disputed') {
      // A disputed detachment records the operator's judgement about the lead, so it is only
      // offered where an operator, not a lane, archived the row.
      if (!isOperatorArchivedReason(disposition.archivedReason)) {
        plan.skipped.push({ ...base, id: artifact.id, reason: 'not-an-operator-archive' });
      } else {
        plan.detachDisputed.push({ ...base, id: artifact.id });
      }
      continue;
    }
    if (artifact.artifactType === 'RoleAssignment') {
      settleableRoleEdges.push(artifact);
      continue;
    }
    if (disposition.repairClass === 'merge-survivor' && !disposition.survivorId) {
      plan.skipped.push({ ...base, id: artifact.id, reason: 'merge-chain-dead-end' });
      continue;
    }
    settleableSignals.push(artifact);
  }

  addAccessSignalSettlementsToPlan(plan, settleableSignals, dispositions, canonicalArtifacts);
  addRoleEdgeSettlementsToPlan(plan, settleableRoleEdges, dispositions, canonicalArtifacts);
  return plan;
}

const survivorIdOf = (
  dispositions: ReadonlyMap<string, ArchivedEntityDisposition>,
  archivedEntityId: string,
): string | undefined => {
  const disposition = dispositions.get(archivedEntityId);
  return disposition?.repairClass === 'merge-survivor' ? disposition.survivorId : undefined;
};

const planItemBase = (
  artifactType: ArchivedEntityArtifactType,
  disposition: ArchivedEntityDisposition,
): PlanItemBase => ({
  artifactType,
  repairClass: disposition.repairClass,
  archivedEntityId: disposition.archivedEntityId,
  archivedReason: disposition.archivedReason,
});

// Signals are planned by the same function an archive runs inline (#4816).
function addAccessSignalSettlementsToPlan(
  plan: ArchivedEntityArtifactRepairPlan,
  signals: ArchivedEntityArtifact[],
  dispositions: ReadonlyMap<string, ArchivedEntityDisposition>,
  canonicalArtifacts: ArchivedEntityArtifact[],
): void {
  const settlements = planAccessSignalSettlements({
    signals: signals.map((signal) => ({
      id: signal.id,
      archivedEntityId: signal.researchEntityId,
      signalType: signal.signalType || '',
      derivationKey: signal.derivationKey || '',
    })),
    survivorIdFor: (archivedEntityId) => survivorIdOf(dispositions, archivedEntityId),
    survivorSignals: canonicalArtifacts
      .filter((artifact) => artifact.artifactType === 'AccessSignal')
      .map((artifact) => ({
        id: artifact.id,
        survivorId: artifact.researchEntityId,
        signalType: artifact.signalType || '',
        derivationKey: artifact.derivationKey || '',
      })),
  });
  for (const settlement of settlements) {
    const disposition = dispositions.get(settlement.archivedEntityId);
    if (!disposition) continue;
    const base = planItemBase('AccessSignal', disposition);
    if (settlement.action === 'relink') {
      plan.relink.push({
        ...base,
        id: settlement.signalId,
        canonicalResearchEntityId: settlement.survivorId,
      });
    } else if (settlement.action === 'merge-and-archive') {
      plan.mergeAndArchive.push({
        ...base,
        duplicateId: settlement.signalId,
        canonicalId: settlement.survivorSignalId,
        canonicalResearchEntityId: settlement.survivorId,
      });
    } else {
      plan.archiveWithoutCanonical.push({ ...base, id: settlement.signalId });
    }
  }
}

// Role edges are planned by the same function an archive runs inline, so the repair and
// the engine cannot disagree about what a stranded edge becomes (#4752).
function addRoleEdgeSettlementsToPlan(
  plan: ArchivedEntityArtifactRepairPlan,
  edges: ArchivedEntityArtifact[],
  dispositions: ReadonlyMap<string, ArchivedEntityDisposition>,
  canonicalArtifacts: ArchivedEntityArtifact[],
): void {
  const settlements = planRoleEdgeSettlements({
    edges: edges.map((edge) => ({
      id: edge.id,
      archivedEntityId: edge.researchEntityId,
      personId: edge.personId || '',
      role: edge.role || '',
    })),
    survivorIdFor: (archivedEntityId) => survivorIdOf(dispositions, archivedEntityId),
    survivorHoldingEdges: canonicalArtifacts
      .filter((artifact) => artifact.artifactType === 'RoleAssignment')
      .map((artifact) => ({
        id: artifact.id,
        survivorId: artifact.researchEntityId,
        personId: artifact.personId || '',
        role: artifact.role || '',
      })),
  });
  for (const settlement of settlements) {
    const disposition = dispositions.get(settlement.archivedEntityId);
    if (!disposition) continue;
    const base = planItemBase('RoleAssignment', disposition);
    if (settlement.action === 'repoint') {
      plan.relink.push({
        ...base,
        id: settlement.edgeId,
        canonicalResearchEntityId: settlement.survivorId,
      });
    } else if (settlement.action === 'archive-redundant') {
      plan.mergeAndArchive.push({
        ...base,
        duplicateId: settlement.edgeId,
        canonicalId: settlement.survivorEdgeId,
        canonicalResearchEntityId: settlement.survivorId,
      });
    } else {
      plan.archiveWithoutCanonical.push({ ...base, id: settlement.edgeId });
    }
  }
}

export function roleEdgeSettlementsFromRepairPlan(
  plan: ArchivedEntityArtifactRepairPlan,
): RoleEdgeSettlement[] {
  const isRoleEdge = (item: PlanItemBase) => item.artifactType === 'RoleAssignment';
  return [
    ...plan.relink.filter(isRoleEdge).map((item): RoleEdgeSettlement => ({
      action: 'repoint',
      edgeId: item.id,
      archivedEntityId: item.archivedEntityId,
      survivorId: item.canonicalResearchEntityId,
    })),
    ...plan.mergeAndArchive.filter(isRoleEdge).map((item): RoleEdgeSettlement => ({
      action: 'archive-redundant',
      edgeId: item.duplicateId,
      archivedEntityId: item.archivedEntityId,
      survivorId: item.canonicalResearchEntityId,
      survivorEdgeId: item.canonicalId,
    })),
    ...plan.archiveWithoutCanonical.filter(isRoleEdge).map((item): RoleEdgeSettlement => ({
      action: 'end',
      edgeId: item.id,
      archivedEntityId: item.archivedEntityId,
    })),
  ];
}

export function accessSignalSettlementsFromRepairPlan(
  plan: ArchivedEntityArtifactRepairPlan,
): AccessSignalSettlement[] {
  const isSignal = (item: PlanItemBase) => item.artifactType === 'AccessSignal';
  return [
    ...plan.relink.filter(isSignal).map((item): AccessSignalSettlement => ({
      action: 'relink',
      signalId: item.id,
      archivedEntityId: item.archivedEntityId,
      survivorId: item.canonicalResearchEntityId,
    })),
    ...plan.mergeAndArchive.filter(isSignal).map((item): AccessSignalSettlement => ({
      action: 'merge-and-archive',
      signalId: item.duplicateId,
      archivedEntityId: item.archivedEntityId,
      survivorId: item.canonicalResearchEntityId,
      survivorSignalId: item.canonicalId,
    })),
    ...plan.archiveWithoutCanonical.filter(isSignal).map((item): AccessSignalSettlement => ({
      action: 'archive',
      signalId: item.id,
      archivedEntityId: item.archivedEntityId,
    })),
  ];
}

export function summarizeArchivedEntityArtifactRepairPlanByClass(
  plan: ArchivedEntityArtifactRepairPlan,
): Partial<Record<ArchivedEntityRepairClass, ArchivedEntityRepairClassSummary>> {
  const summaries: Partial<Record<ArchivedEntityRepairClass, ArchivedEntityRepairClassSummary>> =
    {};
  const entitiesByClass = new Map<ArchivedEntityRepairClass, Set<string>>();
  const record = (
    item: PlanItemBase,
    action: 'relink' | 'mergeAndArchive' | 'archiveWithoutCanonical' | 'detachDisputed' | 'skipped',
  ) => {
    const summary = (summaries[item.repairClass] ||= {
      relink: 0,
      mergeAndArchive: 0,
      archiveWithoutCanonical: 0,
      detachDisputed: 0,
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
  plan.detachDisputed.forEach((item) => record(item, 'detachDisputed'));
  plan.skipped.forEach((item) => record(item, 'skipped'));
  return summaries;
}

export function archivedEntityArtifactPlanWriteCount(
  plan: ArchivedEntityArtifactRepairPlan,
): number {
  return (
    plan.relink.length +
    plan.mergeAndArchive.length +
    plan.archiveWithoutCanonical.length +
    plan.detachDisputed.length
  );
}
