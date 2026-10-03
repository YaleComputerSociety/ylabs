import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { serializedDocumentId } from '../utils/idSerialization';
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
  type CenterRosterReadMember,
} from './centerRosterRetirement';
import {
  BBS_TRACKS,
  bbsProfileSlugFromUrl,
  bbsTrackResearchAreaLabels,
  normalizeMatchUrl,
} from './sources/bbsResearchTrackScraper';

const BBS_TRACK_SOURCE_NAME = 'bbs-research-track';

/**
 * A track snapshot that names the row each listed PI resolved to. A snapshot written before the
 * lane recorded rows lists every PI without one, which would read as every claim being absent, so
 * only a snapshot carrying this marker is evidence of anything (#3852).
 */
export type BbsTrackHealthSnapshot = CenterRosterHealthSnapshot & {
  claimEntityKeysRecorded?: unknown;
};

/**
 * Whether a BBS track read is evidence that a claim on one row is absent.
 *
 * A read names the rows its listed PIs resolved to. A listed PI who did not resolve to a row this
 * run contributes no row, for any reason: a profile fetch that failed, an ambiguous match, a
 * refusal, or no existing row. That is unknown rather than absent, so such a read must not count
 * against any claim that PI has ever been seen to hold. A PI never seen to hold any row could hold
 * any row no other PI has been seen to hold, so it blocks every such row as well.
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
  const rowSeenHeldByAPi = [...claimRowsEverHeldByPi.values()].some((rows) => rows.has(entityKey));
  for (const profileSlug of read.unresolvedMemberKeys) {
    const rowsHeld = claimRowsEverHeldByPi.get(profileSlug);
    if (rowsHeld ? rowsHeld.has(entityKey) : !rowSeenHeldByAPi) return true;
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
  storedEntityKey?: string;
  scrapeRunId?: string;
  sourceUrl?: string;
  value?: readonly string[];
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
    /** Claims whose stored key names no live row, excluded rather than counted absent. */
    orphanedClaims: number;
    claimsAwaitingSecondRead: number;
    claimsBlockedByAnUnresolvedPi: number;
    retiredClaims: number;
    movedClaims?: number;
    restatedClaims?: number;
    claimsUnkeyedForRestatement?: number;
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
    orphanedClaims: 0,
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

/**
 * The PI a claim or a graft cites, in one comparable form whichever page it cites.
 *
 * A graft cites the PI's canonical YSM profile when the lane could read it and the BBS profile
 * otherwise, and a track snapshot names the PI by BBS profile slug, so both forms are keyed.
 */
export function bbsCitedPiKey(sourceUrl: unknown): string {
  const raw = typeof sourceUrl === 'string' ? sourceUrl : '';
  const bbsSlug = bbsProfileSlugFromUrl(raw);
  if (bbsSlug) return `bbs:${bbsSlug}`;
  const url = normalizeMatchUrl(raw);
  return url ? `url:${url.toLowerCase()}` : '';
}

export interface BbsRunResolutionRow {
  entityId?: unknown;
  sourceUrl?: unknown;
  value?: unknown;
}

/**
 * The rows one run resolved each listed PI to, keyed by every form the PI is cited in.
 *
 * Read from the run's own grafts and its own track snapshots, so it is positive evidence: a PI the
 * run could not resolve, for whatever reason, contributes nothing and so moves no claim.
 */
export function bbsRowsResolvedByCitedPi(input: {
  grafts: readonly BbsRunResolutionRow[];
  snapshots: readonly BbsRunResolutionRow[];
}): Map<string, Set<string>> {
  const rowsByPi = new Map<string, Set<string>>();
  const add = (piKey: string, rowId: string) => {
    if (!piKey || !rowId) return;
    const rows = rowsByPi.get(piKey) ?? new Set<string>();
    rows.add(rowId);
    rowsByPi.set(piKey, rows);
  };
  for (const graft of input.grafts) {
    add(bbsCitedPiKey(graft.sourceUrl), serializedDocumentId(graft.entityId) || '');
  }
  for (const snapshot of input.snapshots) {
    const value = (snapshot.value ?? {}) as BbsTrackHealthSnapshot;
    if (value.claimEntityKeysRecorded !== true) continue;
    for (const { member, piKeys } of bbsSnapshotMemberPiKeys(value)) {
      if (!member.claimEntityKey) continue;
      for (const piKey of piKeys) add(piKey, member.claimEntityKey);
    }
  }
  return rowsByPi;
}

