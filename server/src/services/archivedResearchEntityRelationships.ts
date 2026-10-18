import mongoose from 'mongoose';
import { attributedArchiveSet } from '../models/entityArchival';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  resolveResearchEntityCanonicalByTombstone,
  type ResearchEntityTombstoneNode,
} from './researchEntityCanonicalTombstone';

export const LIVE_RELATIONSHIP_EDGE_FILTER = { archived: { $ne: true } } as const;

export interface RelationshipEndpoints {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  liveSourceId?: string;
  liveTargetId?: string;
}

export interface RelationshipEdgeOnArchivedEntity extends RelationshipEndpoints {
  id: string;
}

export interface HeldRelationshipEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
}

interface SettlementBase {
  edgeId: string;
  sourceId: string;
  targetId: string;
}

export type RelationshipEdgeSettlement =
  | (SettlementBase & { action: 'repoint'; liveSourceId: string; liveTargetId: string })
  | (SettlementBase & { action: 'archive-redundant'; survivorEdgeId: string })
  | (SettlementBase & { action: 'archive-self-loop' })
  | (SettlementBase & { action: 'leave' });

export interface RelationshipEdgeSettlementCounts {
  repointed: number;
  archivedRedundant: number;
  archivedSelfLoop: number;
  leftWithoutLiveEndpoint: number;
}

export interface RelationshipEdgeSettlementOutcome extends RelationshipEdgeSettlementCounts {
  refusedSurvivorNotLive: number;
}

export const emptyRelationshipEdgeSettlementCounts = (): RelationshipEdgeSettlementCounts => ({
  repointed: 0,
  archivedRedundant: 0,
  archivedSelfLoop: 0,
  leftWithoutLiveEndpoint: 0,
});

export const emptyRelationshipEdgeSettlementOutcome = (): RelationshipEdgeSettlementOutcome => ({
  ...emptyRelationshipEdgeSettlementCounts(),
  refusedSurvivorNotLive: 0,
});

const edgeKey = (sourceId: string, targetId: string): string =>
  sourceId && targetId ? `${sourceId}:${targetId}` : '';

// An edge with an endpoint that has no live home is left alone: the detail page already
// hides it, and nothing names where it should point. A survivor edge holds its (source,
// target) pair whatever its type, because the materializer keeps one edge per pair and the
// detail page would otherwise serve two links between the same rows. The survivor's edges
// count whether archived or not, because an archived survivor edge is a retraction to respect.
// An edge moved here counts as held, so two archived rows never hand the survivor the
// same link twice.
export function planRelationshipEdgeSettlements({
  edges,
  heldEdges,
}: {
  edges: readonly RelationshipEdgeOnArchivedEntity[];
  heldEdges: readonly HeldRelationshipEdge[];
}): RelationshipEdgeSettlement[] {
  const heldEdgeIdByKey = new Map<string, string>();
  for (const edge of heldEdges) {
    const key = edgeKey(edge.sourceId, edge.targetId);
    if (key && !heldEdgeIdByKey.has(key)) heldEdgeIdByKey.set(key, edge.id);
  }

  return edges.map((edge): RelationshipEdgeSettlement => {
    const base = { edgeId: edge.id, sourceId: edge.sourceId, targetId: edge.targetId };
    const { liveSourceId, liveTargetId } = edge;
    if (!liveSourceId || !liveTargetId) return { ...base, action: 'leave' };
    if (liveSourceId === liveTargetId) return { ...base, action: 'archive-self-loop' };
    const key = edgeKey(liveSourceId, liveTargetId);
    const survivorEdgeId = key ? heldEdgeIdByKey.get(key) : undefined;
    if (survivorEdgeId && survivorEdgeId !== edge.id) {
      return { ...base, action: 'archive-redundant', survivorEdgeId };
    }
    if (!key) return { ...base, action: 'leave' };
    heldEdgeIdByKey.set(key, edge.id);
    return { ...base, action: 'repoint', liveSourceId, liveTargetId };
  });
}

