import mongoose from 'mongoose';
import { archivedEntityUpdate } from '../models/entityArchival';
import { ResearchEntity } from '../models/researchEntity';
import { DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS, RoleAssignment } from '../models/roleAssignment';
import { serializedDocumentId } from '../utils/idSerialization';

// Changing this also requires updating `currentMembersOnArchivedEntitiesPipeline`, which
// counts exactly the edges this predicate selects (#4752).
export const LIVE_ROLE_EDGE_FILTER = {
  archived: { $ne: true },
  state: { $ne: 'HISTORICAL' },
} as const;

// A disputed survivor edge holds its person and role too: moving a live edge beside it
// would re-attach a claim an operator detached on the survivor.
export const SURVIVOR_HOLDING_ROLE_EDGE_FILTER = {
  $or: [{ ...LIVE_ROLE_EDGE_FILTER }, { reviewStatus: DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS }],
};

export interface RoleEdgeOnArchivedEntity {
  id: string;
  archivedEntityId: string;
  personId: string;
  role: string;
}

export interface SurvivorHoldingRoleEdge {
  id: string;
  survivorId: string;
  personId: string;
  role: string;
}

export type RoleEdgeSettlement =
  | { action: 'repoint'; edgeId: string; archivedEntityId: string; survivorId: string }
  | {
      action: 'archive-redundant';
      edgeId: string;
      archivedEntityId: string;
      survivorId: string;
      survivorEdgeId: string;
    }
  | { action: 'end'; edgeId: string; archivedEntityId: string };

export interface RoleEdgeSettlementCounts {
  repointed: number;
  archivedRedundant: number;
  ended: number;
}

export interface RoleEdgeSettlementOutcome extends RoleEdgeSettlementCounts {
  refusedSurvivorNotLive: number;
}

export const emptyRoleEdgeSettlementOutcome = (): RoleEdgeSettlementOutcome => ({
  repointed: 0,
  archivedRedundant: 0,
  ended: 0,
  refusedSurvivorNotLive: 0,
});

const holdingKey = (survivorId: string, personId: string, role: string): string => {
  const person = personId.trim();
  const roleName = role.trim();
  return person && roleName ? `${survivorId}:${person}:${roleName}` : '';
};

// Mirrors `applyResearchEntityDedupeMergeGroup`, except that a disputed survivor edge also
// holds. An edge moved here counts as held, so two archived rows never hand the survivor
// the same person and role twice.
export function planRoleEdgeSettlements({
  edges,
  survivorIdFor,
  survivorHoldingEdges,
}: {
  edges: readonly RoleEdgeOnArchivedEntity[];
  survivorIdFor: (archivedEntityId: string) => string | undefined;
  survivorHoldingEdges: readonly SurvivorHoldingRoleEdge[];
}): RoleEdgeSettlement[] {
  const heldEdgeIdByKey = new Map<string, string>();
  for (const edge of survivorHoldingEdges) {
    const key = holdingKey(edge.survivorId, edge.personId, edge.role);
    if (key && !heldEdgeIdByKey.has(key)) heldEdgeIdByKey.set(key, edge.id);
  }

  return edges.map((edge): RoleEdgeSettlement => {
    const survivorId = survivorIdFor(edge.archivedEntityId);
    if (!survivorId) {
      return { action: 'end', edgeId: edge.id, archivedEntityId: edge.archivedEntityId };
    }
    const key = holdingKey(survivorId, edge.personId, edge.role);
    const survivorEdgeId = key ? heldEdgeIdByKey.get(key) : undefined;
    if (survivorEdgeId) {
      return {
        action: 'archive-redundant',
        edgeId: edge.id,
        archivedEntityId: edge.archivedEntityId,
        survivorId,
        survivorEdgeId,
      };
    }
    if (key) heldEdgeIdByKey.set(key, edge.id);
    return {
      action: 'repoint',
      edgeId: edge.id,
      archivedEntityId: edge.archivedEntityId,
      survivorId,
    };
  });
}

const objectIdOf = (value: unknown): mongoose.Types.ObjectId | undefined => {
  const id = serializedDocumentId(value);
  return id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : undefined;
};

const objectIdsOf = (values: readonly unknown[]): mongoose.Types.ObjectId[] =>
  values.map(objectIdOf).filter((id): id is mongoose.Types.ObjectId => Boolean(id));

export async function applyRoleEdgeSettlements(
  settlements: readonly RoleEdgeSettlement[],
  endedAt: Date,
): Promise<RoleEdgeSettlementCounts> {
  const counts: RoleEdgeSettlementCounts = { repointed: 0, archivedRedundant: 0, ended: 0 };
  for (const settlement of settlements) {
    const edgeId = objectIdOf(settlement.edgeId);
    const archivedEntityId = objectIdOf(settlement.archivedEntityId);
    if (!edgeId || !archivedEntityId) continue;
    const filter = {
      _id: edgeId,
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': archivedEntityId,
      ...LIVE_ROLE_EDGE_FILTER,
    };
    if (settlement.action === 'repoint') {
      const survivorId = objectIdOf(settlement.survivorId);
      if (!survivorId) continue;
      const result = await RoleAssignment.updateOne(filter, { $set: { 'target.id': survivorId } });
      counts.repointed += result.modifiedCount ?? 0;
      continue;
    }
    if (settlement.action === 'archive-redundant') {
      const result = await RoleAssignment.updateOne(filter, {
        $set: { state: 'HISTORICAL', endedAt, archived: true },
      });
      counts.archivedRedundant += result.modifiedCount ?? 0;
      continue;
    }
    const result = await RoleAssignment.updateOne(filter, {
      $set: { state: 'HISTORICAL', endedAt },
    });
    counts.ended += result.modifiedCount ?? 0;
  }
  return counts;
}

