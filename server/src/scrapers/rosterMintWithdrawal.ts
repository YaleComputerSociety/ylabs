import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { publicSafeStudentVisibilityTiers } from '../models/studentVisibility';
import { archiveResearchEntities } from '../services/archivedResearchEntityRoleEdges';
import { deleteFromIndex } from '../services/meiliSyncService';
import { listResearchEntityMergedInRowsBySurvivor } from '../services/researchEntityCanonicalTombstone';
import { LANE_WITHDRAWABLE_WEBSITE_FIELDS } from './laneRefusedWebsiteUrl';
import { websiteIdentity } from './survivorOwnedWebsiteClear';
import {
  DEPARTMENT_ROSTER_HEALTH_FIELD,
  ROSTER_DISCOVERY_RETENTION_MIN_FRACTION,
  ROSTER_LANE_SOURCE_NAME,
  rosterDiscoveryRegressed,
  rosterHealthReadProvenance,
  type DepartmentRosterHealthSnapshot,
} from './facultyRosterDepartureReconciler';

/**
 * Roster mint withdrawal (#5380): the department roster lane withdraws a row it minted
 * earlier and no longer mints, once the evidence says so twice and nothing else holds
 * the row up.
 *
 * The lane re-reads a listed person every run. When it fetches their own profile and finds
 * nothing to mint, it records the row's key in the department's roster-health snapshot as
 * `withdrawnEntityKeys`. That is the lane saying so, not an inference from silence: an
 * unread or refused profile, a title refusal and a partial read record nothing.
 *
 * The owner decided on 2026-10-19 that such a row is archived, as a narrow exception to
 * archives being operator judgement, on the #4110 precedent of a lane archiving its own
 * mint. The guards are the ones the corpus already uses for withdrawing on absence:
 *
 *   1. Two admitted reads from distinct runs both record the withdrawal, and neither lists
 *      the row as minted.
 *   2. Neither the department's discovery nor its count of profiles read fell below
 *      `ROSTER_DISCOVERY_RETENTION_MIN_FRACTION` of the previous admitted read, because a
 *      profile outage or a broken parse empties every mint at once.
 *   3. No more than `ROSTER_MINT_WITHDRAWAL_MAX_FRACTION` of the live rows the read reached
 *      are withdrawn in one pass; above it the department is frozen, never applied partly.
 *
 * A row is archived only when nothing else holds it up: a served tier, a description, a
 * website this lane did not assert itself, a lead edge from another lane, a live observation from another lane, or a row
 * merged into it each keep it. Archiving is the lane's own decision, so the lane reverses
 * it: a row archived for this reason is restored when an admitted read mints it again.
 */

export const ROSTER_MINT_WITHDRAWAL_ARCHIVE_REASON =
  'dept-faculty-roster:mint-withdrawn: two complete reads found nothing on the profile to mint this row (#5380)';
export const ROSTER_MINT_WITHDRAWAL_MIN_READS = 2;
export const ROSTER_MINT_WITHDRAWAL_MAX_FRACTION = 0.5;

/** Bookkeeping a lane writes about having read a page, which says nothing about the row. */
const NON_EVIDENCE_FIELDS: ReadonlySet<string> = new Set(['lanePageHealth', 'sourceContentHash']);
/** Sources that restate another observation rather than reading a page of their own. */
const DERIVATION_SOURCES: ReadonlySet<string> = new Set(['lead-pi-school-inheritance']);

export interface RosterMintWithdrawalRead {
  runId: string;
  deptKey: string;
  observedAt: Date;
  discovered: ReadonlySet<string>;
  withdrawn: ReadonlySet<string>;
  profilesRead: number;
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];

/**
 * A snapshot is a read for withdrawal only when it recorded withdrawals, read its page
 * over the wire this run, and reported itself complete. A cache-permitted read is refused,
 * because its profile pages may be a day old and a withdrawal is an archive.
 */