function bbsSnapshotMemberPiKeys(
  snapshot: BbsTrackHealthSnapshot,
): Array<{ member: CenterRosterReadMember; piKeys: string[] }> {
  const canonicalUrlByMemberKey = new Map<string, string>();
  for (const entry of Array.isArray(snapshot.members) ? snapshot.members : []) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    if (typeof raw.memberKey === 'string' && typeof raw.canonicalProfileUrl === 'string') {
      canonicalUrlByMemberKey.set(raw.memberKey, raw.canonicalProfileUrl);
    }
  }
  return snapshotMembers(snapshot).map((member) => ({
    member,
    piKeys: [
      `bbs:${member.memberKey.toLowerCase()}`,
      bbsCitedPiKey(canonicalUrlByMemberKey.get(member.memberKey)),
    ].filter(Boolean),
  }));
}

/**
 * This lane's older claims whose PI the run has just resolved to a different row.
 *
 * The lane once grafted a PI's track onto a row it can no longer resolve that PI to, typically a
 * shell it minted before #3561 while the PI's canonical row now wins the person-key match. Its own
 * newer graft is on the canonical row, and nothing ever retired the older claim, because
 * latest-wins supersession is per row and absence retirement waits on reads that can never omit a
 * PI who is still listed (#3834).
 */
export function planBbsTrackMovedClaims(input: {
  claims: readonly BbsTrackClaim[];
  rowsResolvedByCitedPi: ReadonlyMap<string, ReadonlySet<string>>;
  scrapeRunId: string;
}): string[] {
  const moved: string[] = [];
  for (const claim of input.claims) {
    if (claim.scrapeRunId === input.scrapeRunId) continue;
    const resolvedRows = input.rowsResolvedByCitedPi.get(bbsCitedPiKey(claim.sourceUrl));
    if (!resolvedRows || resolvedRows.size === 0 || resolvedRows.has(claim.entityKey)) continue;
    moved.push(claim.observationId);
  }
  return moved;
}

/**
 * The labels one complete read lists each PI under, keyed as `bbsCitedPiKey` keys a claim.
 *
 * Only a run with an admitted snapshot for every track says what a PI is listed under, because a
 * PI's graft is the union of every track that lists them, and a missing track would read as a
 * label the source dropped. Any other run returns an empty map, so it restates nothing.
 */
export function bbsLabelsListedByCitedPi(
  snapshots: readonly BbsRunResolutionRow[],
): Map<string, Set<string>> {
  const labelsByPi = new Map<string, Set<string>>();
  const admittedTracks = new Set<string>();
  for (const snapshot of snapshots) {
    const value = (snapshot.value ?? {}) as BbsTrackHealthSnapshot;
    if (value.claimEntityKeysRecorded !== true) continue;
    if (centerRosterReadAdmissibility(value) !== 'read-listed-members') continue;
    const trackKey = String(value.entityKey ?? '');
    const labels = bbsTrackResearchAreaLabels(trackKey);
    if (labels.length === 0) continue;
    admittedTracks.add(trackKey);
    for (const { piKeys } of bbsSnapshotMemberPiKeys(value)) {
      for (const piKey of piKeys) {
        const listed = labelsByPi.get(piKey) ?? new Set<string>();
        for (const label of labels) listed.add(label);
        labelsByPi.set(piKey, listed);
      }
    }
  }
  const everyTrackRead = BBS_TRACKS.every((track) => admittedTracks.has(track.slug));
  return everyTrackRead ? labelsByPi : new Map();
}

/**
 * This lane's older claims asserting only labels the listing no longer gives their PI.
 *
 * The moved-claim pass reaches a claim only through the row its PI resolves to now, so a PI the
 * run read but could not resolve leaves its pre-split claim live on the row it used to graft onto:
 * nothing supersedes it, and absence retirement never acts because the PI is still listed. The
 * listing itself refutes the claim, though, whichever row it sits on, so it is retired on that
 * evidence. A claim on a row its PI resolved to this run is left to latest-wins supersession, and
 * one carrying any label the listing still gives is kept, because retiring the observation would
 * remove that label too, as `aggregateBbsTrackReads` explains (#3834).
 *
 * A claim whose cited PI no complete read keys, typically one citing a canonical profile the run
 * could not read, is counted as unkeyed rather than silently kept.
 */
