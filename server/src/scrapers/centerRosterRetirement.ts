/**
 * How `centers-institutes-index` stops asserting a center member it no longer lists
 * (#3781).
 *
 * Every roster member is its own observation key (`<center>:<member>`), so a member the
 * roster stops listing is never re-asserted and never superseded: its observations stay
 * live, the materializer keeps its role edge, and a stale lead edge is never demoted.
 * A fresh run cannot fix that by writing, because it says nothing about a key it did not
 * read.
 *
 * The evidence is a positive absence, stated by the lane itself: each successful read
 * emits a `centerRosterHealth` snapshot naming every member key, role claim, membership
 * key and relationship key it listed. Only a snapshot that read the whole roster, listed
 * at least one member, and came off the wire rather than the snapshot cache is admitted.
 * A refused, failed, partial, paged-out or empty read emits no admissible snapshot, so it
 * retires nothing.
 *
 * The guards, mirroring `facultyRosterDepartureReconciler`, `ysmLabDelistingReconciler`
 * and `fieldRetraction`, all fail closed:
 *
 *   1. Two admitted reads (`CENTER_ROSTER_MIN_ABSENT_READS`) in distinct runs, both after
 *      the claim was last observed and after the last read that listed it.
 *   2. A per-center absence ceiling (`CENTER_ROSTER_MAX_ABSENT_FRACTION`) over each
 *      population it governs: member keys, role edges and relationship keys. A broken
 *      selector or a key-shape change stops listing everybody at once and persists
 *      across runs, which defeats guard 1, so above the ceiling the center is frozen for
 *      the pass and reported, never applied partially.
 *   3. A discovery-retention floor (`CENTER_ROSTER_DISCOVERY_RETENTION_MIN_FRACTION`):
 *      a read that lists far fewer people than the largest admitted read on record is a
 *      read to distrust, whatever the absence fraction says.
 *
 * Scope is what this lane itself listed for this center: observations carrying this
 * source's name under this center's key prefix, and role edges whose
 * `rosterProvenance.sourceName` is this source. An edge whose membership key or
 * person-and-role another source still asserts is left alone, and so is a relationship
 * whose target another source, or a relationship key this read still lists, names.
 *
 * Retirement writes no field and no lock. Observations are retired through the
 * `superseded` plus `rollback` shape both read scopes honour, an edge is ended
 * (`state: HISTORICAL`) exactly as an official-roster departure ends one, and a
 * relationship is archived. Nothing is deleted, and because no live observation backs a
 * retired claim any more, the next materialization has nothing to resurrect it from.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { RoleAssignment } from '../models/roleAssignment';
import { syncEntities } from '../services/meiliSyncService';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { escapeRegex } from '../utils/regex';
import { retireObservations } from './observationStore';
import { officialProfileIdentityKey } from './utils/rosterMembershipKey';

export const CENTERS_INSTITUTES_SOURCE_NAME = 'centers-institutes-index';
export const CENTER_ROSTER_HEALTH_ENTITY_TYPE = 'centerRosterHealth' as const;
export const CENTER_ROSTER_HEALTH_FIELD = 'centerRosterHealth';

/**
 * Neutral names for the same stored tokens, because the mechanism is not centre-specific: any
 * listing-driven lane can emit a roster-health snapshot and have absence governed by the same
 * rule. The stored strings keep saying `centerRosterHealth` because renaming a stored entity type
 * and field is a migration, and two lanes' snapshots never collide since every read is scoped by
 * `sourceName` (#3852).
 */
export const ROSTER_HEALTH_ENTITY_TYPE = CENTER_ROSTER_HEALTH_ENTITY_TYPE;
export const ROSTER_HEALTH_FIELD = CENTER_ROSTER_HEALTH_FIELD;
export const CENTER_ROSTER_MIN_ABSENT_READS = 2;
export const CENTER_ROSTER_MAX_ABSENT_FRACTION = 0.5;
export const CENTER_ROSTER_DISCOVERY_RETENTION_MIN_FRACTION = 0.75;
export const CENTER_ROSTER_RETIREMENT_REASON =
  'center roster retirement: two complete reads of the center roster no longer list this claim (#3781)';

export type CenterRosterStopReason =
  | 'not-paginated'
  | 'empty-page'
  | 'repeated-page'
  | 'rendered-page'
  | 'page-cap'
  | 'fetch-failed'
  | 'extractor-error';

const STOP_REASONS_AT_THE_ROSTER_END: ReadonlySet<CenterRosterStopReason> = new Set([
  'not-paginated',
  'empty-page',
  'repeated-page',
  'rendered-page',
]);

