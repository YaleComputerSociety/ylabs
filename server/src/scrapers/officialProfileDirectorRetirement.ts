/**
 * How `official-profile-pi-backfill` stops asserting an organization director its director's
 * own profile no longer states (#5091).
 *
 * The organization-director mode records a `DIRECTOR` or `CO_DIRECTOR` edge on a lead-less
 * organizational row from one person's official profile (#5085). The centres roster retirement
 * cannot govern that edge: it admits only a read that lists at least one member, and its
 * absence ceiling freezes a row whose whole governed population went absent, which for a claim
 * made by a single person's page is every absence there can be.
 *
 * So each read of such a profile records a `centerRosterHealth` snapshot on the centres
 * contract, extended by one witness: `subjectKeys` names the profiles whose subject the read
 * confirmed and parsed. A profile that is about its subject and no longer states the
 * directorship is then `read-subject-stated-nothing`, which only this module weighs. A failed
 * fetch, a cache-permitted run, a refused page, or a page whose subject did not parse records
 * no subject and retires nothing, and a read of a different profile is never weighed against
 * an edge another profile asserted.
 *
 * Every other guard is the centres module's unchanged: two admitted absent reads in distinct
 * runs after the edge was last observed and after the last read that stated it
 * (`absentReadRunIds`, `CENTER_ROSTER_MIN_ABSENT_READS`), an edge another source still
 * asserts is protected, and the absence ceiling still freezes the pass when a run would end
 * more than one edge and more than half of those it judged, which is how a broken parser shows.
 *
 * Retirement writes no field and no lock: the edge's observations are retired through the
 * shared `superseded` plus `rollback` shape and the edge is ended (`state: HISTORICAL`).
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { syncResearchEntitiesWithOutcome } from '../services/researchEntityIndexSyncOutcome';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { escapeRegex } from '../utils/regex';
import {
  absentReadRunIds,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  CENTER_ROSTER_MAX_ABSENT_FRACTION,
  CENTER_ROSTER_MIN_ABSENT_READS,
  centerRosterReadAdmissibility,
  passesCenterRosterAbsenceCeiling,
  retireObservationRows,
  snapshotMembers,
  snapshotSubjectKeys,
  type CenterRosterHealthSnapshot,
  type CenterRosterLane,
} from './centerRosterRetirement';
import { officialProfileIdentityKey } from './utils/rosterMembershipKey';

export const OFFICIAL_PROFILE_DIRECTOR_SOURCE_NAME = 'official-profile-pi-backfill';
export const OFFICIAL_PROFILE_DIRECTOR_RETIREMENT_REASON =
  'official profile director retirement: two complete reads of the director profile no longer state the directorship (#5091)';

export const OFFICIAL_PROFILE_DIRECTOR_LANE: CenterRosterLane = {
  sourceName: OFFICIAL_PROFILE_DIRECTOR_SOURCE_NAME,
  retirementReason: OFFICIAL_PROFILE_DIRECTOR_RETIREMENT_REASON,
};

export const OFFICIAL_PROFILE_DIRECTOR_ROLES = ['DIRECTOR', 'CO_DIRECTOR'] as const;

const membershipIdentity = (membershipKey: string): string => {
  const separator = membershipKey.lastIndexOf('|');
  return separator > 0 ? membershipKey.slice(0, separator) : membershipKey;
};

export interface OfficialProfileDirectorRead {
  scrapeRunId: string;
  observedAt: Date;
  subjectKeys: ReadonlySet<string>;
  statedProfileKeys: ReadonlySet<string>;
}

export function officialProfileDirectorReadFromSnapshot(
  snapshot: CenterRosterHealthSnapshot,
  scrapeRunId: string,
  observedAt: Date,
): OfficialProfileDirectorRead | null {
  const admissibility = centerRosterReadAdmissibility(snapshot);
  if (admissibility !== 'read-listed-members' && admissibility !== 'read-subject-stated-nothing') {
    return null;
  }
  const subjectKeys = new Set(snapshotSubjectKeys(snapshot));
  if (subjectKeys.size === 0) return null;
  return {
    scrapeRunId,
    observedAt,
    subjectKeys,
    statedProfileKeys: new Set(
      snapshotMembers(snapshot)
        .map((member) => membershipIdentity(member.membershipKey ?? ''))
        .filter(Boolean),
    ),
  };
}

export interface OfficialProfileDirectorGovernedEdge {
  edgeId: string;
  personId: string;
  role: string;
  profileKey: string;
  observedAt: Date | null;
}

export function governedEdgeProfileKey(rosterProvenance: {
  membershipKey?: unknown;
  profileUrl?: unknown;
}): string {
  const membershipKey =
    typeof rosterProvenance.membershipKey === 'string' ? rosterProvenance.membershipKey : '';
  const fromMembership = membershipIdentity(membershipKey);
  if (fromMembership.startsWith('official-profile:')) return fromMembership;
  return officialProfileIdentityKey(
    typeof rosterProvenance.profileUrl === 'string' ? rosterProvenance.profileUrl : '',
  );
}

export interface OfficialProfileDirectorEdgeVerdict {
  edgeId: string;
  verdict: 'retire' | 'awaiting-second-read' | 'stated' | 'not-read' | 'protected' | 'unjudged';
}

/**
 * Judges one row's lane edges against the reads of each edge's own profile. A read of any
 * other profile names a different subject, so it is never evidence about this edge.
 */