export function planBbsTrackRestatedClaims(input: {
  claims: readonly BbsTrackClaim[];
  labelsListedByCitedPi: ReadonlyMap<string, ReadonlySet<string>>;
  rowsResolvedByCitedPi: ReadonlyMap<string, ReadonlySet<string>>;
  scrapeRunId: string;
}): { restated: string[]; unkeyed: number } {
  const restated: string[] = [];
  let unkeyed = 0;
  if (input.labelsListedByCitedPi.size === 0) return { restated, unkeyed };
  for (const claim of input.claims) {
    if (claim.scrapeRunId === input.scrapeRunId || !claim.value?.length) continue;
    const piKey = bbsCitedPiKey(claim.sourceUrl);
    const listed = input.labelsListedByCitedPi.get(piKey);
    if (!listed) {
      unkeyed += 1;
      continue;
    }
    if (input.rowsResolvedByCitedPi.get(piKey)?.has(claim.entityKey)) continue;
    if (claim.value.some((label) => listed.has(label))) continue;
    restated.push(claim.observationId);
  }
  return { restated, unkeyed };
}

export const BBS_TRACK_RESTATED_CLAIM_REASON =
  'bbs-research-track lists this PI under labels this claim no longer matches (#3834)';

export const BBS_TRACK_MOVED_CLAIM_REASON =
  'bbs-research-track now resolves this PI to another row, which carries its newer graft (#3834)';

export const BBS_TRACK_RETIREMENT_REASON =
  'bbs-research-track no longer lists this PI, confirmed by two admitted reads (#3852)';

export interface BbsTrackSnapshotRow {
  entityKey?: unknown;
  value?: unknown;
  scrapeRunId?: unknown;
  observedAt?: unknown;
}

/**
 * The admitted reads for this lane, one per scrape run, unioned across its tracks.
 *
 * Deliberately per RUN rather than per track. A PI listed by two tracks gets one `researchAreas`
 * observation whose value is the union of both tracks' labels, so the claim's granularity is the
 * observation and not the label. Retiring per track would remove labels a track that still lists
 * the PI is holding up. The question the claim actually poses is "does any track still list this
 * row", so a run's read is the union of its admitted track snapshots (#3852).
 *
 * A run is a read only when it carries an admitted snapshot for EVERY track. A track whose fetch
 * failed, whose parse came back empty, or which `--only` left out says nothing about its PIs, so
 * letting the other tracks stand in for the run would read every PI only that track lists as
 * absent. A snapshot is admitted only when `centerRosterReadAdmissibility` returns
 * `read-listed-members` and it records the rows its PIs resolved to.
 *
 * Which rows a PI has been seen to hold is read from every snapshot that records rows, admitted or
 * not, because a resolution is evidence of holding whether or not the read was complete.
 */
