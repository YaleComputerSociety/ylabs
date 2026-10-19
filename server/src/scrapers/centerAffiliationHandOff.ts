import mongoose from 'mongoose';
import { attributedArchiveSet } from '../models/entityArchival';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { syncResearchEntitiesWithOutcome } from '../services/researchEntityIndexSyncOutcome';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { escapeRegex } from '../utils/regex';
import { FACULTY_RESEARCH_AREA_SLUG_PREFIX } from '../utils/researchEntityShellSlug';
import {
  relationshipTargetIdentities,
  type RelationshipTargetIdentity,
} from './centerRelationshipTarget';
import {
  CENTER_AFFILIATION_CODE_ROSTER_LANE,
  CENTER_AFFILIATION_LLM_SOURCE_NAME,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  loadCenterRosterReads,
  retireObservationRows,
  type CenterRosterRead,
  type CenterRosterRetirementDeps,
} from './centerRosterRetirement';

export const CENTER_AFFILIATION_HAND_OFF_REASON =
  'center affiliation hand-off: the code lane read of this center does not list this center-affiliation-llm affiliation (#5296)';
export const CENTER_AFFILIATION_RE_ATTRIBUTION_REASON =
  'center affiliation hand-off: the code lane read of this center lists this affiliation, which now rests on center-affiliation-roster (#5296)';

const NAME_SUFFIX_TOKENS = new Set([
  'md',
  'phd',
  'mph',
  'msc',
  'ms',
  'mhs',
  'mba',
  'ma',
  'ba',
  'bs',
  'jd',
  'rn',
  'msn',
  'cnm',
  'dvm',
  'drph',
  'psyd',
  'mbbs',
  'llb',
  'lpc',
  'faap',
  'facp',
  'facep',
  'jr',
  'sr',
  'ii',
  'iii',
]);

export interface CenterAffiliationLlmClaim {
  relationshipKey: string;
  targetEntityKey: string;
  targetId: string | null;
  observedAt: Date;
  observationIds: string[];
}

export interface CenterAffiliationCodeRead {
  observedAt: Date;
  relationshipKeys: ReadonlySet<string>;
  targetIds: ReadonlySet<string>;
}

export interface CenterAffiliationHandOffPlan {
  reattributed: CenterAffiliationLlmClaim[];
  handedOff: CenterAffiliationLlmClaim[];
  supportedKept: number;
  awaitingRead: number;
}

function personTokens(targetEntityKey: string): string[] {
  if (!targetEntityKey.startsWith(FACULTY_RESEARCH_AREA_SLUG_PREFIX)) return [];
  return targetEntityKey
    .slice(FACULTY_RESEARCH_AREA_SLUG_PREFIX.length)
    .split('-')
    .filter((token) => token && !NAME_SUFFIX_TOKENS.has(token));
}

function targetEntityKeyOf(relationshipKey: string): string {
  const parts = relationshipKey.split(':');
  return parts.length >= 3 ? parts[parts.length - 2] : '';
}

export function samePersonInEitherOrder(leftKey: string, rightKey: string): boolean {
  const left = personTokens(leftKey);
  const right = personTokens(rightKey);
  if (left.length < 2 || right.length < 2) return false;
  const leftEnds = [left[0], left[left.length - 1]].sort().join('|');
  const rightEnds = [right[0], right[right.length - 1]].sort().join('|');
  return leftEnds === rightEnds;
}

export type CodeReadVerdict = 'same-target' | 'same-person-other-target' | 'not-listed';

export function codeReadVerdict(
  read: CenterAffiliationCodeRead,
  claim: CenterAffiliationLlmClaim,
): CodeReadVerdict {
  if (read.relationshipKeys.has(claim.relationshipKey)) return 'same-target';
  if (claim.targetId && read.targetIds.has(claim.targetId)) return 'same-target';
  const listsPerson = Array.from(read.relationshipKeys).some((key) =>
    samePersonInEitherOrder(targetEntityKeyOf(key), claim.targetEntityKey),
  );
  if (!listsPerson) return 'not-listed';
  return claim.targetId ? 'same-person-other-target' : 'same-target';
}