export function judgeOfficialProfileDirectorEdges(input: {
  reads: readonly OfficialProfileDirectorRead[];
  edges: readonly OfficialProfileDirectorGovernedEdge[];
  protectedPersonRoles?: ReadonlySet<string>;
  minAbsentReads?: number;
}): OfficialProfileDirectorEdgeVerdict[] {
  const minReads = input.minAbsentReads ?? CENTER_ROSTER_MIN_ABSENT_READS;
  return input.edges.map((edge) => {
    if (!edge.profileKey || !edge.observedAt) return { edgeId: edge.edgeId, verdict: 'unjudged' };
    if (input.protectedPersonRoles?.has(`${edge.personId}|${edge.role}`)) {
      return { edgeId: edge.edgeId, verdict: 'protected' };
    }
    const readsOfThisProfile = input.reads.filter((read) => read.subjectKeys.has(edge.profileKey));
    if (readsOfThisProfile.length === 0) return { edgeId: edge.edgeId, verdict: 'not-read' };
    const absent = absentReadRunIds({ observedAt: edge.observedAt }, readsOfThisProfile, (read) =>
      read.statedProfileKeys.has(edge.profileKey),
    );
    if (absent.length >= minReads) return { edgeId: edge.edgeId, verdict: 'retire' };
    if (absent.length > 0) return { edgeId: edge.edgeId, verdict: 'awaiting-second-read' };
    return { edgeId: edge.edgeId, verdict: 'stated' };
  });
}

/**
 * The centres ceiling over the lane's population rather than one row's, because a row holds a
 * single director claim and so cannot tell a departure from a parser that stopped matching. A
 * single retirement is never frozen; a pass that would end several edges and more than half of
 * those it judged is.
 */
export function officialProfileDirectorPassFrozen(
  retiring: number,
  judged: number,
  maxFraction: number = CENTER_ROSTER_MAX_ABSENT_FRACTION,
): boolean {
  return retiring > 1 && !passesCenterRosterAbsenceCeiling(retiring, judged, maxFraction);
}