export function centerRosterStopReadWholeRoster(stopReason: CenterRosterStopReason): boolean {
  return STOP_REASONS_AT_THE_ROSTER_END.has(stopReason);
}

export interface CenterRosterReadMember {
  memberKey: string;
  role: string;
  /**
   * Centre concepts, so optional: a lane whose listing carries no membership or relationship
   * identity omits them rather than inventing one. Admissibility and absence only ever read
   * `memberKey` and `role`.
   */
  membershipKey?: string;
  relationshipKey?: string;
}

export type CenterRosterReadStatus = 'ok' | 'empty' | 'partial-read';

export interface CenterRosterHealthSnapshot {
  centerKey?: unknown;
  entityKey?: unknown;
  status?: unknown;
  complete?: unknown;
  discoveredCount?: unknown;
  members?: unknown;
  read?: {
    pagesRead?: unknown;
    readMode?: unknown;
    cacheAllowed?: unknown;
    stopReason?: unknown;
    readAt?: unknown;
  };
}

export function buildCenterRosterHealthSnapshot(input: {
  centerKey: string;
  entityKey: string;
  members: readonly CenterRosterReadMember[];
  pagesRead: number;
  readMode: 'html' | 'rendered';
  stopReason: CenterRosterStopReason;
  cacheAllowed: boolean;
  readAt: Date;
}): CenterRosterHealthSnapshot {
  const members = [...input.members].sort((left, right) =>
    left.memberKey.localeCompare(right.memberKey),
  );
  const readWholeRoster = centerRosterStopReadWholeRoster(input.stopReason);
  const status: CenterRosterReadStatus = !readWholeRoster
    ? 'partial-read'
    : members.length > 0
      ? 'ok'
      : 'empty';
  return {
    centerKey: input.centerKey,
    entityKey: input.entityKey,
    status,
    complete: status === 'ok',
    discoveredCount: members.length,
    members,
    read: {
      pagesRead: input.pagesRead,
      readMode: input.readMode,
      cacheAllowed: input.cacheAllowed,
      stopReason: input.stopReason,
      readAt: input.readAt.toISOString(),
    },
  };
}

/**
 * Only `read-listed-members` is evidence. A cache-permitted read is excluded because two
 * runs inside the snapshot cache's lifetime replay one fetch, which would let a single
 * parse satisfy the two-read rule; the exhaustive sweep modes never pass `--use-cache`.
 */
export type CenterRosterReadAdmissibility =
  | 'read-listed-members'
  | 'read-listed-nobody'
  | 'incomplete'
  | 'cache-permitted'
  | 'not-read'
  | 'unrecorded';

export function snapshotMembers(snapshot: CenterRosterHealthSnapshot): CenterRosterReadMember[] {
  if (!Array.isArray(snapshot.members)) return [];
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return snapshot.members
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry) => ({
      memberKey: text(entry.memberKey),
      role: text(entry.role),
      membershipKey: text(entry.membershipKey),
      relationshipKey: text(entry.relationshipKey),
    }))
    .filter((entry) => entry.memberKey && entry.role);
}

export function centerRosterReadAdmissibility(
  snapshot: CenterRosterHealthSnapshot,
): CenterRosterReadAdmissibility {
  if (!Array.isArray(snapshot.members)) return 'unrecorded';
  const read = snapshot.read;
  if (!read || typeof read !== 'object') return 'unrecorded';
  const pagesRead = typeof read.pagesRead === 'number' ? read.pagesRead : 0;
  if (pagesRead <= 0 || (read.readMode !== 'html' && read.readMode !== 'rendered')) {
    return 'not-read';
  }
  if (snapshot.status === 'empty') return 'read-listed-nobody';
  if (snapshot.complete !== true) return 'incomplete';
  if (snapshotMembers(snapshot).length === 0) return 'read-listed-nobody';
  if (read.cacheAllowed !== false) return 'cache-permitted';
  return 'read-listed-members';
}

export interface CenterRosterRead {
  scrapeRunId: string;
  observedAt: Date;
  discoveredCount: number;
  memberKeys: ReadonlySet<string>;
  memberClaims: ReadonlySet<string>;
  memberProfileClaims: ReadonlySet<string>;
  membershipKeys: ReadonlySet<string>;
  relationshipKeys: ReadonlySet<string>;
  members: readonly CenterRosterReadMember[];
}

export const memberClaimKey = (memberKey: string, role: string): string => `${memberKey}|${role}`;

const identityPart = (membershipKey: string): string => {
  const separator = membershipKey.lastIndexOf('|');
  return separator > 0 ? membershipKey.slice(0, separator) : membershipKey;
};

