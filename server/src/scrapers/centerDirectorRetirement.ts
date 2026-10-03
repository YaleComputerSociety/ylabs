import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { syncResearchEntitiesWithOutcome } from '../services/researchEntityIndexSyncOutcome';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  absentReadRunIds,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  CENTER_ROSTER_MIN_ABSENT_READS,
  type CenterRosterHealthSnapshot,
} from './centerRosterRetirement';
import {
  CENTER_DIRECTOR_LLM_SOURCE_NAME,
  directorNamedBySnapshot,
  sameNamedDirector,
  type NamedCenterDirector,
} from './sources/centerDirectorLLMExtractor';

export interface CenterDirectorRead {
  scrapeRunId: string;
  observedAt: Date;
  director: NamedCenterDirector;
}

export interface CenterDirectorGovernedEdge {
  edgeId: string;
  director: NamedCenterDirector;
  observedAt: Date | null;
}

export interface CenterDirectorRetirementPlan {
  retiredEdgeIds: string[];
  edgesAwaitingSecondRead: number;
  unjudgedEdges: number;
}

function latestTwoReadsAgree(
  reads: readonly CenterDirectorRead[],
  absentRunIds: readonly string[],
): boolean {
  const absentRuns = new Set(absentRunIds);
  const [latest, previous] = reads
    .filter((read) => absentRuns.has(read.scrapeRunId))
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())
    .filter(
      (read, index, sorted) =>
        sorted.findIndex((other) => other.scrapeRunId === read.scrapeRunId) === index,
    );
  return Boolean(latest && previous && sameNamedDirector(latest.director, previous.director));
}

/**
 * Ends this lane's lead edge once the two latest admitted reads after it was last observed
 * agree on a different director. A read that named nobody is not admitted, so an unreadable
 * leadership page never ends an edge.
 */
export function planCenterDirectorRetirement(input: {
  reads: readonly CenterDirectorRead[];
  edges: readonly CenterDirectorGovernedEdge[];
}): CenterDirectorRetirementPlan {
  const plan: CenterDirectorRetirementPlan = {
    retiredEdgeIds: [],
    edgesAwaitingSecondRead: 0,
    unjudgedEdges: 0,
  };
  for (const edge of input.edges) {
    if (!edge.observedAt || !edge.director.name) {
      plan.unjudgedEdges += 1;
      continue;
    }
    const absent = absentReadRunIds({ observedAt: edge.observedAt }, input.reads, (read) =>
      sameNamedDirector(read.director, edge.director),
    );
    if (
      absent.length >= CENTER_ROSTER_MIN_ABSENT_READS &&
      latestTwoReadsAgree(input.reads, absent)
    ) {
      plan.retiredEdgeIds.push(edge.edgeId);
    } else if (absent.length > 0) plan.edgesAwaitingSecondRead += 1;
  }
  return plan;
}

async function loadCenterDirectorReads(centerEntityKey: string): Promise<CenterDirectorRead[]> {
  const rows = (await Observation.find({
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: CENTER_DIRECTOR_LLM_SOURCE_NAME,
    entityKey: centerEntityKey,
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('value scrapeRunId observedAt')
    .lean()) as Array<{ value?: unknown; scrapeRunId?: unknown; observedAt?: unknown }>;
  const reads: CenterDirectorRead[] = [];
  for (const row of rows) {
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    const director = directorNamedBySnapshot((row.value ?? {}) as CenterRosterHealthSnapshot);
    if (!scrapeRunId || !(row.observedAt instanceof Date) || !director) continue;
    reads.push({ scrapeRunId, observedAt: row.observedAt, director });
  }
  return reads;
}

async function loadGovernedDirectorEdges(
  centerEntityId: mongoose.Types.ObjectId,
): Promise<CenterDirectorGovernedEdge[]> {
  const edges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': centerEntityId,
    'rosterProvenance.sourceName': CENTER_DIRECTOR_LLM_SOURCE_NAME,
    role: { $in: LEAD_ROLE_CANONICAL_VALUES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('_id personId role rosterProvenance')
    .lean()) as any[];
  const displayNames = new Map(
    (
      (await Researcher.find({ _id: { $in: edges.map((edge) => edge.personId) } })
        .select('displayName')
        .lean()) as any[]
    ).map((researcher) => [String(researcher._id), String(researcher.displayName || '').trim()]),
  );
  return edges.map((edge) => ({
    edgeId: serializedDocumentId(edge._id) || '',
    director: {
      name: displayNames.get(String(edge.personId)) || '',
      role: edge.role === 'CO_DIRECTOR' ? 'co-director' : 'director',
    },
    observedAt:
      edge.rosterProvenance?.observedAt instanceof Date ? edge.rosterProvenance.observedAt : null,
  }));
}

export interface CenterDirectorRetirementResult {
  dryRun: boolean;
  centersRead: number;
  retiredEdges: number;
  edgesAwaitingSecondRead: number;
  unjudgedEdges: number;
  indexSyncFailures: number;
}

/**
 * Runs after the run's entities are projected, so an edge a confirmed change just attached
 * is already current and only the director the reads no longer name is ended.
 */
export async function reconcileCenterDirectorRetirementsFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<CenterDirectorRetirementResult | null> {
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId)) return null;
  const centerKeys = (await Observation.distinct('entityKey', {
    scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: CENTER_DIRECTOR_LLM_SOURCE_NAME,
  })) as string[];
  if (centerKeys.length === 0) return null;
  const result: CenterDirectorRetirementResult = {
    dryRun: options.dryRun === true,
    centersRead: centerKeys.length,
    retiredEdges: 0,
    edgesAwaitingSecondRead: 0,
    unjudgedEdges: 0,
    indexSyncFailures: 0,
  };
  for (const centerKey of centerKeys) {
    const center = (await ResearchEntity.findOne({ slug: centerKey, archived: { $ne: true } })
      .select('_id')
      .lean()) as { _id?: mongoose.Types.ObjectId } | null;
    if (!center?._id) continue;
    const plan = planCenterDirectorRetirement({
      reads: await loadCenterDirectorReads(centerKey),
      edges: await loadGovernedDirectorEdges(center._id),
    });
    result.retiredEdges += plan.retiredEdgeIds.length;
    result.edgesAwaitingSecondRead += plan.edgesAwaitingSecondRead;
    result.unjudgedEdges += plan.unjudgedEdges;
    if (result.dryRun || plan.retiredEdgeIds.length === 0) continue;
    await RoleAssignment.updateMany(
      {
        _id: { $in: plan.retiredEdgeIds.map((id) => new mongoose.Types.ObjectId(id)) },
        'rosterProvenance.sourceName': CENTER_DIRECTOR_LLM_SOURCE_NAME,
        state: { $ne: 'HISTORICAL' },
      },
      { $set: { state: 'HISTORICAL', endedAt: new Date() } },
    );
    await applyStudentVisibilityGatePlans(
      await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [String(center._id)],
      }),
    );
    const refreshed = await ResearchEntity.findOne({
      _id: center._id,
      archived: { $ne: true },
    }).lean();
    const indexSync = await syncResearchEntitiesWithOutcome(refreshed ? [refreshed] : []);
    result.indexSyncFailures += indexSync.indexSyncFailures;
  }
  return result;
}