async function loadReads(organizationKey: string): Promise<OfficialProfileDirectorRead[]> {
  const rows = (await Observation.find({
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: OFFICIAL_PROFILE_DIRECTOR_SOURCE_NAME,
    entityKey: organizationKey,
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('value scrapeRunId observedAt')
    .lean()) as Array<{ value?: unknown; scrapeRunId?: unknown; observedAt?: unknown }>;
  const reads: OfficialProfileDirectorRead[] = [];
  for (const row of rows) {
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!scrapeRunId || !(row.observedAt instanceof Date)) continue;
    const read = officialProfileDirectorReadFromSnapshot(
      (row.value ?? {}) as CenterRosterHealthSnapshot,
      scrapeRunId,
      row.observedAt,
    );
    if (read) reads.push(read);
  }
  return reads;
}

async function loadGovernedEdges(
  organizationId: mongoose.Types.ObjectId,
): Promise<OfficialProfileDirectorGovernedEdge[]> {
  const rows = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': organizationId,
    'rosterProvenance.sourceName': OFFICIAL_PROFILE_DIRECTOR_SOURCE_NAME,
    role: { $in: [...OFFICIAL_PROFILE_DIRECTOR_ROLES] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('_id personId role rosterProvenance')
    .lean()) as any[];
  return rows.map((row) => ({
    edgeId: serializedDocumentId(row._id) || '',
    personId: serializedDocumentId(row.personId) || '',
    role: String(row.role || ''),
    profileKey: governedEdgeProfileKey(row.rosterProvenance ?? {}),
    observedAt:
      row.rosterProvenance?.observedAt instanceof Date ? row.rosterProvenance.observedAt : null,
  }));
}

async function memberObservationIdsForProfiles(
  organizationKey: string,
  profileKeys: ReadonlySet<string>,
): Promise<string[]> {
  if (profileKeys.size === 0) return [];
  const rows = (await Observation.find({
    entityType: 'researchGroupMember',
    sourceName: OFFICIAL_PROFILE_DIRECTOR_SOURCE_NAME,
    entityKey: { $regex: `^${escapeRegex(organizationKey)}:` },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id entityKey field value')
    .lean()) as Array<{ _id: unknown; entityKey?: unknown; field?: unknown; value?: unknown }>;
  const retiredMemberKeys = new Set(
    rows
      .filter(
        (row) =>
          row.field === 'profileUrl' &&
          typeof row.value === 'string' &&
          profileKeys.has(officialProfileIdentityKey(row.value)),
      )
      .map((row) => String(row.entityKey)),
  );
  return rows
    .filter((row) => retiredMemberKeys.has(String(row.entityKey)))
    .map((row) => serializedDocumentId(row._id) || '')
    .filter(Boolean);
}

export interface OfficialProfileDirectorRetirementDeps {
  personRolesAssertedByOtherSources(organizationKey: string): Promise<Set<string>>;
}

export interface OfficialProfileDirectorRetirementResult {
  dryRun: boolean;
  organizationsRead: number;
  judgedEdges: number;
  retiredEdges: number;
  edgesAwaitingSecondRead: number;
  statedEdges: number;
  unreadEdges: number;
  protectedEdges: number;
  unjudgedEdges: number;
  frozen: boolean;
  retiredObservations: number;
  indexSyncFailures: number;
}

/**
 * Runs after the run's entities are projected, so a claim the run re-stated has already
 * refreshed its edge before the absence is weighed. A dry run plans and reports only.
 */
export async function reconcileOfficialProfileDirectorRetirementsFromRun(
  scrapeRunId: string,
  deps: OfficialProfileDirectorRetirementDeps,
  options: { dryRun?: boolean } = {},
): Promise<OfficialProfileDirectorRetirementResult | null> {
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId)) return null;
  const organizationKeys = (await Observation.distinct('entityKey', {
    scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: OFFICIAL_PROFILE_DIRECTOR_SOURCE_NAME,
  })) as string[];
  if (organizationKeys.length === 0) return null;
  const result: OfficialProfileDirectorRetirementResult = {
    dryRun: options.dryRun === true,
    organizationsRead: organizationKeys.length,
    judgedEdges: 0,
    retiredEdges: 0,
    edgesAwaitingSecondRead: 0,
    statedEdges: 0,
    unreadEdges: 0,
    protectedEdges: 0,
    unjudgedEdges: 0,
    frozen: false,
    retiredObservations: 0,
    indexSyncFailures: 0,
  };
  const planned: Array<{
    organizationKey: string;
    organizationId: mongoose.Types.ObjectId;
    edges: OfficialProfileDirectorGovernedEdge[];
  }> = [];
  for (const organizationKey of organizationKeys) {
    const organization = (await ResearchEntity.findOne({
      slug: organizationKey,
      archived: { $ne: true },
    })
      .select('_id')
      .lean()) as { _id?: mongoose.Types.ObjectId } | null;
    if (!organization?._id) continue;
    const edges = await loadGovernedEdges(organization._id);
    if (edges.length === 0) continue;
    const verdicts = judgeOfficialProfileDirectorEdges({
      reads: await loadReads(organizationKey),
      edges,
      protectedPersonRoles: await deps.personRolesAssertedByOtherSources(organizationKey),
    });
    const retiring = new Set<string>();
    for (const { edgeId, verdict } of verdicts) {
      if (verdict === 'retire') retiring.add(edgeId);
      if (verdict === 'awaiting-second-read') result.edgesAwaitingSecondRead += 1;
      if (verdict === 'stated') result.statedEdges += 1;
      if (verdict === 'not-read') result.unreadEdges += 1;
      if (verdict === 'protected') result.protectedEdges += 1;
      if (verdict === 'unjudged') result.unjudgedEdges += 1;
      if (verdict === 'retire' || verdict === 'awaiting-second-read' || verdict === 'stated') {
        result.judgedEdges += 1;
      }
    }
    if (retiring.size === 0) continue;
    planned.push({
      organizationKey,
      organizationId: organization._id,
      edges: edges.filter((edge) => retiring.has(edge.edgeId)),
    });
  }
  const retiringCount = planned.reduce((total, row) => total + row.edges.length, 0);
  if (officialProfileDirectorPassFrozen(retiringCount, result.judgedEdges)) {
    result.frozen = true;
    console.warn(
      `[official-profile-director-retirement] frozen: ${retiringCount} of ${result.judgedEdges} judged director edges would end in one pass`,
    );
    return result;
  }
  result.retiredEdges = retiringCount;
  if (result.dryRun) return result;
  for (const row of planned) {
    const observationIds = await memberObservationIdsForProfiles(
      row.organizationKey,
      new Set(row.edges.map((edge) => edge.profileKey)),
    );
    await retireObservationRows(observationIds, OFFICIAL_PROFILE_DIRECTOR_RETIREMENT_REASON);
    result.retiredObservations += observationIds.length;
    await RoleAssignment.updateMany(
      {
        _id: { $in: row.edges.map((edge) => new mongoose.Types.ObjectId(edge.edgeId)) },
        'rosterProvenance.sourceName': OFFICIAL_PROFILE_DIRECTOR_SOURCE_NAME,
        state: { $ne: 'HISTORICAL' },
      },
      { $set: { state: 'HISTORICAL', endedAt: new Date() } },
    );
    await applyStudentVisibilityGatePlans(
      await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [String(row.organizationId)],
      }),
    );
    const refreshed = await ResearchEntity.findOne({
      _id: row.organizationId,
      archived: { $ne: true },
    }).lean();
    const indexSync = await syncResearchEntitiesWithOutcome(refreshed ? [refreshed] : []);
    result.indexSyncFailures += indexSync.indexSyncFailures;
  }
  return result;
}
