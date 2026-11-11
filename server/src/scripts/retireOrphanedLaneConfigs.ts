/**
 * observations:retire-orphaned-lane-configs - retires the live observations of a lane config
 * that exists on no git ref (#5807), by superseding them with a rollback reason. It never
 * deletes, so a retired observation stays readable and the retirement is auditable.
 *
 * A dry run by default. It judges every named config against the code's current config set and
 * against the tip of every ref in each scanned repository, attributes observations to the
 * orphaned ones, and projects each affected row through the engine with and without them, so
 * the report is a per-row diff of served fields. An apply refuses unless every named config is
 * orphaned, and a second apply retires nothing.
 *
 *   yarn --cwd server observations:retire-orphaned-lane-configs \
 *     --configs=dept-faculty-roster:<id>,yale-research-official:<id> --output=<tmp>.json
 *   DEV_WRITE_OWNER=<session> yarn --cwd server observations:retire-orphaned-lane-configs \
 *     --configs=<same list> --apply --confirm-retire-orphaned-lane-configs --output=<tmp>.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Observation, type ObservedEntityType } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { materializationReadScopeFilter, materializeEntity } from '../scrapers/entityMaterializer';
import {
  MaterializationChunkPrefetch,
  type MaterializationReadSource,
} from '../scrapers/materializationChunkPrefetch';
import { retireObservations } from '../scrapers/observationStore';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  currentGitCommonDir,
  codeShasReachableFromRefs,
  defaultGitRunner,
  readRefTips,
  scanRefTipsForLaneConfigs,
  type GitRunner,
} from './laneConfigRefScan';
import { orphanedLaneConfigRegistry } from './orphanedLaneConfigRegistry';
import {
  fieldsCreditedToRetired,
  laneConfigLabel,
  parseRequestedLaneConfigs,
  planOrphanedLaneConfigRetirement,
  runOnlySelection,
  servedFieldChanges,
  type LaneConfigRefPresence,
  type OrphanLaneDefinition,
  type OrphanedLaneConfigPlan,
  type RequestedLaneConfig,
  type ServedFieldChange,
  type StoredLaneObservation,
  type StoredLaneRun,
} from './retireOrphanedLaneConfigsCore';
import { REMATERIALIZE_TRACKED_FIELDS } from './rematerializeResearchEntitiesCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'observations:retire-orphaned-lane-configs';
export const CONFIRM_FLAG = '--confirm-retire-orphaned-lane-configs';
export const ORPHANED_LANE_CONFIG_ROLLBACK_REASON =
  'written by a lane config that exists on no git ref, so no run of current code re-reads its pages (#5807)';
const SERVED_TIER = 'student_ready';

export interface RetireOrphanedLaneConfigsOptions {
  apply: boolean;
  confirmed: boolean;
  configs: RequestedLaneConfig[];
  gitDirs: string[];
  output?: string;
}

export function parseRetireOrphanedLaneConfigsArgs(
  argv: string[],
): RetireOrphanedLaneConfigsOptions {
  const options: RetireOrphanedLaneConfigsOptions = {
    apply: false,
    confirmed: false,
    configs: [],
    gitDirs: [],
  };
  const valueOf = (arg: string, flag: string, index: number): [string, number] =>
    arg === flag ? [argv[index + 1] ?? '', index + 1] : [arg.slice(flag.length + 1), index];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--configs' || arg.startsWith('--configs=')) {
      const [value, next] = valueOf(arg, '--configs', i);
      options.configs.push(...parseRequestedLaneConfigs(value));
      i = next;
    } else if (arg === '--git-dir' || arg.startsWith('--git-dir=')) {
      const [value, next] = valueOf(arg, '--git-dir', i);
      if (!value.trim()) throw new Error('--git-dir needs a path');
      options.gitDirs.push(path.resolve(value.trim()));
      i = next;
    } else if (arg === '--output' || arg.startsWith('--output=')) {
      const [value, next] = valueOf(arg, '--output', i);
      options.output = resolveSafeJsonReportOutputPath(value, '--output');
      i = next;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (options.configs.length === 0) {
    throw new Error(`${SCRIPT_NAME} requires --configs, so a run names exactly what it judges`);
  }
  return options;
}

export function scanLaneConfigRefs(input: {
  configs: readonly RequestedLaneConfig[];
  gitDirs: readonly string[];
  git?: GitRunner;
}): {
  presence: LaneConfigRefPresence[];
  scanned: Array<{ gitDir: string; refs: number; tipCommits: number }>;
} {
  if (input.gitDirs.length === 0) throw new Error('no git repository to scan for lane configs');
  const presence: LaneConfigRefPresence[] = [];
  const scanned: Array<{ gitDir: string; refs: number; tipCommits: number }> = [];
  for (const gitDir of input.gitDirs) {
    const tips = readRefTips(gitDir, input.git ?? defaultGitRunner);
    scanned.push({ gitDir, refs: tips.refCount, tipCommits: tips.refsByCommit.size });
    presence.push(...scanRefTipsForLaneConfigs(tips, input.configs, input.git ?? defaultGitRunner));
  }
  return { presence, scanned };
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function loadCandidateLaneEvidence(input: {
  configs: readonly RequestedLaneConfig[];
  lanes: readonly OrphanLaneDefinition[];
}): Promise<{ observations: StoredLaneObservation[]; runs: StoredLaneRun[] }> {
  const sourceNames = [...new Set(input.configs.map((config) => config.sourceName))];
  const sources = (await Source.find({ name: { $in: sourceNames } })
    .select('_id name')
    .lean()) as Array<{ _id: mongoose.Types.ObjectId; name: string }>;
  const runs = (
    (await ScrapeRun.find({ sourceId: { $in: sources.map((source) => source._id) } })
      .select('_id codeSha options')
      .lean()) as Array<{ _id: unknown; codeSha?: unknown; options?: unknown }>
  ).map((run) => ({
    id: serializedDocumentId(run._id) ?? '',
    codeSha: typeof run.codeSha === 'string' && run.codeSha.trim() ? run.codeSha : undefined,
    only: runOnlySelection(run.options),
  }));
  const requestedIds = new Set(input.configs.map((config) => config.configId));
  const candidateRunIds = runs
    .filter((run) => run.only.length > 0 && run.only.every((id) => requestedIds.has(id)))
    .map((run) => new mongoose.Types.ObjectId(run.id));

  const observations: StoredLaneObservation[] = [];
  for (const sourceName of sourceNames) {
    const lane = input.lanes.find((candidate) => candidate.sourceName === sourceName);
    const namespaces = lane?.keyNamespaceOf
      ? input.configs
          .filter((config) => config.sourceName === sourceName)
          .map((config) => lane.keyNamespaceOf!(config.configId))
      : [];
    const keyClauses = namespaces.flatMap((namespace) => [
      { entityKey: { $regex: `^dept-${escapeRegex(namespace)}-` } },
      { entityKey: { $regex: `^dept:${escapeRegex(namespace)}:` } },
    ]);
    const clauses = [
      ...keyClauses,
      ...(candidateRunIds.length > 0 ? [{ scrapeRunId: { $in: candidateRunIds } }] : []),
    ];
    if (clauses.length === 0) continue;
    const rows = (await Observation.find({
      sourceName,
      ...materializationReadScopeFilter(),
      $or: clauses,
    })
      .select('_id sourceName entityType entityKey entityId field scrapeRunId')
      .lean()) as Array<Record<string, unknown>>;
    for (const row of rows) {
      observations.push({
        id: serializedDocumentId(row._id) ?? '',
        sourceName: String(row.sourceName),
        entityType: String(row.entityType),
        entityKey: typeof row.entityKey === 'string' ? row.entityKey : undefined,
        entityId: serializedDocumentId(row.entityId) ?? undefined,
        field: String(row.field),
        scrapeRunId: serializedDocumentId(row.scrapeRunId) ?? undefined,
      });
    }
  }
  return { observations, runs };
}

export interface MissedObservationRead {
  entityType: string;
  entityKey?: string;
  entityId?: string;
}

class MissRecordingReadSource implements MaterializationReadSource {
  readonly misses: MissedObservationRead[] = [];

  constructor(private readonly inner: MaterializationReadSource) {}

  get entityType() {
    return this.inner.entityType;
  }

  markTouched(...identifiers: unknown[]) {
    this.inner.markTouched(...identifiers);
  }

  markCreated() {
    this.inner.markCreated();
  }

  observationsForKey(entityType: string, entityKey: string) {
    const lookup = this.inner.observationsForKey(entityType, entityKey);
    if (!lookup.hit) this.misses.push({ entityType, entityKey });
    return lookup;
  }

  observationsForId(entityType: string, entityId: unknown) {
    const lookup = this.inner.observationsForId(entityType, entityId);
    if (!lookup.hit) this.misses.push({ entityType, entityId: String(entityId) });
    return lookup;
  }

  entityDocForId(entityType: string, entityId: unknown) {
    return this.inner.entityDocForId(entityType, entityId);
  }

  entityDocForKey(entityType: string, keyValue: string) {
    return this.inner.entityDocForKey(entityType, keyValue);
  }

  liveEntityDocForKey(entityType: string, keyValue: string) {
    return this.inner.liveEntityDocForKey(entityType, keyValue);
  }

  liveEntityDocForId(entityType: string, entityId: unknown) {
    return this.inner.liveEntityDocForId(entityType, entityId);
  }

  hasNoMergedInRows(survivorId: unknown) {
    return this.inner.hasNoMergedInRows(survivorId);
  }

  soleLeadPersonId(entityId: unknown) {
    return this.inner.soleLeadPersonId(entityId);
  }

  pageStatedNamePeers(names: readonly string[]) {
    return this.inner.pageStatedNamePeers(names);
  }
}

interface ProjectedPlan {
  set: Record<string, unknown>;
  unset: Record<string, unknown>;
  skipped?: string;
  retiredEvidenceReadLive: number;
  ownLiveObservations: number;
}

export const retiredIdentityKey = (entityType: string, identifier: string) =>
  `${entityType}|${identifier}`;

const MAX_PREFETCH_ROUNDS = 4;

/**
 * Projects one row through the engine in a dry run, with the excluded observations removed from
 * every observation read the read source answers. A read the source cannot answer falls back to
 * a live read that still sees them, so rows the materializer reaches that way are added to the
 * prefetch and the projection is re-run; a miss that remains on an identity holding retired
 * evidence is counted, so a projection that could not isolate the retirement says so.
 */