export function rosterMintWithdrawalReadFromSnapshot(row: {
  scrapeRunId?: unknown;
  observedAt?: unknown;
  entityKey?: unknown;
  value?: unknown;
}): RosterMintWithdrawalRead | null {
  const snapshot = (row.value ?? {}) as DepartmentRosterHealthSnapshot & {
    mintWithdrawalRecorded?: unknown;
    withdrawnEntityKeys?: unknown;
    profilesRead?: unknown;
  };
  if (snapshot.mintWithdrawalRecorded !== true || snapshot.complete !== true) return null;
  if (!Array.isArray(snapshot.withdrawnEntityKeys)) return null;
  const provenance = rosterHealthReadProvenance(snapshot);
  if (provenance !== 'fetched' && provenance !== 'reused-within-sweep') return null;
  const deptKey = typeof row.entityKey === 'string' ? row.entityKey : '';
  const runId = row.scrapeRunId ? String(row.scrapeRunId) : '';
  const observedAt =
    row.observedAt instanceof Date ? row.observedAt : new Date(String(row.observedAt));
  if (!deptKey || !runId || !Number.isFinite(observedAt.getTime())) return null;
  return {
    runId,
    deptKey,
    observedAt,
    discovered: new Set(stringArray(snapshot.discoveredEntityKeys)),
    withdrawn: new Set(stringArray(snapshot.withdrawnEntityKeys)),
    profilesRead: typeof snapshot.profilesRead === 'number' ? snapshot.profilesRead : 0,
  };
}

export type RosterMintWithdrawalDeptVerdict =
  | 'withdraws'
  | 'nothing-to-withdraw'
  | 'awaiting-second-read'
  | 'yield-regressed'
  | 'withdrawal-above-ceiling';

export interface RosterMintWithdrawalDeptPlan {
  deptKey: string;
  verdict: RosterMintWithdrawalDeptVerdict;
  withdrawnSlugs: string[];
  awaitingSecondRead: number;
  governedRows: number;
}

/**
 * Which live lane-owned rows one department's reads now withdraw.
 *
 * `reads` are that department's admitted reads, any order; only the newest read of each of
 * the two newest runs is weighed, and the newest must be the run being reconciled so a
 * department this run did not read is never judged on old evidence.
 */