export function centerRosterReadFromSnapshot(
  snapshot: CenterRosterHealthSnapshot,
  scrapeRunId: string,
  observedAt: Date,
): CenterRosterRead | null {
  if (centerRosterReadAdmissibility(snapshot) !== 'read-listed-members') return null;
  const members = snapshotMembers(snapshot);
  return {
    scrapeRunId,
    observedAt,
    discoveredCount: new Set(members.map((member) => member.memberKey)).size,
    memberKeys: new Set(members.map((member) => member.memberKey)),
    memberClaims: new Set(members.map((member) => memberClaimKey(member.memberKey, member.role))),
    memberProfileClaims: new Set(
      members
        .filter((member) => member.membershipKey)
        .map((member) =>
          memberClaimKey(member.memberKey, identityPart(member.membershipKey ?? '')),
        ),
    ),
    membershipKeys: new Set(members.map((member) => member.membershipKey ?? '').filter(Boolean)),
    relationshipKeys: new Set(
      members.map((member) => member.relationshipKey ?? '').filter(Boolean),
    ),
    members,
  };
}

/**
 * Admitted reads after the claim was last observed AND after the last read that listed
 * it, in runs other than the one that last observed it. Anchoring on the last listing as
 * well as on the observation keeps an intermittent absence from accumulating: a claim
 * listed between two absences starts counting again.
 */
export function absentReadRunIds(
  claim: { observedAt: Date; scrapeRunId?: string },
  reads: readonly CenterRosterRead[],
  isListed: (read: CenterRosterRead) => boolean,
): string[] {
  let anchor = claim.observedAt.getTime();
  for (const read of reads) {
    if (isListed(read)) anchor = Math.max(anchor, read.observedAt.getTime());
  }
  const runIds = new Set<string>();
  for (const read of reads) {
    if (claim.scrapeRunId && read.scrapeRunId === claim.scrapeRunId) continue;
    if (!(read.observedAt.getTime() > anchor)) continue;
    if (isListed(read)) continue;
    runIds.add(read.scrapeRunId);
  }
  return Array.from(runIds);
}

export function passesCenterRosterAbsenceCeiling(
  absentCount: number,
  governedCount: number,
  maxFraction: number = CENTER_ROSTER_MAX_ABSENT_FRACTION,
): boolean {
  if (absentCount <= 0) return true;
  if (governedCount <= 0) return false;
  return absentCount <= maxFraction * governedCount;
}

export function centerRosterDiscoveryRegressed(
  reads: readonly CenterRosterRead[],
  minRetainedFraction: number = CENTER_ROSTER_DISCOVERY_RETENTION_MIN_FRACTION,
): boolean {
  if (reads.length < 2) return false;
  const latest = reads.reduce((newest, read) =>
    read.observedAt.getTime() > newest.observedAt.getTime() ? read : newest,
  );
  const largest = Math.max(...reads.map((read) => read.discoveredCount));
  return latest.discoveredCount < minRetainedFraction * largest;
}

export interface CenterRosterGovernedObservation {
  observationId: string;
  entityKey: string;
  field: string;
  value: unknown;
  scrapeRunId: string;
  observedAt: Date;
  superseded: boolean;
}

export interface CenterRosterGovernedEdge {
  edgeId: string;
  personId: string;
  role: string;
  membershipKey: string;
  observedAt: Date | null;
}

export type CenterRosterFreezeReason =
  | 'member-absence-above-ceiling'
  | 'edge-absence-above-ceiling'
  | 'relationship-absence-above-ceiling'
  | 'discovery-regressed';

export interface CenterRosterRetirementCounts {
  admittedReads: number;
  governedMemberKeys: number;
  governedEdges: number;
  governedRelationshipKeys: number;
  memberKeysAwaitingSecondRead: number;
  edgesAwaitingSecondRead: number;
  protectedEdges: number;
  unkeyedEdges: number;
  unorderedEdges: number;
  retiredMemberKeys: number;
  retiredRoleClaims: number;
  retiredProfileClaims: number;
  retiredRelationshipKeys: number;
  retiredEdges: number;
  retiredLeadEdges: number;
  retiredObservations: number;
}

export interface PlannedEdgeRetirement {
  edgeId: string;
  role: string;
  membershipKey: string;
}

export interface CenterRosterRetirementPlan {
  entityKey: string;
  verdict: 'retire' | 'frozen' | 'nothing-to-retire';
  freezeReason?: CenterRosterFreezeReason;
  retiredMemberKeys: string[];
  retiredRoleClaims: string[];
  retiredProfileClaims: string[];
  retiredRelationshipKeys: string[];
  retiredEdges: PlannedEdgeRetirement[];
  observationIds: string[];
  counts: CenterRosterRetirementCounts;
}