export async function projectRow(
  entityType: ObservedEntityType,
  entityKey: string,
  excludedIds: readonly mongoose.Types.ObjectId[],
  retiredIdentities: ReadonlySet<string> = new Set(),
  writeOnlyFields: readonly string[] = [],
): Promise<ProjectedPlan> {
  const readScopeFilter = {
    ...materializationReadScopeFilter(),
    ...(excludedIds.length > 0 ? { _id: { $nin: excludedIds } } : {}),
  };
  const doc =
    entityType === 'researchEntity'
      ? ((await ResearchEntity.findOne({ slug: entityKey }).select('_id').lean()) as {
          _id?: mongoose.Types.ObjectId;
        } | null)
      : null;
  const ownLiveObservations = await Observation.countDocuments({
    entityType,
    ...readScopeFilter,
    $or: [{ entityKey }, ...(doc?._id ? [{ entityId: doc._id }] : [])],
  });
  const extraKeys = new Set<string>();
  const extraIds = new Set<string>();
  let result: {
    plannedSet?: Record<string, unknown>;
    plannedUnset?: Record<string, unknown>;
    skipped?: string;
  } = {};
  let misses: MissedObservationRead[] = [];
  for (let round = 0; round < MAX_PREFETCH_ROUNDS; round += 1) {
    const prefetch = new MissRecordingReadSource(
      await MaterializationChunkPrefetch.load({
        entityType,
        rows: [
          { entityType, entityKey },
          ...[...extraKeys].map((key) => ({ entityType, entityKey: key })),
          ...[...extraIds].map((id) => ({ entityType, entityId: id })),
        ],
        readScopeFilter,
        ...(entityType === 'researchEntity'
          ? { entityDocs: { model: ResearchEntity, keyField: 'slug' } }
          : {}),
      }),
    );
    result = (await materializeEntity(
      entityType,
      { entityKey },
      {
        dryRun: true,
        chunkPrefetch: prefetch,
        synthesizeCardDescription: async () => '',
        ...(writeOnlyFields.length > 0 ? { writeOnlyFields: [...writeOnlyFields] } : {}),
      },
    )) as typeof result;
    misses = prefetch.misses;
    let added = 0;
    for (const miss of misses) {
      if (miss.entityType !== entityType) continue;
      if (miss.entityKey && !extraKeys.has(miss.entityKey)) {
        extraKeys.add(miss.entityKey);
        added += 1;
      }
      if (miss.entityId && !extraIds.has(miss.entityId)) {
        extraIds.add(miss.entityId);
        added += 1;
      }
    }
    if (added === 0) break;
  }
  const retiredEvidenceReadLive = misses.filter((miss) =>
    retiredIdentities.has(
      retiredIdentityKey(miss.entityType, miss.entityKey ?? miss.entityId ?? ''),
    ),
  ).length;
  return {
    set: result.plannedSet ?? {},
    unset: result.plannedUnset ?? {},
    ...(result.skipped ? { skipped: result.skipped } : {}),
    retiredEvidenceReadLive,
    ownLiveObservations,
  };
}

