import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { retireObservations } from './observationStore';
import {
  CENTER_ROSTER_MIN_ABSENT_READS,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  centerRosterReadAdmissibility,
  snapshotMembers,
  absentReadRunIds,
  centerRosterDiscoveryRegressed,
  passesCenterRosterAbsenceCeiling,
  type CenterRosterFreezeReason,
  type CenterRosterHealthSnapshot,
  type CenterRosterRead,
} from './centerRosterRetirement';

const BBS_TRACK_SOURCE_NAME = 'bbs-research-track';

/**
 * Whether a BBS track read is evidence that a claim on one row is absent.
 *
 * A read names the rows its listed PIs resolved to. A listed PI who did not resolve to a row this
 * run contributes no row, for any reason: a profile fetch that failed, an ambiguous match, a
 * refusal, or no existing row. That is unknown rather than absent, so such a read must not count
 * against any claim that PI has ever been seen to hold.
 *
 * The alternative considered and rejected was to admit a read for absence only when every listed
 * PI resolved. That is simpler to state and inert in practice: on a complete 518-PI read the lane
 * measured 431 matched against 64 unmatched, 17 ambiguous and 6 refused, and a PI with no existing
 * row is an expected outcome because this lane never mints. Requiring all of them to resolve would
 * disqualify every read forever, and the mechanism would report success while retiring nothing
 * (#3852).
 */
export function bbsTrackReadBlocksRetirementOf(
  entityKey: string,
  read: BbsTrackRosterRead,
  claimRowsEverHeldByPi: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  for (const profileSlug of read.unresolvedMemberKeys) {
    if (claimRowsEverHeldByPi.get(profileSlug)?.has(entityKey)) return true;
  }
  return false;
}

export interface BbsTrackRosterRead extends CenterRosterRead {
  /** The rows this read's listed PIs resolved to, which is the claim's identity space. */
  claimEntityKeys: ReadonlySet<string>;
  /** Listed PIs that resolved to no row on this read, whatever the reason. */
  unresolvedMemberKeys: ReadonlySet<string>;
}

export interface BbsTrackClaim {
  observationId: string;
  entityKey: string;
  scrapeRunId?: string;
  observedAt: Date;
}

export type BbsTrackRetirementVerdict = 'retired' | 'frozen' | 'nothing-to-retire';

export interface BbsTrackRetirementPlan {
  verdict: BbsTrackRetirementVerdict;
  freezeReason?: CenterRosterFreezeReason;
  retiredObservationIds: string[];
  counts: {
    admittedReads: number;
    governedClaims: number;
    claimsAwaitingSecondRead: number;
    claimsBlockedByAnUnresolvedPi: number;
    retiredClaims: number;
  };
}

/**
 * Which of this lane's claims two admitted reads have now omitted.
 *
 * Every guard here is the centres module's, unchanged: the two-read rule, the absence ceiling that
 * freezes a pass rather than applying it partially, and the retention floor that distrusts a read
 * listing far fewer rows than the largest on record. A broken selector stops listing everybody at
 * once and persists across runs, which is what defeats a two-read guard on its own.
 */