const LEAD_CANONICAL_ROLES = new Set(['PI', 'DIRECTOR', 'CO_DIRECTOR']);

const emptyCounts = (): CenterRosterRetirementCounts => ({
  admittedReads: 0,
  governedMemberKeys: 0,
  governedEdges: 0,
  governedRelationshipKeys: 0,
  memberKeysAwaitingSecondRead: 0,
  edgesAwaitingSecondRead: 0,
  protectedEdges: 0,
  unkeyedEdges: 0,
  unorderedEdges: 0,
  retiredMemberKeys: 0,
  retiredRoleClaims: 0,
  retiredProfileClaims: 0,
  retiredRelationshipKeys: 0,
  retiredEdges: 0,
  retiredLeadEdges: 0,
  retiredObservations: 0,
});

interface ObservationGroup {
  key: string;
  rows: CenterRosterGovernedObservation[];
  latest: CenterRosterGovernedObservation;
}

function groupObservations(
  rows: readonly CenterRosterGovernedObservation[],
  keyOf: (row: CenterRosterGovernedObservation) => string,
): Map<string, ObservationGroup> {
  const groups = new Map<string, ObservationGroup>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, rows: [row], latest: row });
      continue;
    }
    group.rows.push(row);
    if (row.observedAt.getTime() > group.latest.observedAt.getTime()) group.latest = row;
  }
  return groups;
}

const liveGroups = (groups: Map<string, ObservationGroup>): ObservationGroup[] =>
  Array.from(groups.values()).filter((group) => group.rows.some((row) => !row.superseded));