export function planRosterMintWithdrawalForDept(input: {
  deptKey: string;
  currentRunId: string;
  reads: readonly RosterMintWithdrawalRead[];
  liveLaneRowSlugs: ReadonlySet<string>;
}): RosterMintWithdrawalDeptPlan {
  const newestByRun = new Map<string, RosterMintWithdrawalRead>();
  for (const read of input.reads) {
    const previous = newestByRun.get(read.runId);
    if (!previous || read.observedAt > previous.observedAt) newestByRun.set(read.runId, read);
  }
  const [latest, previous] = [...newestByRun.values()].sort(
    (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
  );
  const plan = (
    verdict: RosterMintWithdrawalDeptVerdict,
    extra: Partial<RosterMintWithdrawalDeptPlan> = {},
  ): RosterMintWithdrawalDeptPlan => ({
    deptKey: input.deptKey,
    verdict,
    withdrawnSlugs: [],
    awaitingSecondRead: 0,
    governedRows: 0,
    ...extra,
  });
  if (!latest || latest.runId !== input.currentRunId) return plan('nothing-to-withdraw');

  const live = (keys: ReadonlySet<string>) =>
    [...keys].filter((key) => input.liveLaneRowSlugs.has(key));
  const governedRows = new Set([...live(latest.discovered), ...live(latest.withdrawn)]).size;
  const latestWithdrawnLive = live(latest.withdrawn);
  if (latestWithdrawnLive.length === 0) return plan('nothing-to-withdraw', { governedRows });
  if (!previous) {
    return plan('awaiting-second-read', {
      governedRows,
      awaitingSecondRead: latestWithdrawnLive.length,
    });
  }
  if (
    rosterDiscoveryRegressed(
      previous.discovered.size,
      latest.discovered.size,
      ROSTER_DISCOVERY_RETENTION_MIN_FRACTION,
    ) ||
    rosterDiscoveryRegressed(
      previous.profilesRead,
      latest.profilesRead,
      ROSTER_DISCOVERY_RETENTION_MIN_FRACTION,
    )
  ) {
    return plan('yield-regressed', { governedRows });
  }
  const withdrawnSlugs = latestWithdrawnLive
    .filter((slug) => previous.withdrawn.has(slug) && !previous.discovered.has(slug))
    .sort();
  const awaitingSecondRead = latestWithdrawnLive.length - withdrawnSlugs.length;
  if (withdrawnSlugs.length === 0) {
    return plan('awaiting-second-read', { governedRows, awaitingSecondRead });
  }
  if (withdrawnSlugs.length > ROSTER_MINT_WITHDRAWAL_MAX_FRACTION * governedRows) {
    return plan('withdrawal-above-ceiling', { governedRows, awaitingSecondRead });
  }
  return plan('withdraws', { governedRows, awaitingSecondRead, withdrawnSlugs });
}

export type RosterMintWithdrawalKeepReason =
  | 'served'
  | 'has_description'
  | 'has_website'
  | 'lead_edge_from_another_lane'
  | 'observation_from_another_lane'
  | 'has_merged_in_rows';

export interface RosterMintWithdrawalRowEvidence {
  studentVisibilityTier?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  foreignLeadEdges: number;
  foreignEvidenceObservations: number;
  mergedInRows: number;
}

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

/** The first reason another lane's evidence keeps this row, or null when nothing does. */
export function rosterMintWithdrawalKeepReason(
  row: RosterMintWithdrawalRowEvidence,
): RosterMintWithdrawalKeepReason | null {
  if (
    typeof row.studentVisibilityTier === 'string' &&
    (publicSafeStudentVisibilityTiers as readonly string[]).includes(row.studentVisibilityTier)
  ) {
    return 'served';
  }
  if (hasText(row.fullDescription) || hasText(row.shortDescription)) return 'has_description';
  if (hasText(row.websiteUrl) || hasText(row.website)) return 'has_website';
  if (row.foreignLeadEdges > 0) return 'lead_edge_from_another_lane';
  if (row.foreignEvidenceObservations > 0) return 'observation_from_another_lane';
  if (row.mergedInRows > 0) return 'has_merged_in_rows';
  return null;
}

const isEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
};

/** Whether a live observation from another source is evidence that holds the row up. */
export function isForeignWithdrawalBlockingObservation(observation: {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
}): boolean {
  const sourceName = typeof observation.sourceName === 'string' ? observation.sourceName : '';
  if (!sourceName || sourceName === ROSTER_LANE_SOURCE_NAME) return false;
  if (DERIVATION_SOURCES.has(sourceName)) return false;
  if (typeof observation.field === 'string' && NON_EVIDENCE_FIELDS.has(observation.field))
    return false;
  return !isEmptyValue(observation.value);
}

export interface RosterMintWithdrawalRowPlan {
  entityId: string;
  slug: string;
  deptKey: string;
  tier: string;
  action: 'archive' | 'keep';
  keepReason?: RosterMintWithdrawalKeepReason;
}

export interface RosterMintWithdrawalResult {
  outcome: 'no-roster-health-observations' | 'invalid-run-id' | 'planned' | 'reconciled';
  departments: RosterMintWithdrawalDeptPlan[];
  rows: RosterMintWithdrawalRowPlan[];
  counts: {
    departmentsByVerdict: Partial<Record<RosterMintWithdrawalDeptVerdict, number>>;
    withdrawnRows: number;
    archived: number;
    keptByReason: Partial<Record<RosterMintWithdrawalKeepReason, number>>;
    awaitingSecondRead: number;
    restored: number;
    indexDeleteFailures: number;
  };
}

