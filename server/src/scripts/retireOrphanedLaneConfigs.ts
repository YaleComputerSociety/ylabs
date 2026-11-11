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
  splitByEngineProduction,
  type EngineFieldOutputs,
  type HeldSoleEvidence,
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
export const RETIRE_SOLE_EVIDENCE_FLAG = '--retire-sole-evidence';
export const ORPHANED_LANE_CONFIG_ROLLBACK_REASON =
  'written by a lane config that exists on no git ref, so no run of current code re-reads its pages (#5807)';
const SERVED_TIER = 'student_ready';

export interface RetireOrphanedLaneConfigsOptions {
  apply: boolean;
  confirmed: boolean;
  configs: RequestedLaneConfig[];
  gitDirs: string[];
  output?: string;
  retireSoleEvidence: boolean;
}

export function parseRetireOrphanedLaneConfigsArgs(
  argv: string[],
): RetireOrphanedLaneConfigsOptions {
  const options: RetireOrphanedLaneConfigsOptions = {
    apply: false,
    confirmed: false,
    configs: [],
    gitDirs: [],
    retireSoleEvidence: false,
  };
  const valueOf = (arg: string, flag: string, index: number): [string, number] =>
    arg === flag ? [argv[index + 1] ?? '', index + 1] : [arg.slice(flag.length + 1), index];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === RETIRE_SOLE_EVIDENCE_FLAG) options.retireSoleEvidence = true;
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
      .select('_id sourceName entityType entityKey entityId field value scrapeRunId')
      .lean()) as Array<Record<string, unknown>>;
    for (const row of rows) {
      observations.push({
        id: serializedDocumentId(row._id) ?? '',
        sourceName: String(row.sourceName),
        entityType: String(row.entityType),
        entityKey: typeof row.entityKey === 'string' ? row.entityKey : undefined,
        entityId: serializedDocumentId(row.entityId) ?? undefined,
        field: String(row.field),
        value: row.value,
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

interface ClearedStoredRow {
  slug: string;
  id: string;
  doc: Record<string, unknown>;
}

const withStoredFieldsCleared = (
  doc: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> => {
  const cleared: Record<string, unknown> = { ...doc };
  for (const bookkeeping of ['fieldProvenance', 'confidenceByField']) {
    const byField = cleared[bookkeeping];
    if (byField && typeof byField === 'object') {
      const kept = { ...(byField as Record<string, unknown>) };
      for (const field of fields) delete kept[field];
      cleared[bookkeeping] = kept;
    }
  }
  for (const field of fields) delete cleared[field];
  return cleared;
};

class MissRecordingReadSource implements MaterializationReadSource {
  readonly misses: MissedObservationRead[] = [];

  constructor(
    private readonly inner: MaterializationReadSource,
    private readonly clearedRow?: ClearedStoredRow,
  ) {}

  private clearedLookup(entityType: string, matches: boolean, live: boolean) {
    if (!this.clearedRow || entityType !== 'researchEntity' || !matches) return undefined;
    const archived = this.clearedRow.doc.archived === true;
    return { hit: true as const, value: live && archived ? null : this.clearedRow.doc };
  }

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
    return (
      this.clearedLookup(entityType, String(entityId) === this.clearedRow?.id, false) ??
      this.inner.entityDocForId(entityType, entityId)
    );
  }

  entityDocForKey(entityType: string, keyValue: string) {
    return (
      this.clearedLookup(entityType, keyValue === this.clearedRow?.slug, false) ??
      this.inner.entityDocForKey(entityType, keyValue)
    );
  }

  liveEntityDocForKey(entityType: string, keyValue: string) {
    return (
      this.clearedLookup(entityType, keyValue === this.clearedRow?.slug, true) ??
      this.inner.liveEntityDocForKey(entityType, keyValue)
    );
  }

  liveEntityDocForId(entityType: string, entityId: unknown) {
    return (
      this.clearedLookup(entityType, String(entityId) === this.clearedRow?.id, true) ??
      this.inner.liveEntityDocForId(entityType, entityId)
    );
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
  clearStoredFields: readonly string[] = [],
): Promise<ProjectedPlan> {
  const readScopeFilter = {
    ...materializationReadScopeFilter(),
    ...(excludedIds.length > 0 ? { _id: { $nin: excludedIds } } : {}),
  };
  const doc =
    entityType === 'researchEntity'
      ? ((await ResearchEntity.findOne({ slug: entityKey }).lean()) as Record<
          string,
          unknown
        > | null)
      : null;
  const clearedRow: ClearedStoredRow | undefined =
    doc && clearStoredFields.length > 0
      ? {
          slug: entityKey,
          id: serializedDocumentId(doc._id) ?? '',
          doc: withStoredFieldsCleared(doc, clearStoredFields),
        }
      : undefined;
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
      clearedRow,
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

interface ResearchEvidenceRows {
  live: Map<string, { doc: Record<string, unknown>; retiredOnRow: number }>;
  survivorOfIdentity: Map<string, string>;
}

const isResearchSubject = (entityType: string) =>
  entityType === 'researchEntity' || entityType === 'researchGroup';

async function affectedLiveResearchRows(
  attributed: OrphanedLaneConfigPlan['attributed'],
): Promise<ResearchEvidenceRows> {
  const researchObservations = attributed.filter((entry) =>
    isResearchSubject(entry.observation.entityType),
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
  const survivorOfIdentity = new Map<string, string>();
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
    survivorOfIdentity.set(`key:${String(doc.slug)}`, current.slug);
    survivorOfIdentity.set(`id:${serializedDocumentId(doc._id) ?? ''}`, current.slug);
    const retiredHere =
      (retiredByKey.get(String(doc.slug)) ?? 0) +
      (retiredByKey.get(serializedDocumentId(doc._id) ?? '') ?? 0);
    const existing = live.get(current.slug);
    live.set(current.slug, {
      doc: current,
      retiredOnRow: (existing?.retiredOnRow ?? 0) + retiredHere,
    });
  }
  return { live, survivorOfIdentity };
}

const researchRowLabel = (slug: string) => `researchEntity:${slug}`;
const personRowLabel = (entityKey: string) => `user:${entityKey}`;

function evidenceRowOf(
  observation: StoredLaneObservation,
  survivorOfIdentity: ReadonlyMap<string, string>,
): string | undefined {
  if (isResearchSubject(observation.entityType)) {
    const survivor =
      (observation.entityKey && survivorOfIdentity.get(`key:${observation.entityKey}`)) ||
      (observation.entityId && survivorOfIdentity.get(`id:${observation.entityId}`));
    return survivor ? researchRowLabel(survivor) : undefined;
  }
  return observation.entityKey ? personRowLabel(observation.entityKey) : undefined;
}

const IDENTITY_FIELDS = new Set(['slug']);

/**
 * Projects every row an orphan backs through the engine twice with the orphaned fields' stored
 * values cleared, once with the orphans and once without them, so a stored value cannot stand in
 * for evidence the engine no longer has. A person key goes through the same projection, which
 * plans no stored person fields, so it never reads as backed.
 */
async function engineOutputsByRow(input: {
  plan: OrphanedLaneConfigPlan;
  rowOfAttributed: ReadonlyMap<string, string | undefined>;
  researchSlugs: readonly string[];
  projectResearchEntity: typeof projectRow;
  retiredIdentities: ReadonlySet<string>;
  onlyFieldsByEntityType: Record<string, string[]>;
  log?: (message: string) => void;
}): Promise<Map<string, EngineFieldOutputs>> {
  const fieldsByRow = new Map<string, Set<string>>();
  const idsByRow = new Map<string, mongoose.Types.ObjectId[]>();
  for (const { observation } of input.plan.attributed) {
    const row = input.rowOfAttributed.get(observation.id);
    if (!row) continue;
    const fields = fieldsByRow.get(row) ?? new Set<string>();
    if (!IDENTITY_FIELDS.has(observation.field)) fields.add(observation.field);
    fieldsByRow.set(row, fields);
    idsByRow.set(row, [...(idsByRow.get(row) ?? []), new mongoose.Types.ObjectId(observation.id)]);
  }
  const outputs = new Map<string, EngineFieldOutputs>();
  const project = async (
    row: string,
    entityType: ObservedEntityType,
    entityKey: string,
    projector: typeof projectRow,
  ) => {
    const cleared = [...(fieldsByRow.get(row) ?? [])].sort();
    const onlyFields = input.onlyFieldsByEntityType[entityType] ?? [];
    const withOrphans = await projector(
      entityType,
      entityKey,
      [],
      input.retiredIdentities,
      onlyFields,
      cleared,
    );
    const withoutOrphans = await projector(
      entityType,
      entityKey,
      idsByRow.get(row) ?? [],
      input.retiredIdentities,
      onlyFields,
      cleared,
    );
    outputs.set(row, { withOrphans: withOrphans.set, withoutOrphans: withoutOrphans.set });
  };
  for (const slug of input.researchSlugs) {
    input.log?.(
      `projecting a research row with its stored orphaned fields cleared: ${outputs.size + 1}`,
    );
    await project(researchRowLabel(slug), 'researchEntity', slug, input.projectResearchEntity);
  }
  for (const row of [...fieldsByRow.keys()].filter((label) => label.startsWith('user:')).sort()) {
    await project(row, 'user', row.slice('user:'.length), projectRow);
  }
  return outputs;
}

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
  retireSoleEvidence: boolean;
  heldSoleEvidenceFields: number;
  heldSoleEvidenceObservations: number;
  heldSoleEvidenceByConfigAndField: Record<string, number>;
  heldSoleEvidenceOnServedRows: number;
  rowsStillLessComplete: number;
  attributedWithoutRow: number;
  affectedLiveResearchRows: number;
  affectedServedResearchRows: number;
  servedRowsWithChanges: number;
  servedFieldChangeCounts: Record<string, number>;
  servedFieldsBecomingEmpty: Record<string, number>;
  servedFieldsBecomingLessComplete: Record<string, number>;
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
  readServedEntity?: (slug: string) => Promise<Record<string, unknown> | null>;
  retireSoleEvidence?: boolean;
  projectResearchEntity?: typeof projectRow;
  log?: (message: string) => void;
}): Promise<{
  report: RetireOrphanedLaneConfigsReport;
  rows: ServedRowDiff[];
  personKeys: PersonKeyDiff[];
  heldSoleEvidence: HeldSoleEvidence[];
}> {
  const lanes = input.lanes ?? orphanedLaneConfigRegistry();
  const evidence = await loadCandidateLaneEvidence({ configs: input.configs, lanes });
  const plan = planOrphanedLaneConfigRetirement({
    requested: input.configs,
    lanes,
    refPresence: input.refPresence,
    observations: evidence.observations,
    runs: evidence.runs,
  });
  const notOrphaned = plan.verdicts.filter((entry) => entry.verdict.status !== 'orphaned');
  if (input.apply && notOrphaned.length > 0) {
    throw new Error(
      `${SCRIPT_NAME} refuses to apply: ${notOrphaned
        .map((entry) => `${laneConfigLabel(entry)} is ${entry.verdict.status}`)
        .join('; ')}`,
    );
  }

  const evidenceRows = await affectedLiveResearchRows(plan.attributed);
  const liveRows = evidenceRows.live;
  const rowOfAttributed = new Map(
    plan.attributed.map((entry) => [
      entry.observation.id,
      evidenceRowOf(entry.observation, evidenceRows.survivorOfIdentity),
    ]),
  );
  const onlyFieldsByEntityType = projectionOnlyFields(plan);
  const researchOnlyFields = onlyFieldsByEntityType.researchEntity ?? [];
  const projectResearchEntity = input.projectResearchEntity ?? projectRow;
  const allIdentities = await retiredEvidenceIdentities(plan);
  const outputsByRow = await engineOutputsByRow({
    plan,
    rowOfAttributed,
    researchSlugs: [...liveRows.keys()].sort(),
    projectResearchEntity,
    retiredIdentities: allIdentities,
    onlyFieldsByEntityType,
    log: input.log,
  });
  const split = splitByEngineProduction({
    attributed: plan.attributed,
    rowOf: (observation) => rowOfAttributed.get(observation.id),
    outputsByRow,
    retireSoleEvidence: input.retireSoleEvidence ?? false,
  });
  const retiredIdSet = new Set(split.observationIdsToRetire);
  const heldSoleEvidence: HeldSoleEvidence[] = [...split.heldSoleEvidence];
  input.log?.(
    `planned ${retiredIdSet.size} observations (holding ${heldSoleEvidence.length} sole-evidence fields) over ${liveRows.size} live research rows`,
  );
  const readServed =
    input.readServedEntity ??
    (async (slug: string) =>
      ((await getResearchGroupDetail(slug))?.researchEntity as
        Record<string, unknown> | undefined) ?? null);
  const withOrphansBySlug = new Map<string, ProjectedPlan>();
  const projectResearchRow = async (slug: string): Promise<ServedRowDiff> => {
    const { doc, retiredOnRow } = liveRows.get(slug)!;
    let withOrphans = withOrphansBySlug.get(slug);
    if (!withOrphans) {
      withOrphans = await projectResearchEntity(
        'researchEntity',
        slug,
        [],
        allIdentities,
        researchOnlyFields,
      );
      withOrphansBySlug.set(slug, withOrphans);
    }
    const withoutOrphans = await projectResearchEntity(
      'researchEntity',
      slug,
      [...retiredIdSet].map((id) => new mongoose.Types.ObjectId(id)),
      allIdentities,
      researchOnlyFields,
    );
    const tier = typeof doc.studentVisibilityTier === 'string' ? doc.studentVisibilityTier : null;
    const served = tier === SERVED_TIER;
    const credited = fieldsCreditedToRetired(doc.fieldProvenance, retiredIdSet);
    const changes = servedFieldChanges({
      stored: doc,
      withOrphans,
      withoutOrphans,
      creditedFields: credited,
    });
    const servedEntity = served && changes.length > 0 ? await readServed(slug) : null;
    return {
      entityKey: slug,
      studentVisibilityTier: tier,
      served,
      retiredObservationsOnRow: retiredOnRow,
      creditedFields: [...credited].sort(),
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
    };
  };
  const holdOnRow = (slug: string, fields: ReadonlySet<string> | 'all') => {
    const row = researchRowLabel(slug);
    let added = 0;
    for (const entry of plan.attributed) {
      const id = entry.observation.id;
      if (!retiredIdSet.has(id) || rowOfAttributed.get(id) !== row) continue;
      if (fields !== 'all' && !fields.has(entry.observation.field)) continue;
      retiredIdSet.delete(id);
      added += 1;
      const existing = heldSoleEvidence.find(
        (group) => group.row === row && group.field === entry.observation.field,
      );
      const group = existing ?? {
        row,
        field: entry.observation.field,
        configIds: [],
        values: [],
        observationIds: [],
        basis: 'engine-projection' as const,
      };
      if (!group.configIds.includes(entry.configId)) group.configIds.push(entry.configId);
      group.values.push(entry.observation.value);
      group.observationIds.push(id);
      if (!existing) heldSoleEvidence.push(group);
    }
    return added;
  };
  const lessCompleteFields = (row: ServedRowDiff) =>
    new Set(row.changes.filter((change) => change.becomesLessComplete).map((c) => c.field));

  const rowsBySlug = new Map<string, ServedRowDiff>();
  for (const slug of [...liveRows.keys()].sort()) {
    input.log?.(`projecting research row ${rowsBySlug.size + 1} of ${liveRows.size}`);
    rowsBySlug.set(slug, await projectResearchRow(slug));
  }
  const unresolvedLessComplete: string[] = [];
  if (!(input.retireSoleEvidence ?? false)) {
    for (const scope of ['fields', 'all'] as const) {
      const flagged = [...rowsBySlug.values()].filter((row) => lessCompleteFields(row).size > 0);
      if (flagged.length === 0) break;
      for (const row of flagged) {
        holdOnRow(row.entityKey, scope === 'fields' ? lessCompleteFields(row) : 'all');
      }
      for (const row of flagged) {
        input.log?.(`re-projecting a research row the retirement left less complete (${scope})`);
        rowsBySlug.set(row.entityKey, await projectResearchRow(row.entityKey));
      }
    }
    for (const row of rowsBySlug.values()) {
      if (lessCompleteFields(row).size > 0) unresolvedLessComplete.push(row.entityKey);
    }
  }
  const rows = [...rowsBySlug.values()];
  if (input.apply && unresolvedLessComplete.length > 0) {
    throw new Error(
      `${SCRIPT_NAME} refuses to apply: ${unresolvedLessComplete.length} row(s) would still serve a less complete field after holding their orphaned evidence`,
    );
  }
  const retiringPlan: OrphanedLaneConfigPlan = {
    ...plan,
    attributed: plan.attributed.filter((entry) => retiredIdSet.has(entry.observation.id)),
    observationIdsToRetire: [...retiredIdSet].sort(),
  };
  const excludedIds = retiringPlan.observationIdsToRetire.map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const retiredIdentities = await retiredEvidenceIdentities(retiringPlan);
  const personKeys = await projectPersonKeys(
    retiringPlan,
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
      observationsToRetire: retiringPlan.observationIdsToRetire.length,
      rowsStillLessComplete: unresolvedLessComplete.length,
      heldObservations: plan.held.length,
      retireSoleEvidence: input.retireSoleEvidence ?? false,
      heldSoleEvidenceFields: heldSoleEvidence.length,
      heldSoleEvidenceObservations: heldSoleEvidence.reduce(
        (count, group) => count + group.observationIds.length,
        0,
      ),
      heldSoleEvidenceByConfigAndField: tally(
        heldSoleEvidence.flatMap((group) =>
          group.configIds.map((configId) => `${configId}|${group.field}`),
        ),
      ),
      heldSoleEvidenceOnServedRows: heldSoleEvidence.filter((group) => {
        const slug = group.row.startsWith('researchEntity:') ? group.row.slice(15) : '';
        return liveRows.get(slug)?.doc.studentVisibilityTier === SERVED_TIER;
      }).length,
      attributedWithoutRow: split.withoutRow,
      affectedLiveResearchRows: liveRows.size,
      affectedServedResearchRows: [...liveRows.values()].filter(
        ({ doc }) => doc.studentVisibilityTier === SERVED_TIER,
      ).length,
      servedRowsWithChanges: servedRows.filter((row) => row.changes.length > 0).length,
      servedFieldChangeCounts: tally(servedRows.flatMap((row) => row.changes.map((c) => c.field))),
      servedFieldsBecomingEmpty: tally(
        servedRows.flatMap((row) => row.changes.filter((c) => c.becomesEmpty).map((c) => c.field)),
      ),
      servedFieldsBecomingLessComplete: tally(
        servedRows.flatMap((row) =>
          row.changes.filter((c) => c.becomesLessComplete).map((c) => c.field),
        ),
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
    heldSoleEvidence,
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
    const { report, rows, personKeys, heldSoleEvidence } = await runOrphanedLaneConfigRetirement({
      apply: options.apply,
      retireSoleEvidence: options.retireSoleEvidence,
      configs: options.configs,
      refPresence: scan.presence,
      scannedRepositories: scan.scanned,
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
            heldSoleEvidence,
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