const objectIdOf = (value: unknown): mongoose.Types.ObjectId | undefined => {
  const id = serializedDocumentId(value);
  return id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : undefined;
};

const objectIdsOf = (values: readonly unknown[]): mongoose.Types.ObjectId[] =>
  values.map(objectIdOf).filter((id): id is mongoose.Types.ObjectId => Boolean(id));

const textOf = (value: unknown): string => serializedDocumentId(value) || '';

const isDuplicateKeyError = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 11000;

async function archiveEdge(
  edgeFilter: Record<string, unknown>,
  archivedReason: string,
  now: Date,
): Promise<number> {
  const result = await ResearchEntityRelationship.updateOne(edgeFilter, {
    $set: attributedArchiveSet(archivedReason, { archivedAt: now }),
  });
  return result.modifiedCount ?? 0;
}

export async function applyRelationshipEdgeSettlements(
  settlements: readonly RelationshipEdgeSettlement[],
  { archivedReason, now }: { archivedReason: string; now: Date },
): Promise<RelationshipEdgeSettlementCounts> {
  const counts = emptyRelationshipEdgeSettlementCounts();
  for (const settlement of settlements) {
    if (settlement.action === 'leave') {
      counts.leftWithoutLiveEndpoint += 1;
      continue;
    }
    const edgeId = objectIdOf(settlement.edgeId);
    const sourceId = objectIdOf(settlement.sourceId);
    const targetId = objectIdOf(settlement.targetId);
    if (!edgeId || !sourceId || !targetId) continue;
    const edgeFilter = {
      _id: edgeId,
      sourceResearchEntityId: sourceId,
      targetResearchEntityId: targetId,
      ...LIVE_RELATIONSHIP_EDGE_FILTER,
    };
    if (settlement.action === 'archive-self-loop') {
      counts.archivedSelfLoop += await archiveEdge(edgeFilter, archivedReason, now);
      continue;
    }
    if (settlement.action === 'archive-redundant') {
      counts.archivedRedundant += await archiveEdge(edgeFilter, archivedReason, now);
      continue;
    }
    const liveSourceId = objectIdOf(settlement.liveSourceId);
    const liveTargetId = objectIdOf(settlement.liveTargetId);
    if (!liveSourceId || !liveTargetId) continue;
    try {
      const result = await ResearchEntityRelationship.updateOne(edgeFilter, {
        $set: { sourceResearchEntityId: liveSourceId, targetResearchEntityId: liveTargetId },
      });
      counts.repointed += result.modifiedCount ?? 0;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      counts.archivedRedundant += await archiveEdge(edgeFilter, archivedReason, now);
    }
  }
  return counts;
}

type RelationshipRow = {
  _id: unknown;
  sourceResearchEntityId?: unknown;
  targetResearchEntityId?: unknown;
  relationshipType?: unknown;
};

const heldEdgeOf = (row: RelationshipRow): HeldRelationshipEdge => ({
  id: textOf(row._id),
  sourceId: textOf(row.sourceResearchEntityId),
  targetId: textOf(row.targetResearchEntityId),
  relationshipType: textOf(row.relationshipType),
});

export async function loadLiveRelationshipEdgesTouching(
  researchEntityIds: readonly unknown[],
  limit?: number,
): Promise<HeldRelationshipEdge[]> {
  const ids = objectIdsOf(researchEntityIds);
  if (ids.length === 0) return [];
  const query = ResearchEntityRelationship.find({
    ...LIVE_RELATIONSHIP_EDGE_FILTER,
    $or: [{ sourceResearchEntityId: { $in: ids } }, { targetResearchEntityId: { $in: ids } }],
  })
    .sort({ _id: 1 })
    .select('_id sourceResearchEntityId targetResearchEntityId relationshipType');
  if (limit !== undefined) query.limit(limit);
  return ((await query.lean()) as RelationshipRow[]).map(heldEdgeOf);
}