export interface ServedRowDiff {
  entityKey: string;
  studentVisibilityTier: string | null;
  served: boolean;
  retiredObservationsOnRow: number;
  creditedFields: string[];
  changes: Array<ServedFieldChange & { servedBefore: unknown }>;
  skippedWithoutOrphans?: string;
  retiredEvidenceReadLive: number;
  liveObservationsBefore: number;
  liveObservationsAfter: number;
}

const MAX_SURVIVOR_HOPS = 8;

async function affectedLiveResearchRows(
  plan: OrphanedLaneConfigPlan,
): Promise<Map<string, { doc: Record<string, unknown>; retiredOnRow: number }>> {
  const researchObservations = plan.attributed.filter(
    (entry) =>
      entry.observation.entityType === 'researchEntity' ||
      entry.observation.entityType === 'researchGroup',
  );
  const keys = [
    ...new Set(
      researchObservations.flatMap((e) =>
        e.observation.entityKey ? [e.observation.entityKey] : [],
      ),
    ),
  ];
  const ids = [
    ...new Set(
      researchObservations.flatMap((e) => (e.observation.entityId ? [e.observation.entityId] : [])),
    ),
  ];
  const docs = (await ResearchEntity.find({
    $or: [
      { slug: { $in: keys } },
      { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
    ],
  }).lean()) as Array<Record<string, unknown>>;
  const live = new Map<string, { doc: Record<string, unknown>; retiredOnRow: number }>();
  const retiredByKey = new Map<string, number>();
  for (const entry of researchObservations) {
    const key = entry.observation.entityKey ?? entry.observation.entityId ?? '';
    retiredByKey.set(key, (retiredByKey.get(key) ?? 0) + 1);
  }
  for (const doc of docs) {
    let current: Record<string, unknown> | null = doc;
    for (let hop = 0; current && current.archived === true && hop < MAX_SURVIVOR_HOPS; hop += 1) {
      const next: unknown = current.canonicalGroupId;
      current = next
        ? ((await ResearchEntity.findById(next).lean()) as Record<string, unknown> | null)
        : null;
    }
    if (!current || current.archived === true || typeof current.slug !== 'string') continue;
    const retiredHere =
      (retiredByKey.get(String(doc.slug)) ?? 0) +
      (retiredByKey.get(serializedDocumentId(doc._id) ?? '') ?? 0);
    const existing = live.get(current.slug);
    live.set(current.slug, {
      doc: current,
      retiredOnRow: (existing?.retiredOnRow ?? 0) + retiredHere,
    });
  }
  return live;
}

const IDENTITY_FIELDS = new Set(['slug']);

export function projectionOnlyFields(plan: OrphanedLaneConfigPlan): Record<string, string[]> {
  const fields: Record<string, Set<string>> = {};
  for (const { observation } of plan.attributed) {
    const entityType =
      observation.entityType === 'researchGroup' ? 'researchEntity' : observation.entityType;
    if (IDENTITY_FIELDS.has(observation.field)) continue;
    (fields[entityType] ??= new Set()).add(observation.field);
  }
  return Object.fromEntries(
    Object.entries(fields).map(([entityType, set]) => [entityType, [...set].sort()]),
  );
}

async function retiredEvidenceIdentities(plan: OrphanedLaneConfigPlan): Promise<Set<string>> {
  const identities = new Set<string>();
  const researchKeys = new Set<string>();
  for (const { observation } of plan.attributed) {
    if (observation.entityKey) {
      identities.add(retiredIdentityKey(observation.entityType, observation.entityKey));
      if (observation.entityType === 'researchEntity') researchKeys.add(observation.entityKey);
    }
    if (observation.entityId) {
      identities.add(retiredIdentityKey(observation.entityType, observation.entityId));
    }
  }
  const rows = (await ResearchEntity.find({ slug: { $in: [...researchKeys] } })
    .select('_id')
    .lean()) as Array<{ _id: unknown }>;
  for (const row of rows) {
    identities.add(retiredIdentityKey('researchEntity', serializedDocumentId(row._id) ?? ''));
  }
  return identities;
}

export interface PersonKeyDiff {
  entityKey: string;
  changedPaths: string[];
  skippedWithoutOrphans?: string;
  retiredEvidenceReadLive: number;
}

async function projectPersonKeys(
  plan: OrphanedLaneConfigPlan,
  excludedIds: readonly mongoose.Types.ObjectId[],
  retiredIdentities: ReadonlySet<string>,
  onlyFields: readonly string[],
  log?: (message: string) => void,
): Promise<PersonKeyDiff[]> {
  const keys = [
    ...new Set(
      plan.attributed
        .filter((entry) => entry.observation.entityType === 'user' && entry.observation.entityKey)
        .map((entry) => entry.observation.entityKey as string),
    ),
  ].sort();
  const diffs: PersonKeyDiff[] = [];
  for (const entityKey of keys) {
    log?.(`projecting person key ${diffs.length + 1} of ${keys.length}`);
    const withOrphans = await projectRow('user', entityKey, [], retiredIdentities, onlyFields);
    const withoutOrphans = await projectRow(
      'user',
      entityKey,
      excludedIds,
      retiredIdentities,
      onlyFields,
    );
    const changes = servedFieldChanges({
      stored: {},
      withOrphans,
      withoutOrphans,
      creditedFields: new Set(),
    });
    diffs.push({
      entityKey,
      changedPaths: changes.map((change) => change.field),
      ...(withoutOrphans.skipped && !withOrphans.skipped
        ? { skippedWithoutOrphans: withoutOrphans.skipped }
        : {}),
      retiredEvidenceReadLive: withoutOrphans.retiredEvidenceReadLive,
    });
  }
  return diffs;
}

export interface RetireOrphanedLaneConfigsReport {
  mode: 'dry-run' | 'apply';
  projectionOnlyFields: Record<string, string[]>;
  rematerializeOnlyFields: string[];
  changesOutsideProjectionFields: number;
  scannedRepositories: Array<{ gitDir: string; refs: number; tipCommits: number }>;
  verdicts: OrphanedLaneConfigPlan['verdicts'];
  countsByConfig: OrphanedLaneConfigPlan['countsByConfig'];
  observationsToRetire: number;
  heldObservations: number;
  affectedLiveResearchRows: number;
  affectedServedResearchRows: number;
  servedRowsWithChanges: number;
  servedFieldChangeCounts: Record<string, number>;
  servedFieldsBecomingEmpty: Record<string, number>;
  rowsWithRetiredEvidenceReadLive: number;
  personKeysWithRetiredEvidenceReadLive: number;
  servedRowsLeftWithoutOwnEvidence: number;
  personKeysAffected: number;
  personKeysWithChanges: number;
  personFieldChangeCounts: Record<string, number>;
  retiredObservations: number;
}

export async function runOrphanedLaneConfigRetirement(input: {
  apply: boolean;
  configs: readonly RequestedLaneConfig[];
  refPresence: readonly LaneConfigRefPresence[];
  scannedRepositories: Array<{ gitDir: string; refs: number; tipCommits: number }>;
  lanes?: readonly OrphanLaneDefinition[];
  codeShasOnRef: (codeShas: readonly string[]) => ReadonlySet<string>;
  readServedEntity?: (slug: string) => Promise<Record<string, unknown> | null>;
  log?: (message: string) => void;
}): Promise<{
  report: RetireOrphanedLaneConfigsReport;
  rows: ServedRowDiff[];
  personKeys: PersonKeyDiff[];
}> {
  const lanes = input.lanes ?? orphanedLaneConfigRegistry();
  const evidence = await loadCandidateLaneEvidence({ configs: input.configs, lanes });
  const plan = planOrphanedLaneConfigRetirement({
    requested: input.configs,
    lanes,
    refPresence: input.refPresence,
    observations: evidence.observations,
    runs: evidence.runs,
    codeShasOnRef: input.codeShasOnRef(
      evidence.runs.flatMap((run) => (run.codeSha ? [run.codeSha] : [])),
    ),
  });
  const notOrphaned = plan.verdicts.filter((entry) => entry.verdict.status !== 'orphaned');
  if (input.apply && notOrphaned.length > 0) {
    throw new Error(
      `${SCRIPT_NAME} refuses to apply: ${notOrphaned
        .map((entry) => `${laneConfigLabel(entry)} is ${entry.verdict.status}`)
        .join('; ')}`,
    );
  }

  const excludedIds = plan.observationIdsToRetire.map((id) => new mongoose.Types.ObjectId(id));
  const retiredIdSet = new Set(plan.observationIdsToRetire);
  const rows: ServedRowDiff[] = [];
  const liveRows = await affectedLiveResearchRows(plan);
  const retiredIdentities = await retiredEvidenceIdentities(plan);
  const onlyFieldsByEntityType = projectionOnlyFields(plan);
  input.log?.(
    `planned ${plan.observationIdsToRetire.length} observations over ${liveRows.size} live research rows`,
  );
  const readServed =
    input.readServedEntity ??
    (async (slug: string) =>
      ((await getResearchGroupDetail(slug))?.researchEntity as
        Record<string, unknown> | undefined) ?? null);
  for (const [slug, { doc, retiredOnRow }] of [...liveRows.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    input.log?.(`projecting research row ${rows.length + 1} of ${liveRows.size}`);
    const researchOnlyFields = onlyFieldsByEntityType.researchEntity ?? [];
    const withOrphans = await projectRow(
      'researchEntity',
      slug,
      [],
      retiredIdentities,
      researchOnlyFields,
    );
    const withoutOrphans = await projectRow(
      'researchEntity',
      slug,
      excludedIds,
      retiredIdentities,
      researchOnlyFields,
    );
    const tier = typeof doc.studentVisibilityTier === 'string' ? doc.studentVisibilityTier : null;
    const served = tier === SERVED_TIER;
    const changes = servedFieldChanges({
      stored: doc,
      withOrphans,
      withoutOrphans,
      creditedFields: fieldsCreditedToRetired(doc.fieldProvenance, retiredIdSet),
    });
    const servedEntity = served && changes.length > 0 ? await readServed(slug) : null;
    rows.push({
      entityKey: slug,
      studentVisibilityTier: tier,
      served,
      retiredObservationsOnRow: retiredOnRow,
      creditedFields: [...fieldsCreditedToRetired(doc.fieldProvenance, retiredIdSet)].sort(),
      changes: changes.map((change) => ({
        ...change,
        servedBefore: servedEntity ? servedEntity[change.field] : undefined,
      })),
      ...(withoutOrphans.skipped && !withOrphans.skipped
        ? { skippedWithoutOrphans: withoutOrphans.skipped }
        : {}),
      retiredEvidenceReadLive: withoutOrphans.retiredEvidenceReadLive,
      liveObservationsBefore: withOrphans.ownLiveObservations,
      liveObservationsAfter: withoutOrphans.ownLiveObservations,
    });
  }
  const personKeys = await projectPersonKeys(
    plan,
    excludedIds,
    retiredIdentities,
    onlyFieldsByEntityType.user ?? [],
    input.log,
  );

  let retiredObservations = 0;
  if (input.apply && excludedIds.length > 0) {
    const { retired } = await retireObservations(
      {
        _id: { $in: excludedIds },
        sourceName: { $in: [...new Set(input.configs.map((config) => config.sourceName))] },
      },
      ORPHANED_LANE_CONFIG_ROLLBACK_REASON,
    );
    retiredObservations = retired;
  }

  const tally = (values: string[]) =>
    values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {});
  const servedRows = rows.filter((row) => row.served);
  return {
    report: {
      mode: input.apply ? 'apply' : 'dry-run',
      projectionOnlyFields: onlyFieldsByEntityType,
      rematerializeOnlyFields: (onlyFieldsByEntityType.researchEntity ?? []).filter((field) =>
        (REMATERIALIZE_TRACKED_FIELDS as readonly string[]).includes(field),
      ),
      changesOutsideProjectionFields: rows.reduce(
        (count, row) =>
          count +
          row.changes.filter(
            (change) => !(onlyFieldsByEntityType.researchEntity ?? []).includes(change.field),
          ).length,
        0,
      ),
      scannedRepositories: input.scannedRepositories,
      verdicts: plan.verdicts,
      countsByConfig: plan.countsByConfig,
      observationsToRetire: plan.observationIdsToRetire.length,
      heldObservations: plan.held.length,
      affectedLiveResearchRows: liveRows.size,
      affectedServedResearchRows: [...liveRows.values()].filter(
        ({ doc }) => doc.studentVisibilityTier === SERVED_TIER,
      ).length,
      servedRowsWithChanges: servedRows.filter((row) => row.changes.length > 0).length,
      servedFieldChangeCounts: tally(servedRows.flatMap((row) => row.changes.map((c) => c.field))),
      servedFieldsBecomingEmpty: tally(
        servedRows.flatMap((row) => row.changes.filter((c) => c.becomesEmpty).map((c) => c.field)),
      ),
      rowsWithRetiredEvidenceReadLive: rows.filter((row) => row.retiredEvidenceReadLive > 0).length,
      personKeysWithRetiredEvidenceReadLive: personKeys.filter(
        (key) => key.retiredEvidenceReadLive > 0,
      ).length,
      servedRowsLeftWithoutOwnEvidence: servedRows.filter(
        (row) => row.liveObservationsBefore > 0 && row.liveObservationsAfter === 0,
      ).length,
      personKeysAffected: personKeys.length,
      personKeysWithChanges: personKeys.filter((key) => key.changedPaths.length > 0).length,
      personFieldChangeCounts: tally(personKeys.flatMap((key) => key.changedPaths)),
      retiredObservations,
    },
    rows,
    personKeys,
  };
}

async function main(): Promise<void> {
  const options = parseRetireOrphanedLaneConfigsArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  const outputPath = options.output;
  const gitDirs = [...new Set([currentGitCommonDir(here), ...options.gitDirs])];
  const scan = scanLaneConfigRefs({ configs: options.configs, gitDirs });

  await initializeConnections();
  try {
    const { report, rows, personKeys } = await runOrphanedLaneConfigRetirement({
      apply: options.apply,
      configs: options.configs,
      refPresence: scan.presence,
      scannedRepositories: scan.scanned,
      codeShasOnRef: (codeShas) => codeShasReachableFromRefs(codeShas, gitDirs),
      log: (message) => console.error(`[${SCRIPT_NAME}] ${message}`),
    });
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(
        outputPath,
        `${JSON.stringify(
          {
            report,
            rematerializeSlugs: rows
              .filter((row) => row.changes.length > 0 || row.creditedFields.length > 0)
              .map((row) => row.entityKey),
            rows,
            personKeys,
          },
          null,
          2,
        )}\n`,
        {
          mode: 0o600,
        },
      );
      fs.chmodSync(outputPath, 0o600);
    }
    console.log(JSON.stringify({ script: SCRIPT_NAME, ...report }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
