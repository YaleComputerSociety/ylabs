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
  retireObservationRows,
  type CenterRosterHealthSnapshot,
} from './centerRosterRetirement';
import {
  CENTER_DIRECTOR_SOURCE_NAME,
  codeLaneDirectorReadFromSnapshot,
  type CenterDirectorReadSnapshot,
  type CodeLaneDirectorRead,
} from './centerDirectorReadSnapshot';
import { observedPersonNameAgreesWith } from './utils/personNameAgreement';
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
  sourceName: string = CENTER_DIRECTOR_LLM_SOURCE_NAME,
): Promise<CenterDirectorGovernedEdge[]> {
  const edges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': centerEntityId,
    'rosterProvenance.sourceName': sourceName,
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

export const CENTER_DIRECTOR_RETIREMENT_REASON =
  'center director retirement: two code-lane reads no longer state this director (#5296)';
export const CENTER_DIRECTOR_HAND_OFF_REASON =
  'center director hand-off: the code lane read does not support this center-director-llm director (#5296)';

export interface CodeLaneDirectorRetirementPlan {
  retiredEdgeIds: string[];
  edgesAwaitingSecondRead: number;
  handedOffLlmEdgeIds: string[];
  supportedLlmEdges: number;
  llmEdgesAwaitingRead: number;
  unjudgedEdges: number;
}

const statesDirector = (read: CodeLaneDirectorRead, director: NamedCenterDirector): boolean =>
  read.stated.some((person) => sameNamedDirector(person, director));

/**
 * The code lane governs its own lead edges and hands off the ones `center-director-llm`
 * wrote (#5296).
 *
 * Its own edge ends once two admitted reads in distinct runs after it was last observed no
 * longer state that person as a director at any rank, the centres absence rule.
 *
 * An LLM-written edge is judged by the latest admitted code-lane read after it was last
 * observed, because the LLM lane no longer runs and a deterministic re-read of an unchanged
 * page adds nothing: it ends when that read settled on a different director, or settled on
 * nobody and does not state this person at all. An edge the page still states is kept.
 */
export function planCodeLaneDirectorRetirement(input: {
  reads: readonly CodeLaneDirectorRead[];
  ownEdges: readonly CenterDirectorGovernedEdge[];
  llmEdges: readonly CenterDirectorGovernedEdge[];
}): CodeLaneDirectorRetirementPlan {
  const plan: CodeLaneDirectorRetirementPlan = {
    retiredEdgeIds: [],
    edgesAwaitingSecondRead: 0,
    handedOffLlmEdgeIds: [],
    supportedLlmEdges: 0,
    llmEdgesAwaitingRead: 0,
    unjudgedEdges: 0,
  };
  for (const edge of input.ownEdges) {
    if (!edge.observedAt || !edge.director.name) {
      plan.unjudgedEdges += 1;
      continue;
    }
    const absent = absentReadRunIds({ observedAt: edge.observedAt }, input.reads, (read) =>
      statesDirector(read, edge.director),
    );
    if (absent.length >= CENTER_ROSTER_MIN_ABSENT_READS) plan.retiredEdgeIds.push(edge.edgeId);
    else if (absent.length > 0) plan.edgesAwaitingSecondRead += 1;
  }
  for (const edge of input.llmEdges) {
    if (!edge.director.name) {
      plan.unjudgedEdges += 1;
      continue;
    }
    const since = edge.observedAt?.getTime() ?? 0;
    const [latest] = input.reads
      .filter((read) => read.observedAt.getTime() > since)
      .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());
    if (!latest) {
      plan.llmEdgesAwaitingRead += 1;
      continue;
    }
    const supported = latest.settled
      ? sameNamedDirector(latest.settled, edge.director)
      : statesDirector(latest, edge.director);
    if (supported) plan.supportedLlmEdges += 1;
    else plan.handedOffLlmEdgeIds.push(edge.edgeId);
  }
  return plan;
}

async function loadCodeLaneDirectorReads(centerEntityKey: string): Promise<CodeLaneDirectorRead[]> {
  const rows = (await Observation.find({
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: CENTER_DIRECTOR_SOURCE_NAME,
    entityKey: centerEntityKey,
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('value scrapeRunId observedAt')
    .lean()) as Array<{ value?: unknown; scrapeRunId?: unknown; observedAt?: unknown }>;
  const reads: CodeLaneDirectorRead[] = [];
  for (const row of rows) {
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!scrapeRunId || !(row.observedAt instanceof Date)) continue;
    const read = codeLaneDirectorReadFromSnapshot(
      (row.value ?? {}) as CenterDirectorReadSnapshot,
      scrapeRunId,
      row.observedAt,
    );
    if (read) reads.push(read);
  }
  return reads;
}

const DIRECTOR_OBSERVATION_FIELDS = [
  'inferredDirectorName',
  'inferredDirectorUserName',
  'inferredDirectorRole',
  'inferredDirectorTitle',
  'inferredDirectorProfileUrl',
];

/**
 * An ended edge's own observations are retired with it, because they are latest-wins and
 * a lane that stops naming the person never supersedes them, so the next materialization
 * of the center would otherwise write the edge again.
 */
async function directorObservationIdsNaming(
  centerEntityKey: string,
  sourceName: string,
  directors: readonly NamedCenterDirector[],
): Promise<string[]> {
  if (directors.length === 0) return [];
  const rows = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: centerEntityKey,
    sourceName,
    field: { $in: DIRECTOR_OBSERVATION_FIELDS },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id field value')
    .lean()) as Array<{ _id: unknown; field?: string; value?: unknown }>;
  const named = rows.find((row) => row.field === 'inferredDirectorName');
  const name = typeof named?.value === 'string' ? named.value : '';
  if (!name || !directors.some((director) => observedPersonNameAgreesWith(director.name, name))) {
    return [];
  }
  return rows.map((row) => serializedDocumentId(row._id) || '').filter(Boolean);
}