export function planCenterRosterRetirement(input: {
  entityKey: string;
  reads: readonly CenterRosterRead[];
  memberObservations: readonly CenterRosterGovernedObservation[];
  relationshipObservations: readonly CenterRosterGovernedObservation[];
  edges: readonly CenterRosterGovernedEdge[];
  protectedMembershipKeys?: ReadonlySet<string>;
  protectedPersonRoles?: ReadonlySet<string>;
  minAbsentReads?: number;
  maxAbsentFraction?: number;
  minRetainedFraction?: number;
}): CenterRosterRetirementPlan {
  const minReads = input.minAbsentReads ?? CENTER_ROSTER_MIN_ABSENT_READS;
  const counts = emptyCounts();
  counts.admittedReads = input.reads.length;
  const plan: CenterRosterRetirementPlan = {
    entityKey: input.entityKey,
    verdict: 'nothing-to-retire',
    retiredMemberKeys: [],
    retiredRoleClaims: [],
    retiredProfileClaims: [],
    retiredRelationshipKeys: [],
    retiredEdges: [],
    observationIds: [],
    counts,
  };
  const retiredObservationIds = new Set<string>();

  const memberGroups = liveGroups(
    groupObservations(input.memberObservations, (row) => row.entityKey),
  );
  counts.governedMemberKeys = memberGroups.length;
  const retiredMemberKeys = new Set<string>();
  for (const group of memberGroups) {
    const absent = absentReadRunIds(
      { observedAt: group.latest.observedAt, scrapeRunId: group.latest.scrapeRunId },
      input.reads,
      (read) => read.memberKeys.has(group.key),
    );
    if (absent.length >= minReads) {
      retiredMemberKeys.add(group.key);
      for (const row of group.rows) retiredObservationIds.add(row.observationId);
    } else if (absent.length > 0) {
      counts.memberKeysAwaitingSecondRead += 1;
    }
  }

  const retireStaleMemberClaims = (
    field: string,
    claimOf: (value: string) => string,
    listedClaims: (read: CenterRosterRead) => ReadonlySet<string>,
  ): string[] => {
    const claimGroups = groupObservations(
      input.memberObservations.filter(
        (row) => row.field === field && typeof row.value === 'string' && row.value.trim(),
      ),
      (row) => memberClaimKey(row.entityKey, claimOf(String(row.value).trim())),
    );
    const retiredClaims: string[] = [];
    for (const group of claimGroups.values()) {
      if (retiredMemberKeys.has(group.latest.entityKey)) continue;
      const absent = absentReadRunIds(
        { observedAt: group.latest.observedAt, scrapeRunId: group.latest.scrapeRunId },
        input.reads,
        (read) => listedClaims(read).has(group.key),
      );
      if (absent.length < minReads) continue;
      retiredClaims.push(group.key);
      for (const row of group.rows) retiredObservationIds.add(row.observationId);
    }
    return retiredClaims;
  };
  const retiredRoleClaims = retireStaleMemberClaims(
    'role',
    (role) => role,
    (read) => read.memberClaims,
  );
  const retiredProfileClaims = retireStaleMemberClaims(
    'profileUrl',
    officialProfileIdentityKey,
    (read) => read.memberProfileClaims,
  );

  const relationshipGroups = liveGroups(
    groupObservations(input.relationshipObservations, (row) => row.entityKey),
  );
  counts.governedRelationshipKeys = relationshipGroups.length;
  const retiredRelationshipKeys: string[] = [];
  const retiredRelationshipObservationIds: string[] = [];
  for (const group of relationshipGroups) {
    const absent = absentReadRunIds(
      { observedAt: group.latest.observedAt, scrapeRunId: group.latest.scrapeRunId },
      input.reads,
      (read) => read.relationshipKeys.has(group.key),
    );
    if (absent.length < minReads) continue;
    retiredRelationshipKeys.push(group.key);
    for (const row of group.rows) retiredRelationshipObservationIds.push(row.observationId);
  }

  counts.governedEdges = input.edges.length;
  const retiredEdges: PlannedEdgeRetirement[] = [];
  for (const edge of input.edges) {
    if (!edge.membershipKey) {
      counts.unkeyedEdges += 1;
      continue;
    }
    if (!edge.observedAt) {
      counts.unorderedEdges += 1;
      continue;
    }
    if (
      input.protectedMembershipKeys?.has(edge.membershipKey) ||
      input.protectedPersonRoles?.has(`${edge.personId}|${edge.role}`)
    ) {
      counts.protectedEdges += 1;
      continue;
    }
    const absent = absentReadRunIds({ observedAt: edge.observedAt }, input.reads, (read) =>
      read.membershipKeys.has(edge.membershipKey),
    );
    if (absent.length >= minReads) {
      retiredEdges.push({
        edgeId: edge.edgeId,
        role: edge.role,
        membershipKey: edge.membershipKey,
      });
    } else if (absent.length > 0) {
      counts.edgesAwaitingSecondRead += 1;
    }
  }

  const maxFraction = input.maxAbsentFraction ?? CENTER_ROSTER_MAX_ABSENT_FRACTION;
  const freeze = (reason: CenterRosterFreezeReason): CenterRosterRetirementPlan => ({
    ...plan,
    verdict: 'frozen',
    freezeReason: reason,
  });
  if (
    !passesCenterRosterAbsenceCeiling(
      retiredMemberKeys.size,
      counts.governedMemberKeys,
      maxFraction,
    )
  ) {
    return freeze('member-absence-above-ceiling');
  }
  if (!passesCenterRosterAbsenceCeiling(retiredEdges.length, counts.governedEdges, maxFraction)) {
    return freeze('edge-absence-above-ceiling');
  }
  if (
    !passesCenterRosterAbsenceCeiling(
      retiredRelationshipKeys.length,
      counts.governedRelationshipKeys,
      maxFraction,
    )
  ) {
    return freeze('relationship-absence-above-ceiling');
  }
  if (centerRosterDiscoveryRegressed(input.reads, input.minRetainedFraction)) {
    return freeze('discovery-regressed');
  }

  for (const id of retiredRelationshipObservationIds) retiredObservationIds.add(id);
  plan.retiredMemberKeys = Array.from(retiredMemberKeys).sort();
  plan.retiredRoleClaims = retiredRoleClaims.sort();
  plan.retiredProfileClaims = retiredProfileClaims.sort();
  plan.retiredRelationshipKeys = retiredRelationshipKeys.sort();
  plan.retiredEdges = retiredEdges;
  plan.observationIds = Array.from(retiredObservationIds);
  counts.retiredMemberKeys = plan.retiredMemberKeys.length;
  counts.retiredRoleClaims = plan.retiredRoleClaims.length;
  counts.retiredProfileClaims = plan.retiredProfileClaims.length;
  counts.retiredRelationshipKeys = plan.retiredRelationshipKeys.length;
  counts.retiredEdges = retiredEdges.length;
  counts.retiredLeadEdges = retiredEdges.filter((edge) =>
    LEAD_CANONICAL_ROLES.has(edge.role),
  ).length;
  counts.retiredObservations = plan.observationIds.length;
  if (plan.observationIds.length > 0 || retiredEdges.length > 0) plan.verdict = 'retire';
  return plan;
}

/**
 * Lookups that belong to the materializer, injected so this module does not import it
 * back: the materializer runs this lane, and each of these must answer exactly as the
 * materializer's own write path would.
 */