export async function loadHeldRelationshipEdges(
  sourceIds: readonly unknown[],
  targetIds: readonly unknown[],
): Promise<HeldRelationshipEdge[]> {
  const sources = objectIdsOf(sourceIds);
  const targets = objectIdsOf(targetIds);
  if (sources.length === 0 || targets.length === 0) return [];
  const rows = (await ResearchEntityRelationship.find({
    sourceResearchEntityId: { $in: sources },
    targetResearchEntityId: { $in: targets },
  })
    .sort({ _id: 1 })
    .select('_id sourceResearchEntityId targetResearchEntityId relationshipType')
    .lean()) as RelationshipRow[];
  return rows.map(heldEdgeOf);
}

export function withLiveEndpoints(
  edges: readonly HeldRelationshipEdge[],
  liveIdFor: (researchEntityId: string) => string | undefined,
): RelationshipEdgeOnArchivedEntity[] {
  return edges.map((edge) => ({
    ...edge,
    liveSourceId: liveIdFor(edge.sourceId),
    liveTargetId: liveIdFor(edge.targetId),
  }));
}

async function liveIdsOfOtherEndpoints(
  endpointIds: readonly string[],
): Promise<Map<string, string | undefined>> {
  const rows = (await ResearchEntity.find({ _id: { $in: objectIdsOf(endpointIds) } })
    .select('_id archived canonicalGroupId')
    .lean()) as ResearchEntityTombstoneNode[];
  const liveIds = new Map<string, string | undefined>();
  for (const row of rows) {
    const id = textOf(row._id);
    if (row.archived !== true) {
      liveIds.set(id, id);
      continue;
    }
    const canonical = await resolveResearchEntityCanonicalByTombstone(row);
    liveIds.set(id, canonical ? textOf(canonical._id) : undefined);
  }
  return liveIds;
}

// Only rows that are archived, so an archive write that matched nothing cannot move the
// links of a row that is still live. A survivor that is not live is refused, matching the
// role-edge and access-signal settlements.
export async function settleRelationshipEdgesOfArchivedResearchEntities({
  archivedEntityIds,
  archivedReason,
  survivorId,
  now = new Date(),
}: {
  archivedEntityIds: readonly unknown[];
  archivedReason: string;
  survivorId?: unknown;
  now?: Date;
}): Promise<RelationshipEdgeSettlementOutcome> {
  const outcome = emptyRelationshipEdgeSettlementOutcome();
  const ids = objectIdsOf(archivedEntityIds);
  if (ids.length === 0) return outcome;
  const archived = await ResearchEntity.find({ _id: { $in: ids }, archived: true })
    .select('_id')
    .lean();
  const archivedIds = new Set(archived.map((row) => textOf((row as { _id?: unknown })._id)));
  if (archivedIds.size === 0) return outcome;
  const edges = await loadLiveRelationshipEdgesTouching([...archivedIds]);
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
  const otherEndpointIds = [
    ...new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId])),
  ].filter((id) => !archivedIds.has(id));
  const otherLiveIds = await liveIdsOfOtherEndpoints(otherEndpointIds);
  const liveIdFor = (id: string) => (archivedIds.has(id) ? survivorKey : otherLiveIds.get(id));
  const edgesWithLiveEndpoints = withLiveEndpoints(edges, liveIdFor);
  const heldEdges = await loadHeldRelationshipEdges(
    edgesWithLiveEndpoints.map((edge) => edge.liveSourceId).filter(Boolean),
    edgesWithLiveEndpoints.map((edge) => edge.liveTargetId).filter(Boolean),
  );
  const settlements = planRelationshipEdgeSettlements({
    edges: edgesWithLiveEndpoints,
    heldEdges,
  });
  return {
    ...outcome,
    ...(await applyRelationshipEdgeSettlements(settlements, { archivedReason, now })),
  };
}