async function loadAdmittedReads(deptKeys: readonly string[]): Promise<RosterMintWithdrawalRead[]> {
  const rows = (await Observation.find({
    entityType: 'departmentRosterHealth',
    field: DEPARTMENT_ROSTER_HEALTH_FIELD,
    entityKey: { $in: [...deptKeys] },
    'value.mintWithdrawalRecorded': true,
  })
    .select('entityKey value scrapeRunId observedAt')
    .lean()) as Array<Record<string, unknown>>;
  return rows
    .map((row) => rosterMintWithdrawalReadFromSnapshot(row))
    .filter((read): read is RosterMintWithdrawalRead => read !== null);
}

/** The live rows whose slug this lane still asserts, among the given keys. */
async function loadLiveLaneRowSlugs(slugs: readonly string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const owned = (await Observation.distinct('entityKey', {
    sourceName: ROSTER_LANE_SOURCE_NAME,
    entityType: 'researchEntity',
    field: 'slug',
    entityKey: { $in: [...slugs] },
    superseded: false,
  })) as unknown[];
  const ownedSlugs = owned.filter((key): key is string => typeof key === 'string');
  const live = (await ResearchEntity.find(
    { slug: { $in: ownedSlugs }, archived: { $ne: true } },
    { slug: 1 },
  ).lean()) as Array<{ slug?: unknown }>;
  return new Set(live.map((row) => String(row.slug)));
}

async function loadRowEvidence(
  slugs: readonly string[],
): Promise<
  Array<{ entityId: string; slug: string; tier: string; evidence: RosterMintWithdrawalRowEvidence }>
> {
  if (slugs.length === 0) return [];
  const rows = (await ResearchEntity.find(
    { slug: { $in: [...slugs] }, archived: { $ne: true } },
    {
      _id: 1,
      slug: 1,
      studentVisibilityTier: 1,
      fullDescription: 1,
      shortDescription: 1,
      websiteUrl: 1,
      website: 1,
    },
  ).lean()) as Array<Record<string, any>>;
  const ids = rows.map((row) => row._id as mongoose.Types.ObjectId);
  const mergedIn = await listResearchEntityMergedInRowsBySurvivor(ids);
  const edges = (await RoleAssignment.find(
    { 'target.id': { $in: ids }, state: { $ne: 'HISTORICAL' }, archived: { $ne: true } },
    { 'target.id': 1, rosterProvenance: 1 },
  ).lean()) as Array<{ target?: { id?: unknown }; rosterProvenance?: { sourceName?: unknown } }>;
  const foreignEdgesById = new Map<string, number>();
  for (const edge of edges) {
    if (edge.rosterProvenance?.sourceName === ROSTER_LANE_SOURCE_NAME) continue;
    const id = String(edge.target?.id);
    foreignEdgesById.set(id, (foreignEdgesById.get(id) ?? 0) + 1);
  }
  const observations = (await Observation.find(
    {
      $or: [
        { entityId: { $in: ids } },
        { entityType: 'researchEntity', entityKey: { $in: [...slugs] } },
      ],
      superseded: false,
      sourceName: { $ne: ROSTER_LANE_SOURCE_NAME },
    },
    { entityId: 1, entityKey: 1, sourceName: 1, field: 1, value: 1 },
  ).lean()) as Array<Record<string, unknown>>;
  const idBySlug = new Map(rows.map((row) => [String(row.slug), String(row._id)]));
  const laneWebsiteObservations = (await Observation.find(
    {
      $or: [
        { entityId: { $in: ids } },
        { entityType: 'researchEntity', entityKey: { $in: [...slugs] } },
      ],
      superseded: false,
      sourceName: ROSTER_LANE_SOURCE_NAME,
      field: { $in: [...LANE_WITHDRAWABLE_WEBSITE_FIELDS] },
    },
    { entityId: 1, entityKey: 1, value: 1 },
  ).lean()) as Array<Record<string, unknown>>;
  const laneWebsitesById = new Map<string, Set<string>>();
  for (const observation of laneWebsiteObservations) {
    const id = observation.entityId
      ? String(observation.entityId)
      : idBySlug.get(String(observation.entityKey));
    if (!id) continue;
    const websites = laneWebsitesById.get(id) ?? new Set<string>();
    websites.add(websiteIdentity(observation.value));
    laneWebsitesById.set(id, websites);
  }
  const foreignObservationsById = new Map<string, number>();
  for (const observation of observations) {
    if (!isForeignWithdrawalBlockingObservation(observation)) continue;
    const id = observation.entityId
      ? String(observation.entityId)
      : idBySlug.get(String(observation.entityKey));
    if (!id) continue;
    foreignObservationsById.set(id, (foreignObservationsById.get(id) ?? 0) + 1);
  }
  return rows.map((row) => {
    const id = String(row._id);
    const laneWebsites = laneWebsitesById.get(id);
    const websiteNotFromThisLane = (value: unknown) =>
      laneWebsites?.has(websiteIdentity(value)) ? undefined : value;
    return {
      entityId: id,
      slug: String(row.slug),
      tier: typeof row.studentVisibilityTier === 'string' ? row.studentVisibilityTier : '',
      evidence: {
        studentVisibilityTier: row.studentVisibilityTier,
        fullDescription: row.fullDescription,
        shortDescription: row.shortDescription,
        websiteUrl: websiteNotFromThisLane(row.websiteUrl),
        website: websiteNotFromThisLane(row.website),
        foreignLeadEdges: foreignEdgesById.get(id) ?? 0,
        foreignEvidenceObservations: foreignObservationsById.get(id) ?? 0,
        mergedInRows: mergedIn.get(id)?.length ?? 0,
      },
    };
  });
}