export interface CenterRosterRetirementDeps {
  membershipKeysAssertedByOtherSources(centerEntityKey: string): Promise<Set<string>>;
  personRolesAssertedByOtherSources(centerEntityKey: string): Promise<Set<string>>;
  relationshipTargetIdsAssertedByOtherSources(centerEntityKey: string): Promise<Set<string>>;
  resolveRelationshipTargetId(targetEntityKey: string): Promise<string | null>;
  rematerializeMemberKey(memberKey: string): Promise<void>;
}

const observationEntityKey = (row: { entityKey?: unknown }): string =>
  typeof row.entityKey === 'string' ? row.entityKey.trim() : '';

export async function loadCenterRosterReads(entityKey: string): Promise<CenterRosterRead[]> {
  return loadRosterReadsForSource(CENTERS_INSTITUTES_SOURCE_NAME, entityKey);
}

/**
 * The admitted reads one lane recorded for one listing, newest last.
 *
 * Scoped by `sourceName` on purpose: that is what lets a second lane reuse this mechanism without
 * its snapshots being read as the first lane's, and it is why the stored entity type can stay as
 * it is (#3852).
 */
export async function loadRosterReadsForSource(
  sourceName: string,
  entityKey: string,
): Promise<CenterRosterRead[]> {
  const rows = (await Observation.find({
    entityType: ROSTER_HEALTH_ENTITY_TYPE,
    field: ROSTER_HEALTH_FIELD,
    sourceName,
    entityKey,
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('value scrapeRunId observedAt')
    .lean()) as Array<{ value?: unknown; scrapeRunId?: unknown; observedAt?: unknown }>;
  const reads: CenterRosterRead[] = [];
  for (const row of rows) {
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!scrapeRunId || !(row.observedAt instanceof Date)) continue;
    const read = centerRosterReadFromSnapshot(
      (row.value ?? {}) as CenterRosterHealthSnapshot,
      scrapeRunId,
      row.observedAt,
    );
    if (read) reads.push(read);
  }
  return reads;
}

async function loadGovernedObservations(
  entityType: 'researchGroupMember' | 'researchEntityRelationship',
  centerEntityKey: string,
): Promise<CenterRosterGovernedObservation[]> {
  const rows = (await Observation.find({
    entityType,
    sourceName: CENTERS_INSTITUTES_SOURCE_NAME,
    entityKey: { $regex: `^${escapeRegex(centerEntityKey)}:` },
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id entityKey field value scrapeRunId observedAt superseded')
    .lean()) as any[];
  const observations: CenterRosterGovernedObservation[] = [];
  for (const row of rows) {
    const observationId = serializedDocumentId(row._id) || '';
    const entityKey = observationEntityKey(row);
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!observationId || !entityKey || !scrapeRunId || !(row.observedAt instanceof Date)) continue;
    observations.push({
      observationId,
      entityKey,
      field: String(row.field || ''),
      value: row.value,
      scrapeRunId,
      observedAt: row.observedAt,
      superseded: row.superseded === true,
    });
  }
  return observations;
}

async function loadGovernedEdges(centerEntityId: string): Promise<CenterRosterGovernedEdge[]> {
  const rows = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': new mongoose.Types.ObjectId(centerEntityId),
    'rosterProvenance.sourceName': CENTERS_INSTITUTES_SOURCE_NAME,
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('_id personId role rosterProvenance')
    .lean()) as any[];
  return rows.map((row) => ({
    edgeId: serializedDocumentId(row._id) || '',
    personId: serializedDocumentId(row.personId) || '',
    role: String(row.role || ''),
    membershipKey:
      typeof row.rosterProvenance?.membershipKey === 'string'
        ? row.rosterProvenance.membershipKey
        : '',
    observedAt:
      row.rosterProvenance?.observedAt instanceof Date ? row.rosterProvenance.observedAt : null,
  }));
}

export interface CenterRosterRetirementInputs {
  centerEntityId: string;
  reads: CenterRosterRead[];
  memberObservations: CenterRosterGovernedObservation[];
  relationshipObservations: CenterRosterGovernedObservation[];
  edges: CenterRosterGovernedEdge[];
  protectedMembershipKeys: Set<string>;
  protectedPersonRoles: Set<string>;
}

export async function loadCenterRosterRetirementInputs(
  centerEntityKey: string,
  deps: Pick<
    CenterRosterRetirementDeps,
    'membershipKeysAssertedByOtherSources' | 'personRolesAssertedByOtherSources'
  >,
  reads?: CenterRosterRead[],
): Promise<CenterRosterRetirementInputs | null> {
  const entity = (await ResearchEntity.findOne({ slug: centerEntityKey, archived: { $ne: true } })
    .select('_id')
    .lean()) as { _id?: unknown } | null;
  const centerEntityId = serializedDocumentId(entity?._id) || '';
  if (!centerEntityId) return null;
  return {
    centerEntityId,
    reads: reads ?? (await loadCenterRosterReads(centerEntityKey)),
    memberObservations: await loadGovernedObservations('researchGroupMember', centerEntityKey),
    relationshipObservations: await loadGovernedObservations(
      'researchEntityRelationship',
      centerEntityKey,
    ),
    edges: await loadGovernedEdges(centerEntityId),
    protectedMembershipKeys: await deps.membershipKeysAssertedByOtherSources(centerEntityKey),
    protectedPersonRoles: await deps.personRolesAssertedByOtherSources(centerEntityKey),
  };
}

async function retireObservationRows(observationIds: readonly string[]): Promise<void> {
  if (observationIds.length === 0) return;
  const ids = observationIds.map((id) => new mongoose.Types.ObjectId(id));
  await retireObservations({ _id: { $in: ids } }, CENTER_ROSTER_RETIREMENT_REASON);
  await Observation.updateMany(
    { _id: { $in: ids }, superseded: true, 'rollback.rolledBackAt': { $exists: false } },
    { $set: { rollback: { rolledBackAt: new Date(), reason: CENTER_ROSTER_RETIREMENT_REASON } } },
  );
}

export interface AppliedCenterRosterRetirement {
  archivedRelationships: number;
  rematerializedMemberKeys: number;
  regated: boolean;
}

export async function applyCenterRosterRetirementPlan(
  plan: CenterRosterRetirementPlan,
  inputs: CenterRosterRetirementInputs,
  deps: CenterRosterRetirementDeps,
  endedAt: Date,
): Promise<AppliedCenterRosterRetirement> {
  const applied: AppliedCenterRosterRetirement = {
    archivedRelationships: 0,
    rematerializedMemberKeys: 0,
    regated: false,
  };
  if (plan.verdict !== 'retire') return applied;

  const retiredRelationshipKeys = new Set(plan.retiredRelationshipKeys);
  const retiredTargetKeys = Array.from(
    new Set(
      inputs.relationshipObservations
        .filter(
          (row) =>
            retiredRelationshipKeys.has(row.entityKey) &&
            row.field === 'targetEntityKey' &&
            typeof row.value === 'string',
        )
        .map((row) => String(row.value).trim())
        .filter(Boolean),
    ),
  );

  await retireObservationRows(plan.observationIds);

  if (plan.retiredEdges.length > 0) {
    await RoleAssignment.updateMany(
      {
        _id: { $in: plan.retiredEdges.map((edge) => new mongoose.Types.ObjectId(edge.edgeId)) },
        'rosterProvenance.sourceName': CENTERS_INSTITUTES_SOURCE_NAME,
        state: { $ne: 'HISTORICAL' },
      },
      { $set: { state: 'HISTORICAL', endedAt } },
    );
  }

  if (retiredTargetKeys.length > 0) {
    const protectedTargets = await deps.relationshipTargetIdsAssertedByOtherSources(plan.entityKey);
    const targetKeysThisSourceStillAsserts = new Set(
      inputs.relationshipObservations
        .filter(
          (row) =>
            !retiredRelationshipKeys.has(row.entityKey) &&
            !row.superseded &&
            row.field === 'targetEntityKey' &&
            typeof row.value === 'string',
        )
        .map((row) => String(row.value).trim())
        .filter(Boolean),
    );
    for (const targetKey of targetKeysThisSourceStillAsserts) {
      const targetId = await deps.resolveRelationshipTargetId(targetKey);
      if (targetId) protectedTargets.add(targetId);
    }
    const centerObjectId = new mongoose.Types.ObjectId(inputs.centerEntityId);
    for (const targetKey of retiredTargetKeys) {
      const targetId = await deps.resolveRelationshipTargetId(targetKey);
      if (!targetId || protectedTargets.has(targetId)) continue;
      const result = await ResearchEntityRelationship.updateMany(
        {
          sourceResearchEntityId: centerObjectId,
          targetResearchEntityId: new mongoose.Types.ObjectId(targetId),
          archived: { $ne: true },
        },
        { $set: { archived: true } },
      );
      applied.archivedRelationships += (result as { modifiedCount?: number }).modifiedCount ?? 0;
    }
  }

  const retiredIdentities = new Set(
    plan.retiredEdges.map((edge) => identityPart(edge.membershipKey)),
  );
  const retiredClaimMemberKeys = new Set(
    [...plan.retiredRoleClaims, ...plan.retiredProfileClaims].map((claim) => claim.split('|')[0]),
  );
  const latestRead = inputs.reads.reduce<CenterRosterRead | null>(
    (newest, read) =>
      !newest || read.observedAt.getTime() > newest.observedAt.getTime() ? read : newest,
    null,
  );
  const stillListed = (latestRead?.members ?? []).filter(
    (member) =>
      retiredClaimMemberKeys.has(member.memberKey) ||
      (member.membershipKey && retiredIdentities.has(identityPart(member.membershipKey))),
  );
  for (const memberKey of new Set(stillListed.map((member) => member.memberKey))) {
    await deps.rematerializeMemberKey(memberKey);
    applied.rematerializedMemberKeys += 1;
  }

  if (
    plan.retiredEdges.length > 0 ||
    applied.archivedRelationships > 0 ||
    applied.rematerializedMemberKeys > 0
  ) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: [inputs.centerEntityId],
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    applied.regated = true;
    const center = await ResearchEntity.findOne({
      _id: new mongoose.Types.ObjectId(inputs.centerEntityId),
      archived: { $ne: true },
    }).lean();
    if (center) await syncEntities('researchEntity', [center] as any);
  }
  return applied;
}