export function aggregateBbsTrackReads(
  rows: readonly BbsTrackSnapshotRow[],
  requiredTrackKeys: readonly string[],
): {
  reads: BbsTrackRosterRead[];
  rowsEverHeldByPi: Map<string, Set<string>>;
} {
  const byRun = new Map<
    string,
    {
      observedAt: Date;
      admittedTrackKeys: Set<string>;
      claimEntityKeys: Set<string>;
      unresolvedMemberKeys: Set<string>;
      discoveredCount: number;
    }
  >();
  const rowsEverHeldByPi = new Map<string, Set<string>>();

  for (const row of rows) {
    const snapshot = (row.value ?? {}) as BbsTrackHealthSnapshot;
    if (snapshot.claimEntityKeysRecorded !== true) continue;
    const members = snapshotMembers(snapshot);
    for (const member of members) {
      if (!member.claimEntityKey) continue;
      const held = rowsEverHeldByPi.get(member.memberKey) ?? new Set<string>();
      held.add(member.claimEntityKey);
      rowsEverHeldByPi.set(member.memberKey, held);
    }

    if (centerRosterReadAdmissibility(snapshot) !== 'read-listed-members') continue;
    const runId = String(row.scrapeRunId ?? '');
    const trackKey = String(row.entityKey ?? '');
    if (!runId || !trackKey) continue;
    const observedAt = new Date(row.observedAt as Date | string);
    const entry = byRun.get(runId) ?? {
      observedAt,
      admittedTrackKeys: new Set<string>(),
      claimEntityKeys: new Set<string>(),
      unresolvedMemberKeys: new Set<string>(),
      discoveredCount: 0,
    };
    entry.admittedTrackKeys.add(trackKey);
    for (const member of members) {
      entry.discoveredCount += 1;
      if (member.claimEntityKey) entry.claimEntityKeys.add(member.claimEntityKey);
      else entry.unresolvedMemberKeys.add(member.memberKey);
    }
    if (observedAt.getTime() > entry.observedAt.getTime()) entry.observedAt = observedAt;
    byRun.set(runId, entry);
  }

  const reads = [...byRun.entries()]
    .filter(([, entry]) => requiredTrackKeys.every((key) => entry.admittedTrackKeys.has(key)))
    .map(
      ([scrapeRunId, entry]) =>
        ({
          scrapeRunId,
          observedAt: entry.observedAt,
          claimEntityKeys: entry.claimEntityKeys,
          unresolvedMemberKeys: entry.unresolvedMemberKeys,
          discoveredCount: entry.discoveredCount,
        }) as unknown as BbsTrackRosterRead,
    )
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
    .select('entityKey value scrapeRunId observedAt')
    .lean()) as BbsTrackSnapshotRow[];
  return aggregateBbsTrackReads(
    rows,
    BBS_TRACKS.map((track) => track.slug),
  );
}

export type BbsTrackRetirementOutcome =
  | 'reconciled'
  | 'frozen'
  | 'invalid-run-id'
  | 'no-bbs-track-read'
  | 'no-admitted-read'
  | 'nothing-governed';

export interface BbsTrackRetirementResult {
  outcome: BbsTrackRetirementOutcome;
  dryRun: boolean;
  verdict?: BbsTrackRetirementVerdict;
  freezeReason?: CenterRosterFreezeReason;
  counts?: BbsTrackRetirementPlan['counts'];
}

export interface BbsTrackRetirementDeps {
  rematerializeResearchEntity(identifier: { entityId?: string; entityKey?: string }): Promise<void>;
}

/**
 * This lane's own live claims, in both identity forms it has ever written them in.
 *
 * Scoped to this source name, so a label another source also asserts is untouched, exactly as the
 * centres implementation leaves an edge another source still claims.
 *
 * A snapshot names each resolved PI's row by id, so a claim has to be canonicalised to an id
 * before it can be compared. Keying governance on the stored `entityId` alone reached 47% of this
 * lane's claims and **none** of the population #3852 was filed about: measured on Development,
 * 492 of 1,037 live claims carry an `entityId` while **545 carry only an `entityKey`**, and those
 * 545 are the August grafts the issue is about. A claim nobody can name is a claim nobody can
 * retire, so the slug form is resolved here rather than skipped.
 *
 * **Orphans are excluded rather than counted absent.** Of those 545 keys only 130 resolve to a
 * live row; the other 415 point at rows that no longer exist. A claim whose row is gone is not a
 * claim two reads have stopped listing, it is an observation left behind by a row that went away,
 * and treating its row's absence from a listing as evidence would retire it for the wrong reason.
 * They are reported as `orphanedClaims` so the exclusion is visible rather than silent.
 */