async function endDirectorEdges(edgeIds: readonly string[], sourceName: string): Promise<void> {
  if (edgeIds.length === 0) return;
  await RoleAssignment.updateMany(
    {
      _id: { $in: edgeIds.map((id) => new mongoose.Types.ObjectId(id)) },
      'rosterProvenance.sourceName': sourceName,
      state: { $ne: 'HISTORICAL' },
    },
    { $set: { state: 'HISTORICAL', endedAt: new Date() } },
  );
}

async function regateAndResync(centerId: mongoose.Types.ObjectId): Promise<number> {
  await applyStudentVisibilityGatePlans(
    await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: [String(centerId)],
    }),
  );
  const refreshed = await ResearchEntity.findOne({ _id: centerId, archived: { $ne: true } }).lean();
  const indexSync = await syncResearchEntitiesWithOutcome(refreshed ? [refreshed] : []);
  return indexSync.indexSyncFailures;
}

export interface CodeLaneDirectorRetirementResult {
  dryRun: boolean;
  centersRead: number;
  retiredEdges: number;
  edgesAwaitingSecondRead: number;
  handedOffLlmEdges: number;
  supportedLlmEdges: number;
  llmEdgesAwaitingRead: number;
  retiredObservations: number;
  unjudgedEdges: number;
  indexSyncFailures: number;
}

export async function reconcileCodeLaneDirectorRetirementsFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<CodeLaneDirectorRetirementResult | null> {
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId)) return null;
  const centerKeys = (await Observation.distinct('entityKey', {
    scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: CENTER_DIRECTOR_SOURCE_NAME,
  })) as string[];
  if (centerKeys.length === 0) return null;
  const result: CodeLaneDirectorRetirementResult = {
    dryRun: options.dryRun === true,
    centersRead: centerKeys.length,
    retiredEdges: 0,
    edgesAwaitingSecondRead: 0,
    handedOffLlmEdges: 0,
    supportedLlmEdges: 0,
    llmEdgesAwaitingRead: 0,
    retiredObservations: 0,
    unjudgedEdges: 0,
    indexSyncFailures: 0,
  };
  for (const centerKey of centerKeys) {
    const center = (await ResearchEntity.findOne({ slug: centerKey, archived: { $ne: true } })
      .select('_id')
      .lean()) as { _id?: mongoose.Types.ObjectId } | null;
    if (!center?._id) continue;
    const ownEdges = await loadGovernedDirectorEdges(center._id, CENTER_DIRECTOR_SOURCE_NAME);
    const llmEdges = await loadGovernedDirectorEdges(center._id, CENTER_DIRECTOR_LLM_SOURCE_NAME);
    const plan = planCodeLaneDirectorRetirement({
      reads: await loadCodeLaneDirectorReads(centerKey),
      ownEdges,
      llmEdges,
    });
    result.retiredEdges += plan.retiredEdgeIds.length;
    result.edgesAwaitingSecondRead += plan.edgesAwaitingSecondRead;
    result.handedOffLlmEdges += plan.handedOffLlmEdgeIds.length;
    result.supportedLlmEdges += plan.supportedLlmEdges;
    result.llmEdgesAwaitingRead += plan.llmEdgesAwaitingRead;
    result.unjudgedEdges += plan.unjudgedEdges;
    const endedDirectors = (edges: readonly CenterDirectorGovernedEdge[], ids: string[]) =>
      edges.filter((edge) => ids.includes(edge.edgeId)).map((edge) => edge.director);
    const ownObservationIds = await directorObservationIdsNaming(
      centerKey,
      CENTER_DIRECTOR_SOURCE_NAME,
      endedDirectors(ownEdges, plan.retiredEdgeIds),
    );
    const llmObservationIds =
      plan.supportedLlmEdges === 0
        ? await directorObservationIdsNaming(
            centerKey,
            CENTER_DIRECTOR_LLM_SOURCE_NAME,
            endedDirectors(llmEdges, plan.handedOffLlmEdgeIds),
          )
        : [];
    result.retiredObservations += ownObservationIds.length + llmObservationIds.length;
    if (result.dryRun) continue;
    if (plan.retiredEdgeIds.length === 0 && plan.handedOffLlmEdgeIds.length === 0) continue;
    await endDirectorEdges(plan.retiredEdgeIds, CENTER_DIRECTOR_SOURCE_NAME);
    await endDirectorEdges(plan.handedOffLlmEdgeIds, CENTER_DIRECTOR_LLM_SOURCE_NAME);
    await retireObservationRows(ownObservationIds, CENTER_DIRECTOR_RETIREMENT_REASON);
    await retireObservationRows(llmObservationIds, CENTER_DIRECTOR_HAND_OFF_REASON);
    result.indexSyncFailures += await regateAndResync(center._id);
  }
  return result;
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