// Only rows that are archived, so an archive write that matched nothing cannot end the
// edges of a row that is still live.
export async function loadLiveRoleEdgesOnArchivedEntities(
  archivedEntityIds: readonly unknown[],
): Promise<RoleEdgeOnArchivedEntity[]> {
  const ids = objectIdsOf(archivedEntityIds);
  if (ids.length === 0) return [];
  const archived = await ResearchEntity.find({ _id: { $in: ids }, archived: true })
    .select('_id')
    .lean();
  const archivedIds = objectIdsOf(archived.map((row) => (row as { _id?: unknown })._id));
  if (archivedIds.length === 0) return [];
  const rows = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: archivedIds },
    ...LIVE_ROLE_EDGE_FILTER,
  })
    .sort({ _id: 1 })
    .select('_id target personId role')
    .lean()) as Array<{
    _id: unknown;
    target?: { id?: unknown };
    personId?: unknown;
    role?: unknown;
  }>;
  return rows.map((row) => ({
    id: serializedDocumentId(row._id) || '',
    archivedEntityId: serializedDocumentId(row.target?.id) || '',
    personId: serializedDocumentId(row.personId) || '',
    role: typeof row.role === 'string' ? row.role : '',
  }));
}

export async function loadSurvivorHoldingRoleEdges(
  survivorIds: readonly unknown[],
  personIds: readonly unknown[],
): Promise<SurvivorHoldingRoleEdge[]> {
  const survivors = objectIdsOf(survivorIds);
  const people = objectIdsOf(personIds);
  if (survivors.length === 0 || people.length === 0) return [];
  const rows = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: survivors },
    personId: { $in: people },
    ...SURVIVOR_HOLDING_ROLE_EDGE_FILTER,
  })
    .sort({ _id: 1 })
    .select('_id target personId role')
    .lean()) as Array<{
    _id: unknown;
    target?: { id?: unknown };
    personId?: unknown;
    role?: unknown;
  }>;
  return rows.map((row) => ({
    id: serializedDocumentId(row._id) || '',
    survivorId: serializedDocumentId(row.target?.id) || '',
    personId: serializedDocumentId(row.personId) || '',
    role: typeof row.role === 'string' ? row.role : '',
  }));
}

// A survivor that is not live is refused: moving a lead onto another archived row strands
// it again, and ending it would discard the merge's answer.
export async function settleRoleEdgesOfArchivedResearchEntities({
  archivedEntityIds,
  survivorId,
  endedAt = new Date(),
}: {
  archivedEntityIds: readonly unknown[];
  survivorId?: unknown;
  endedAt?: Date;
}): Promise<RoleEdgeSettlementOutcome> {
  const outcome = emptyRoleEdgeSettlementOutcome();
  const edges = await loadLiveRoleEdgesOnArchivedEntities(archivedEntityIds);
  if (edges.length === 0) return outcome;

  const survivor =
    survivorId === undefined || survivorId === null ? undefined : objectIdOf(survivorId);
  if (survivorId !== undefined && survivorId !== null) {
    const survivorIsLive =
      survivor !== undefined &&
      (await ResearchEntity.exists({ _id: survivor, archived: { $ne: true } })) !== null;
    if (!survivorIsLive) {
      outcome.refusedSurvivorNotLive = edges.length;
      return outcome;
    }
  }

  const survivorKey = survivor ? String(survivor) : undefined;
  const settlements = planRoleEdgeSettlements({
    edges,
    survivorIdFor: () => survivorKey,
    survivorHoldingEdges: survivor
      ? await loadSurvivorHoldingRoleEdges(
          [survivor],
          edges.map((edge) => edge.personId),
        )
      : [],
  });
  return { ...outcome, ...(await applyRoleEdgeSettlements(settlements, endedAt)) };
}

// `archiveCallSitesSettleRoleEdges.test.ts` fails on a new `archivedEntityUpdate` caller
// that bypasses this (#4752). `endedAt` equals `archivedAt`, which ties an ended edge to
// the archive that ended it.
export async function archiveResearchEntities({
  ids,
  archivedReason,
  set = {},
  survivorId,
  now = new Date(),
}: {
  ids: readonly unknown[];
  archivedReason: string;
  set?: Record<string, unknown>;
  survivorId?: unknown;
  now?: Date;
}): Promise<{ archived: number; roleEdges: RoleEdgeSettlementOutcome }> {
  const objectIds = objectIdsOf(ids);
  if (objectIds.length === 0) {
    return { archived: 0, roleEdges: emptyRoleEdgeSettlementOutcome() };
  }
  const result = await ResearchEntity.updateMany(
    { _id: { $in: objectIds }, archived: { $ne: true } },
    archivedEntityUpdate(archivedReason, { archivedAt: now, ...set }),
  );
  const roleEdges = await settleRoleEdgesOfArchivedResearchEntities({
    archivedEntityIds: objectIds,
    survivorId,
    endedAt: now,
  });
  return { archived: result.modifiedCount ?? 0, roleEdges };
}