export type CenterRosterRetirementOutcome =
  | 'invalid-run-id'
  | 'no-center-roster-read'
  | 'planned'
  | 'reconciled';

export interface CenterRosterRetirementCenterResult {
  entityKey: string;
  admissibility: CenterRosterReadAdmissibility;
  verdict?: CenterRosterRetirementPlan['verdict'] | 'entity-missing';
  freezeReason?: CenterRosterFreezeReason;
  counts?: CenterRosterRetirementCounts;
  applied?: AppliedCenterRosterRetirement;
}

export interface CenterRosterRetirementResult {
  outcome: CenterRosterRetirementOutcome;
  dryRun: boolean;
  centers: CenterRosterRetirementCenterResult[];
}

/**
 * Runs after every entity of the run has been projected, so a retirement reads the edges
 * the projection just wrote. A dry run plans and reports without writing, for the same
 * reason field retraction does: the freeze verdict has to be readable before a pass that
 * retires evidence is authorized.
 */
export async function reconcileCenterRosterRetirementsFromRun(
  scrapeRunId: string,
  deps: CenterRosterRetirementDeps,
  options: { dryRun?: boolean } = {},
): Promise<CenterRosterRetirementResult> {
  const dryRun = options.dryRun === true;
  let runObjectId: mongoose.Types.ObjectId;
  try {
    runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  } catch {
    return { outcome: 'invalid-run-id', dryRun, centers: [] };
  }
  const snapshots = (await Observation.find({
    scrapeRunId: runObjectId,
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: CENTERS_INSTITUTES_SOURCE_NAME,
  })
    .select('entityKey value observedAt')
    .lean()) as Array<{ entityKey?: unknown; value?: unknown }>;
  if (snapshots.length === 0) return { outcome: 'no-center-roster-read', dryRun, centers: [] };

  const centers: CenterRosterRetirementCenterResult[] = [];
  for (const snapshot of snapshots) {
    const entityKey = observationEntityKey(snapshot);
    if (!entityKey) continue;
    const admissibility = centerRosterReadAdmissibility(
      (snapshot.value ?? {}) as CenterRosterHealthSnapshot,
    );
    if (admissibility !== 'read-listed-members') {
      centers.push({ entityKey, admissibility });
      continue;
    }
    const inputs = await loadCenterRosterRetirementInputs(entityKey, deps);
    if (!inputs) {
      centers.push({ entityKey, admissibility, verdict: 'entity-missing' });
      continue;
    }
    const plan = planCenterRosterRetirement({ entityKey, ...inputs });
    const result: CenterRosterRetirementCenterResult = {
      entityKey,
      admissibility,
      verdict: plan.verdict,
      counts: plan.counts,
      ...(plan.freezeReason ? { freezeReason: plan.freezeReason } : {}),
    };
    if (plan.verdict === 'frozen') {
      console.warn(
        `[center-roster-retirement] frozen ${sanitizeLogValue(entityKey)} (${plan.freezeReason}): ${plan.counts.governedMemberKeys} member keys, ${plan.counts.governedEdges} edges governed`,
      );
    }
    if (!dryRun && plan.verdict === 'retire') {
      result.applied = await applyCenterRosterRetirementPlan(plan, inputs, deps, new Date());
    }
    centers.push(result);
  }
  return { outcome: dryRun ? 'planned' : 'reconciled', dryRun, centers };
}