export function planBbsTrackRosterRetirement(input: {
  reads: readonly BbsTrackRosterRead[];
  claims: readonly BbsTrackClaim[];
  claimRowsEverHeldByPi: ReadonlyMap<string, ReadonlySet<string>>;
}): BbsTrackRetirementPlan {
  const counts = {
    admittedReads: input.reads.length,
    governedClaims: input.claims.length,
    claimsAwaitingSecondRead: 0,
    claimsBlockedByAnUnresolvedPi: 0,
    retiredClaims: 0,
  };
  if (input.reads.length === 0 || input.claims.length === 0) {
    return { verdict: 'nothing-to-retire', retiredObservationIds: [], counts };
  }
  if (centerRosterDiscoveryRegressed(input.reads)) {
    return {
      verdict: 'frozen',
      freezeReason: 'discovery-regressed',
      retiredObservationIds: [],
      counts,
    };
  }

  const retiredObservationIds: string[] = [];
  for (const claim of input.claims) {
    const blocking = input.reads.some((read) =>
      bbsTrackReadBlocksRetirementOf(claim.entityKey, read, input.claimRowsEverHeldByPi),
    );
    if (blocking) {
      counts.claimsBlockedByAnUnresolvedPi += 1;
      continue;
    }
    const absentRuns = absentReadRunIds(claim, input.reads, (read) =>
      (read as BbsTrackRosterRead).claimEntityKeys.has(claim.entityKey),
    );
    if (absentRuns.length < CENTER_ROSTER_MIN_ABSENT_READS) {
      if (absentRuns.length > 0) counts.claimsAwaitingSecondRead += 1;
      continue;
    }
    retiredObservationIds.push(claim.observationId);
  }

  if (!passesCenterRosterAbsenceCeiling(retiredObservationIds.length, input.claims.length)) {
    return {
      verdict: 'frozen',
      freezeReason: 'member-absence-above-ceiling',
      retiredObservationIds: [],
      counts,
    };
  }
  counts.retiredClaims = retiredObservationIds.length;
  return {
    verdict: retiredObservationIds.length > 0 ? 'retired' : 'nothing-to-retire',
    retiredObservationIds,
    counts,
  };
}

export const BBS_TRACK_RETIREMENT_REASON =
  'bbs-research-track no longer lists this PI, confirmed by two admitted reads (#3852)';

/**
 * The admitted reads for this lane, one per scrape run, unioned across its tracks.
 *
 * Deliberately per RUN rather than per track. A PI listed by two tracks gets one `researchAreas`
 * observation whose value is the union of both tracks' labels, so the claim's granularity is the
 * observation and not the label. Retiring per track would remove labels a track that still lists
 * the PI is holding up. The question the claim actually poses is "does any track still list this
 * row", so a run's read is the union of its admitted track snapshots (#3852).
 *
 * A snapshot is admitted only when `centerRosterReadAdmissibility` returns `read-listed-members`,
 * so an empty parse, a failed fetch and a cache-permitted run are excluded here rather than
 * filtered later. A run with no admitted track snapshot contributes no read at all.
 */
export interface BbsTrackSnapshotRow {
  value?: unknown;
  scrapeRunId?: unknown;
  observedAt?: unknown;
}

/**
 * The aggregation, pure so it can be pinned: admitted snapshots grouped into one read per run.
 */
export function aggregateBbsTrackReads(rows: readonly BbsTrackSnapshotRow[]): {
  reads: BbsTrackRosterRead[];
  rowsEverHeldByPi: Map<string, Set<string>>;
} {
  const byRun = new Map<
    string,
    {
      observedAt: Date;
      claimEntityKeys: Set<string>;
      unresolvedMemberKeys: Set<string>;
      discoveredCount: number;
    }
  >();
  const rowsEverHeldByPi = new Map<string, Set<string>>();

  for (const row of rows) {
    const snapshot = (row.value ?? {}) as CenterRosterHealthSnapshot;
    if (centerRosterReadAdmissibility(snapshot) !== 'read-listed-members') continue;
    const runId = String(row.scrapeRunId ?? '');
    if (!runId) continue;
    const observedAt = new Date(String(row.observedAt));
    const entry = byRun.get(runId) ?? {
      observedAt,
      claimEntityKeys: new Set<string>(),
      unresolvedMemberKeys: new Set<string>(),
      discoveredCount: 0,
    };
    for (const member of snapshotMembers(snapshot)) {
      entry.discoveredCount += 1;
      if (member.claimEntityKey) {
        entry.claimEntityKeys.add(member.claimEntityKey);
        const held = rowsEverHeldByPi.get(member.memberKey) ?? new Set<string>();
        held.add(member.claimEntityKey);
        rowsEverHeldByPi.set(member.memberKey, held);
      } else {
        entry.unresolvedMemberKeys.add(member.memberKey);
      }
    }
    if (observedAt.getTime() > entry.observedAt.getTime()) entry.observedAt = observedAt;
    byRun.set(runId, entry);
  }

  // An unresolved PI only blocks a row it has actually been seen to hold, so a PI unresolved on
  // every read blocks nothing and cannot freeze the mechanism by itself.
  for (const entry of byRun.values()) {
    for (const memberKey of [...entry.unresolvedMemberKeys]) {
      if (!rowsEverHeldByPi.has(memberKey)) entry.unresolvedMemberKeys.delete(memberKey);
    }
  }

  const reads = [...byRun.entries()]
    .map(([scrapeRunId, entry]) => ({ scrapeRunId, ...entry }) as unknown as BbsTrackRosterRead)
    .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
  return { reads, rowsEverHeldByPi };
}