/** The keys this run's admitted reads listed and the lane actually minted, not title-refused. */
async function loadSlugsMintedInRun(
  scrapeRunId: string,
  currentReads: readonly RosterMintWithdrawalRead[],
): Promise<Set<string>> {
  const listed = new Set<string>();
  for (const read of currentReads) for (const key of read.discovered) listed.add(key);
  if (listed.size === 0) return new Set();
  const minted = (await Observation.distinct('entityKey', {
    scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
    sourceName: ROSTER_LANE_SOURCE_NAME,
    entityType: 'researchEntity',
    entityKey: { $in: [...listed] },
  })) as unknown[];
  return new Set(minted.filter((key): key is string => typeof key === 'string'));
}

export interface RosterMintWithdrawalDeps {
  rematerializeResearchEntity?: (entityKey: string) => Promise<void>;
}

/**
 * Plan, and unless `dryRun`, apply the withdrawals the run's roster reads now support.
 * A plan runs the whole decision path and writes nothing.
 */
export async function reconcileRosterMintWithdrawalsFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
  deps: RosterMintWithdrawalDeps = {},
): Promise<RosterMintWithdrawalResult> {
  const result: RosterMintWithdrawalResult = {
    outcome: options.dryRun ? 'planned' : 'reconciled',
    departments: [],
    rows: [],
    counts: {
      departmentsByVerdict: {},
      withdrawnRows: 0,
      archived: 0,
      keptByReason: {},
      awaitingSecondRead: 0,
      restored: 0,
      indexDeleteFailures: 0,
    },
  };
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId))
    return { ...result, outcome: 'invalid-run-id' };
  const runDeptKeys = (await Observation.distinct('entityKey', {
    scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
    entityType: 'departmentRosterHealth',
    field: DEPARTMENT_ROSTER_HEALTH_FIELD,
    'value.mintWithdrawalRecorded': true,
  })) as unknown[];
  const deptKeys = runDeptKeys.filter((key): key is string => typeof key === 'string');
  if (deptKeys.length === 0) return { ...result, outcome: 'no-roster-health-observations' };

  const reads = await loadAdmittedReads(deptKeys);
  const readsByDept = new Map<string, RosterMintWithdrawalRead[]>();
  for (const read of reads) {
    const list = readsByDept.get(read.deptKey) ?? [];
    list.push(read);
    readsByDept.set(read.deptKey, list);
  }
  const currentReads = reads.filter((read) => read.runId === scrapeRunId);
  const consideredSlugs = new Set<string>();
  for (const read of currentReads) {
    for (const key of read.discovered) consideredSlugs.add(key);
    for (const key of read.withdrawn) consideredSlugs.add(key);
  }
  const liveLaneRowSlugs = await loadLiveLaneRowSlugs([...consideredSlugs]);

  const withdrawnSlugToDept = new Map<string, string>();
  for (const deptKey of [...deptKeys].sort()) {
    const deptPlan = planRosterMintWithdrawalForDept({
      deptKey,
      currentRunId: scrapeRunId,
      reads: readsByDept.get(deptKey) ?? [],
      liveLaneRowSlugs,
    });
    result.departments.push(deptPlan);
    result.counts.departmentsByVerdict[deptPlan.verdict] =
      (result.counts.departmentsByVerdict[deptPlan.verdict] ?? 0) + 1;
    result.counts.awaitingSecondRead += deptPlan.awaitingSecondRead;
    for (const slug of deptPlan.withdrawnSlugs) withdrawnSlugToDept.set(slug, deptKey);
  }

  const rowEvidence = await loadRowEvidence([...withdrawnSlugToDept.keys()]);
  const archiveIds: string[] = [];
  for (const row of rowEvidence.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const keepReason = rosterMintWithdrawalKeepReason(row.evidence);
    result.rows.push({
      entityId: row.entityId,
      slug: row.slug,
      deptKey: withdrawnSlugToDept.get(row.slug) ?? '',
      tier: row.tier,
      action: keepReason ? 'keep' : 'archive',
      ...(keepReason ? { keepReason } : {}),
    });
    if (keepReason) {
      result.counts.keptByReason[keepReason] = (result.counts.keptByReason[keepReason] ?? 0) + 1;
    } else {
      archiveIds.push(row.entityId);
    }
  }
  result.counts.withdrawnRows = rowEvidence.length;

  const remintedSlugs = await loadSlugsMintedInRun(scrapeRunId, currentReads);
  const restorable = remintedSlugs.size
    ? ((await ResearchEntity.find(
        {
          slug: { $in: [...remintedSlugs] },
          archived: true,
          archivedReason: ROSTER_MINT_WITHDRAWAL_ARCHIVE_REASON,
        },
        { _id: 1, slug: 1 },
      ).lean()) as Array<{ _id: unknown; slug?: unknown }>)
    : [];

  if (options.dryRun) {
    result.counts.archived = archiveIds.length;
    result.counts.restored = restorable.length;
    return result;
  }

  if (archiveIds.length > 0) {
    const archived = await archiveResearchEntities({
      ids: archiveIds,
      archivedReason: ROSTER_MINT_WITHDRAWAL_ARCHIVE_REASON,
    });
    result.counts.archived = archived.archived;
    for (const id of archiveIds) {
      try {
        await deleteFromIndex('researchEntity', id);
      } catch {
        result.counts.indexDeleteFailures += 1;
      }
    }
  }
  for (const row of restorable) {
    const restored = await ResearchEntity.updateOne(
      { _id: row._id, archived: true, archivedReason: ROSTER_MINT_WITHDRAWAL_ARCHIVE_REASON },
      { $set: { archived: false }, $unset: { archivedReason: '', archivedAt: '' } },
    );
    if ((restored as { modifiedCount?: number }).modifiedCount) {
      result.counts.restored += 1;
      if (deps.rematerializeResearchEntity)
        await deps.rematerializeResearchEntity(String(row.slug));
    }
  }
  return result;
}