async function loadBbsTrackClaims(): Promise<{ claims: BbsTrackClaim[]; orphanedClaims: number }> {
  const rows = (await Observation.find({
    entityType: 'researchEntity',
    sourceName: BBS_TRACK_SOURCE_NAME,
    field: 'researchAreas',
    superseded: { $ne: true },
  })
    .select('_id entityId entityKey scrapeRunId sourceUrl value observedAt')
    .lean()) as Array<Record<string, unknown>>;

  const storedIds = [
    ...new Set(rows.filter((row) => row.entityId).map((row) => String(row.entityId))),
  ];
  const storedSlugs = [
    ...new Set(
      rows
        .filter((row) => !row.entityId && typeof row.entityKey === 'string' && row.entityKey)
        .map((row) => String(row.entityKey)),
    ),
  ];
  const liveRows = (await ResearchEntity.find({
    $or: [{ _id: { $in: storedIds } }, { slug: { $in: storedSlugs } }],
    archived: { $ne: true },
  })
    .select('_id slug')
    .lean()) as Array<Record<string, unknown>>;
  const liveRowIds = new Set(liveRows.map((row) => serializedDocumentId(row._id) || ''));
  const rowIdBySlug = new Map(
    liveRows.map((row) => [String(row.slug), serializedDocumentId(row._id) || '']),
  );

  const claims: BbsTrackClaim[] = [];
  let orphanedClaims = 0;
  for (const row of rows) {
    const storedEntityKey = row.entityId ? undefined : String(row.entityKey ?? '');
    const canonical =
      storedEntityKey === undefined
        ? liveRowIds.has(String(row.entityId))
          ? String(row.entityId)
          : ''
        : (rowIdBySlug.get(storedEntityKey) ?? '');
    if (!canonical) {
      orphanedClaims += 1;
      continue;
    }
    claims.push({
      observationId: String(row._id),
      entityKey: canonical,
      ...(storedEntityKey ? { storedEntityKey } : {}),
      ...(row.scrapeRunId ? { scrapeRunId: String(row.scrapeRunId) } : {}),
      ...(typeof row.sourceUrl === 'string' ? { sourceUrl: row.sourceUrl } : {}),
      ...(Array.isArray(row.value)
        ? { value: row.value.filter((label): label is string => typeof label === 'string') }
        : {}),
      observedAt: new Date(row.observedAt as Date | string),
    });
  }
  return { claims, orphanedClaims };
}

/**
 * Retire the claims two admitted reads have omitted, or report why nothing was retired.
 *
 * Triggered only by a run that recorded a track read, as the centres retirement is. The reads it
 * weighs are lane-wide, because a claim is absent only when no track still lists the row.
 *
 * Writes no field and no lock: the observations go through the `superseded` plus `rollback` shape
 * both read scopes honour, which is the same path the centres retirement uses, and each row that
 * lost a claim is then re-projected so the retirement reaches the stored row.
 */
export async function reconcileBbsTrackRetirementsFromRun(
  scrapeRunId: string,
  deps: BbsTrackRetirementDeps,
  options: { dryRun?: boolean } = {},
): Promise<BbsTrackRetirementResult> {
  const dryRun = options.dryRun === true;
  let runObjectId: mongoose.Types.ObjectId;
  try {
    runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  } catch {
    return { outcome: 'invalid-run-id', dryRun };
  }
  const runRecordedATrackRead = await Observation.exists({
    scrapeRunId: runObjectId,
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    field: CENTER_ROSTER_HEALTH_FIELD,
    sourceName: BBS_TRACK_SOURCE_NAME,
  });
  if (!runRecordedATrackRead) return { outcome: 'no-bbs-track-read', dryRun };
  const { reads, rowsEverHeldByPi } = await loadBbsTrackRosterReads();
  const { claims, orphanedClaims } = await loadBbsTrackClaims();
  const { movedObservationIds, restatedObservationIds, claimsUnkeyedForRestatement } =
    await planRunResolvedClaims(
    runObjectId,
    claims,
  );
  if (
    reads.length === 0 &&
    movedObservationIds.length === 0 &&
    restatedObservationIds.length === 0
  ) {
    return { outcome: 'no-admitted-read', dryRun };
  }
  const retire = async (observationIds: readonly string[], reason: string) => {
    if (dryRun || observationIds.length === 0) return;
    const ids = observationIds.map((id) => new mongoose.Types.ObjectId(id));
    await retireObservations({ _id: { $in: ids } }, reason);
  };
  if (claims.length === 0) {
    // Orphans are reported even here, so "nothing governed" never hides a population the loader
    // declined to weigh.
    return {
      outcome: 'nothing-governed',
      dryRun,
      counts: {
        admittedReads: reads.length,
        governedClaims: 0,
        orphanedClaims,
        claimsAwaitingSecondRead: 0,
        claimsBlockedByAnUnresolvedPi: 0,
        retiredClaims: 0,
        movedClaims: 0,
        restatedClaims: 0,
        claimsUnkeyedForRestatement,
      },
    };
  }

  const plan = planBbsTrackRosterRetirement({
    reads,
    claims,
    claimRowsEverHeldByPi: rowsEverHeldByPi,
  });
  // Surfaced beside the governed count so an operator can see how much of the population the
  // mechanism declined to weigh, rather than reading a low retired count as a clean corpus.
  plan.counts.orphanedClaims = orphanedClaims;
  const absentIds = plan.verdict === 'frozen' ? [] : plan.retiredObservationIds;
  const movedIds = movedObservationIds.filter((id) => !absentIds.includes(id));
  const restatedIds = restatedObservationIds.filter(
    (id) => !absentIds.includes(id) && !movedIds.includes(id),
  );
  plan.counts.movedClaims = movedIds.length;
  plan.counts.restatedClaims = restatedIds.length;
  plan.counts.claimsUnkeyedForRestatement = claimsUnkeyedForRestatement;
  await retire(movedIds, BBS_TRACK_MOVED_CLAIM_REASON);
  await retire(restatedIds, BBS_TRACK_RESTATED_CLAIM_REASON);
  await retire(absentIds, BBS_TRACK_RETIREMENT_REASON);
  if (!dryRun) {
    await rematerializeClaimRows(claims, [...movedIds, ...restatedIds, ...absentIds], deps);
  }
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
  const verdict = movedIds.length + restatedIds.length > 0 ? 'retired' : plan.verdict;
  return { outcome: 'reconciled', dryRun, verdict, counts: plan.counts };
}