export async function loadBbsTrackRosterReads(): Promise<{
  reads: BbsTrackRosterRead[];
  rowsEverHeldByPi: Map<string, Set<string>>;
}> {
  const rows = (await Observation.find({
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: BBS_TRACK_SOURCE_NAME,
    scrapeRunId: { $exists: true, $ne: null },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('value scrapeRunId observedAt')
    .lean()) as BbsTrackSnapshotRow[];
  return aggregateBbsTrackReads(rows);
}

export type BbsTrackRetirementOutcome =
  | 'reconciled'
  | 'frozen'
  | 'no-admitted-read'
  | 'nothing-governed';

export interface BbsTrackRetirementResult {
  outcome: BbsTrackRetirementOutcome;
  dryRun: boolean;
  verdict?: BbsTrackRetirementVerdict;
  freezeReason?: CenterRosterFreezeReason;
  counts?: BbsTrackRetirementPlan['counts'];
}

/**
 * This lane's own live claims: a `researchAreas` value it asserted on a research entity.
 *
 * Scoped to this source name, so a label another source also asserts is untouched, exactly as the
 * centres implementation leaves an edge another source still claims.
 */
async function loadBbsTrackClaims(): Promise<BbsTrackClaim[]> {
  const rows = (await Observation.find({
    entityType: 'researchEntity',
    sourceName: BBS_TRACK_SOURCE_NAME,
    field: 'researchAreas',
    superseded: { $ne: true },
  })
    .select('_id entityKey entityId scrapeRunId observedAt')
    .lean()) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      observationId: String(row._id),
      entityKey: String(row.entityId ?? row.entityKey ?? ''),
      ...(row.scrapeRunId ? { scrapeRunId: String(row.scrapeRunId) } : {}),
      observedAt: new Date(String(row.observedAt)),
    }))
    .filter((claim) => claim.entityKey);
}

/**
 * Retire the claims two admitted reads have omitted, or report why nothing was retired.
 *
 * Writes no field and no lock: the observations go through the `superseded` plus `rollback` shape
 * both read scopes honour, which is the same path the centres retirement uses.
 */
export async function reconcileBbsTrackRetirements(
  options: { dryRun?: boolean } = {},
): Promise<BbsTrackRetirementResult> {
  const dryRun = options.dryRun === true;
  const { reads, rowsEverHeldByPi } = await loadBbsTrackRosterReads();
  if (reads.length === 0) return { outcome: 'no-admitted-read', dryRun };
  const claims = await loadBbsTrackClaims();
  if (claims.length === 0) return { outcome: 'nothing-governed', dryRun };

  const plan = planBbsTrackRosterRetirement({
    reads,
    claims,
    claimRowsEverHeldByPi: rowsEverHeldByPi,
  });
  if (plan.verdict === 'frozen') {
    console.warn(
      `[bbs-track-retirement] frozen (${plan.freezeReason}): ${plan.counts.governedClaims} claims governed across ${plan.counts.admittedReads} admitted reads`,
    );
    return {
      outcome: 'frozen',
      dryRun,
      verdict: plan.verdict,
      freezeReason: plan.freezeReason,
      counts: plan.counts,
    };
  }
  if (!dryRun && plan.retiredObservationIds.length > 0) {
    const ids = plan.retiredObservationIds.map((id) => new mongoose.Types.ObjectId(id));
    await retireObservations({ _id: { $in: ids } }, BBS_TRACK_RETIREMENT_REASON);
    await Observation.updateMany(
      { _id: { $in: ids }, superseded: true, 'rollback.rolledBackAt': { $exists: false } },
      { $set: { rollback: { rolledBackAt: new Date(), reason: BBS_TRACK_RETIREMENT_REASON } } },
    );
  }
  return { outcome: 'reconciled', dryRun, verdict: plan.verdict, counts: plan.counts };
}