export function planCenterAffiliationHandOff(input: {
  reads: readonly CenterAffiliationCodeRead[];
  llmClaims: readonly CenterAffiliationLlmClaim[];
}): CenterAffiliationHandOffPlan {
  const plan: CenterAffiliationHandOffPlan = {
    reattributed: [],
    handedOff: [],
    supportedKept: 0,
    awaitingRead: 0,
  };
  for (const claim of input.llmClaims) {
    const [latest] = input.reads
      .filter((read) => read.observedAt.getTime() > claim.observedAt.getTime())
      .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());
    if (!latest) {
      plan.awaitingRead += 1;
      continue;
    }
    const verdict = codeReadVerdict(latest, claim);
    if (verdict === 'same-target') plan.reattributed.push(claim);
    else if (verdict === 'not-listed') plan.handedOff.push(claim);
    else plan.supportedKept += 1;
  }
  return plan;
}

type ResolveTargetId = CenterRosterRetirementDeps['resolveRelationshipTargetId'];

interface LiveRelationshipRow {
  _id: unknown;
  entityKey?: unknown;
  field?: unknown;
  value?: unknown;
  observedAt?: unknown;
}

async function liveRelationshipRows(
  centerEntityKey: string,
  sourceName: string,
): Promise<LiveRelationshipRow[]> {
  return (await Observation.find({
    entityType: 'researchEntityRelationship',
    sourceName,
    entityKey: { $regex: `^${escapeRegex(centerEntityKey)}:` },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id entityKey field value observedAt')
    .lean()) as LiveRelationshipRow[];
}

const rowEntityKey = (row: LiveRelationshipRow): string =>
  typeof row.entityKey === 'string' ? row.entityKey : '';

async function targetIdOf(
  rows: readonly LiveRelationshipRow[],
  resolveTargetId: ResolveTargetId,
): Promise<string | null> {
  const [identity] = relationshipTargetIdentities(
    rows.map((row) => ({
      entityKey: rowEntityKey(row),
      field: typeof row.field === 'string' ? row.field : '',
      value: row.value,
    })),
  );
  return identity ? resolveTargetId(identity as RelationshipTargetIdentity) : null;
}

function groupByRelationshipKey(
  rows: readonly LiveRelationshipRow[],
): Map<string, LiveRelationshipRow[]> {
  const groups = new Map<string, LiveRelationshipRow[]>();
  for (const row of rows) {
    const key = rowEntityKey(row);
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

export async function loadCenterAffiliationLlmClaims(
  centerEntityKey: string,
  resolveTargetId: ResolveTargetId,
): Promise<CenterAffiliationLlmClaim[]> {
  const groups = groupByRelationshipKey(
    await liveRelationshipRows(centerEntityKey, CENTER_AFFILIATION_LLM_SOURCE_NAME),
  );
  const claims: CenterAffiliationLlmClaim[] = [];
  for (const [relationshipKey, rows] of groups) {
    const targetRow = rows.find((row) => row.field === 'targetEntityKey');
    const targetEntityKey = typeof targetRow?.value === 'string' ? targetRow.value : '';
    if (!targetEntityKey) continue;
    const observedAt = new Date(
      Math.max(
        ...rows.map((row) => (row.observedAt instanceof Date ? row.observedAt.getTime() : 0)),
      ),
    );
    claims.push({
      relationshipKey,
      targetEntityKey,
      targetId: await targetIdOf(rows, resolveTargetId),
      observedAt,
      observationIds: rows.map((row) => serializedDocumentId(row._id) || '').filter(Boolean),
    });
  }
  return claims;
}

export async function loadCenterAffiliationCodeReads(
  centerEntityKey: string,
  resolveTargetId: ResolveTargetId,
): Promise<CenterAffiliationCodeRead[]> {
  const rosterReads: CenterRosterRead[] = await loadCenterRosterReads(
    centerEntityKey,
    CENTER_AFFILIATION_CODE_ROSTER_LANE,
  );
  if (rosterReads.length === 0) return [];
  const codeGroups = groupByRelationshipKey(
    await liveRelationshipRows(centerEntityKey, CENTER_AFFILIATION_CODE_ROSTER_LANE.sourceName),
  );
  const targetIdByKey = new Map<string, string>();
  for (const [relationshipKey, rows] of codeGroups) {
    const targetId = await targetIdOf(rows, resolveTargetId);
    if (targetId) targetIdByKey.set(relationshipKey, targetId);
  }
  return rosterReads.map((read) => ({
    observedAt: read.observedAt,
    relationshipKeys: read.relationshipKeys,
    targetIds: new Set(
      Array.from(read.relationshipKeys)
        .map((key) => targetIdByKey.get(key) ?? '')
        .filter(Boolean),
    ),
  }));
}

export interface CenterAffiliationHandOffResult {
  dryRun: boolean;
  centersRead: number;
  reattributedClaims: number;
  handedOffClaims: number;
  supportedClaimsKept: number;
  claimsAwaitingRead: number;
  retiredObservations: number;
  archivedRelationships: number;
  indexSyncFailures: number;
}

async function archiveHandedOffRelationships(
  centerId: mongoose.Types.ObjectId,
  targetIds: readonly string[],
): Promise<number> {
  let archived = 0;
  for (const targetId of targetIds) {
    const result = await ResearchEntityRelationship.updateMany(
      {
        sourceResearchEntityId: centerId,
        targetResearchEntityId: new mongoose.Types.ObjectId(targetId),
        archived: { $ne: true },
      },
      { $set: attributedArchiveSet(CENTER_AFFILIATION_HAND_OFF_REASON) },
    );
    archived += (result as { modifiedCount?: number }).modifiedCount ?? 0;
  }
  return archived;
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

export async function reconcileCenterAffiliationHandOffFromRun(
  scrapeRunId: string,
  deps: Pick<
    CenterRosterRetirementDeps,
    'relationshipTargetIdsAssertedByOtherSources' | 'resolveRelationshipTargetId'
  >,
  options: { dryRun?: boolean } = {},
): Promise<CenterAffiliationHandOffResult | null> {
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId)) return null;
  const centerKeys = (await Observation.distinct('entityKey', {
    scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: CENTER_AFFILIATION_CODE_ROSTER_LANE.sourceName,
  })) as string[];
  if (centerKeys.length === 0) return null;
  const result: CenterAffiliationHandOffResult = {
    dryRun: options.dryRun === true,
    centersRead: centerKeys.length,
    reattributedClaims: 0,
    handedOffClaims: 0,
    supportedClaimsKept: 0,
    claimsAwaitingRead: 0,
    retiredObservations: 0,
    archivedRelationships: 0,
    indexSyncFailures: 0,
  };
  for (const centerKey of centerKeys) {
    const center = (await ResearchEntity.findOne({ slug: centerKey, archived: { $ne: true } })
      .select('_id')
      .lean()) as { _id?: mongoose.Types.ObjectId } | null;
    if (!center?._id) continue;
    const llmClaims = await loadCenterAffiliationLlmClaims(
      centerKey,
      deps.resolveRelationshipTargetId,
    );
    if (llmClaims.length === 0) continue;
    const plan = planCenterAffiliationHandOff({
      reads: await loadCenterAffiliationCodeReads(centerKey, deps.resolveRelationshipTargetId),
      llmClaims,
    });
    result.reattributedClaims += plan.reattributed.length;
    result.handedOffClaims += plan.handedOff.length;
    result.supportedClaimsKept += plan.supportedKept;
    result.claimsAwaitingRead += plan.awaitingRead;
    const observationIds = (claims: readonly CenterAffiliationLlmClaim[]) =>
      claims.flatMap((claim) => claim.observationIds);
    result.retiredObservations +=
      observationIds(plan.reattributed).length + observationIds(plan.handedOff).length;
    if (result.dryRun || (plan.reattributed.length === 0 && plan.handedOff.length === 0)) continue;

    const protectedTargets = await deps.relationshipTargetIdsAssertedByOtherSources(centerKey);
    for (const claim of llmClaims) {
      const judged = plan.reattributed.includes(claim) || plan.handedOff.includes(claim);
      if (!judged && claim.targetId) protectedTargets.add(claim.targetId);
    }
    const endedTargets = Array.from(
      new Set(
        plan.handedOff
          .map((claim) => claim.targetId ?? '')
          .filter((targetId) => targetId && !protectedTargets.has(targetId)),
      ),
    );
    await retireObservationRows(
      observationIds(plan.reattributed),
      CENTER_AFFILIATION_RE_ATTRIBUTION_REASON,
    );
    await retireObservationRows(observationIds(plan.handedOff), CENTER_AFFILIATION_HAND_OFF_REASON);
    const archived = await archiveHandedOffRelationships(center._id, endedTargets);
    result.archivedRelationships += archived;
    if (archived > 0) result.indexSyncFailures += await regateAndResync(center._id);
  }
  return result;
}