async function planRunResolvedClaims(
  runObjectId: mongoose.Types.ObjectId,
  claims: readonly BbsTrackClaim[],
): Promise<{
  movedObservationIds: string[];
  restatedObservationIds: string[];
  claimsUnkeyedForRestatement: number;
}> {
  const [grafts, snapshots] = await Promise.all([
    Observation.find({
      scrapeRunId: runObjectId,
      entityType: 'researchEntity',
      sourceName: BBS_TRACK_SOURCE_NAME,
      field: 'researchAreas',
    })
      .select('entityId sourceUrl')
      .lean(),
    Observation.find({
      scrapeRunId: runObjectId,
      entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
      field: CENTER_ROSTER_HEALTH_FIELD,
      sourceName: BBS_TRACK_SOURCE_NAME,
    })
      .select('value')
      .lean(),
  ]);
  const rowsResolvedByCitedPi = bbsRowsResolvedByCitedPi({
    grafts: grafts as BbsRunResolutionRow[],
    snapshots: snapshots as BbsRunResolutionRow[],
  });
  const scrapeRunId = String(runObjectId);
  const withinCeiling = (pass: string, ids: string[]): string[] => {
    if (passesCenterRosterAbsenceCeiling(ids.length, claims.length)) return ids;
    console.warn(
      `[bbs-track-retirement] ${pass} pass frozen: ${ids.length} of ${claims.length} claims would retire, above the absence ceiling`,
    );
    return [];
  };
  const restatement = planBbsTrackRestatedClaims({
    claims,
    labelsListedByCitedPi: bbsLabelsListedByCitedPi(snapshots as BbsRunResolutionRow[]),
    rowsResolvedByCitedPi,
    scrapeRunId,
  });
  return {
    movedObservationIds: withinCeiling(
      'moved-claim',
      planBbsTrackMovedClaims({ claims, rowsResolvedByCitedPi, scrapeRunId }),
    ),
    restatedObservationIds: withinCeiling('restated-claim', restatement.restated),
    claimsUnkeyedForRestatement: restatement.unkeyed,
  };
}

async function rematerializeClaimRows(
  claims: readonly BbsTrackClaim[],
  retiredObservationIds: readonly string[],
  deps: BbsTrackRetirementDeps,
): Promise<void> {
  const retired = new Set(retiredObservationIds);
  const retiredClaims = claims.filter((claim) => retired.has(claim.observationId));
  const affectedEntityIds = new Set(retiredClaims.map((claim) => claim.entityKey));
  const affectedStoredKeys = new Set(
    retiredClaims.flatMap((claim) => (claim.storedEntityKey ? [claim.storedEntityKey] : [])),
  );
  for (const entityId of affectedEntityIds) await deps.rematerializeResearchEntity({ entityId });
  for (const entityKey of affectedStoredKeys) {
    await deps.rematerializeResearchEntity({ entityKey });
  }
}
