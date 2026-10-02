import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS } from '../models/roleAssignment';
import {
  ARCHIVED_REASON_ABSENT,
  archivedEntityArtifactPlanWriteCount,
  archivedEntityRepairClasses,
  buildArchivedEntityArtifactRepairPlan,
  dispositionMatchesScope,
  resolveArchivedEntityDispositions,
  summarizeArchivedEntityArtifactRepairPlanByClass,
  type ArchivedEntityArtifact,
  type ArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifactType,
  type ArchivedEntityDisposition,
  type ArchivedEntityNode,
  type ArchivedEntityRepairClass,
  type ArchivedEntityRepairScope,
} from './repairArchivedEntityArtifactsCore';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { attributedArchiveSet } from '../models/entityArchival';

dotenv.config({ quiet: true });

interface ArtifactSpec {
  artifactType: ArchivedEntityArtifactType;
  collection: string;
  entityIdPath: string;
  activeMatch: Record<string, unknown>;
  projection: Record<string, 1>;
  toArtifact: (row: Record<string, any>) => ArchivedEntityArtifact;
}

export interface RepairArchivedEntityArtifactsCliOptions {
  apply: boolean;
  confirmArchivedArtifactRepair: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
  classes?: ArchivedEntityRepairClass[];
  archivedReasons?: string[];
  archivedSince?: string;
  archivedBefore?: string;
  entityIds?: string[];
  artifactTypes?: ArchivedEntityArtifactType[];
}

const __filename = fileURLToPath(import.meta.url);

export const MERGED_DUPLICATE_ROLE_EDGE_NOTE =
  'Retired by research-entity:repair-archived-artifacts: duplicates a live edge on the merge survivor of its archived research entity (#3578).';
export const NO_CANONICAL_ROLE_EDGE_NOTE =
  'Retired by research-entity:repair-archived-artifacts: its research entity is archived with no merge survivor (#3578).';

const ARTIFACT_TYPE_FLAGS: Record<string, ArchivedEntityArtifactType> = {
  'role-assignment': 'RoleAssignment',
  'access-signal': 'AccessSignal',
};

const ARTIFACT_SPECS: ArtifactSpec[] = [
  {
    artifactType: 'RoleAssignment',
    collection: 'role_assignments',
    entityIdPath: 'target.id',
    activeMatch: {
      archived: { $ne: true },
      state: { $ne: 'HISTORICAL' },
      'target.kind': 'RESEARCH_ENTITY',
    },
    projection: { _id: 1, target: 1, personId: 1, role: 1 },
    toArtifact: (row) => ({
      artifactType: 'RoleAssignment',
      id: stringId(row._id),
      researchEntityId: stringId(row.target?.id),
      personId: stringId(row.personId),
      role: stringId(row.role),
    }),
  },
  {
    artifactType: 'AccessSignal',
    collection: 'signals',
    entityIdPath: 'researchEntityId',
    activeMatch: { archived: { $ne: true } },
    projection: { _id: 1, researchEntityId: 1, type: 1, derivationKey: 1 },
    toArtifact: (row) => ({
      artifactType: 'AccessSignal',
      id: stringId(row._id),
      researchEntityId: stringId(row.researchEntityId),
      signalType: stringId(row.type),
      derivationKey: stringId(row.derivationKey),
    }),
  },
];
const ARCHIVED_ARTIFACT_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeArchivedArtifactObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return ARCHIVED_ARTIFACT_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

function parsePositiveInteger(value: string, optionName: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

const SCOPE_FLAGS = [
  '--class',
  '--archived-reason',
  '--archived-since',
  '--archived-before',
  '--entity-ids',
  '--artifact-type',
] as const;
type ScopeFlag = (typeof SCOPE_FLAGS)[number];

function parseScopeArg(
  arg: string,
  next: string | undefined,
): { flag: ScopeFlag; value: string; consumedNext: boolean } | undefined {
  if (arg === '--archived-reason-absent') {
    return { flag: '--archived-reason', value: ARCHIVED_REASON_ABSENT, consumedNext: false };
  }
  for (const flag of SCOPE_FLAGS) {
    if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1).trim();
      if (!value) throw new Error(`${flag} requires a value`);
      return { flag, value, consumedNext: false };
    }
    if (arg === flag) {
      const value = next?.trim();
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      return { flag, value, consumedNext: true };
    }
  }
  return undefined;
}

function parseIsoDate(value: string, flag: string): string {
  const parsed = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} must be an ISO date such as 2026-09-26 or 2026-09-26T21:00:00Z`);
  }
  return parsed.toISOString();
}

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function pushUnique<T>(existing: T[] | undefined, values: T[]): T[] {
  return [...new Set([...(existing || []), ...values])];
}

function applyScopeArg(
  options: RepairArchivedEntityArtifactsCliOptions,
  flag: ScopeFlag,
  value: string,
): void {
  if (flag === '--class') {
    const classes = commaList(value).map((repairClass) => {
      if (!(archivedEntityRepairClasses as readonly string[]).includes(repairClass)) {
        throw new Error(`--class must be one of ${archivedEntityRepairClasses.join(', ')}`);
      }
      return repairClass as ArchivedEntityRepairClass;
    });
    options.classes = pushUnique(options.classes, classes);
    return;
  }
  if (flag === '--archived-reason') {
    options.archivedReasons = pushUnique(options.archivedReasons, [value]);
    return;
  }
  if (flag === '--archived-since') {
    options.archivedSince = parseIsoDate(value, flag);
    return;
  }
  if (flag === '--archived-before') {
    options.archivedBefore = parseIsoDate(value, flag);
    return;
  }
  if (flag === '--entity-ids') {
    const ids = commaList(value).map((id) => {
      const normalized = normalizeArchivedArtifactObjectId(id);
      if (!normalized) throw new Error('--entity-ids must be a comma-separated list of ObjectIds');
      return normalized.toLowerCase();
    });
    options.entityIds = pushUnique(options.entityIds, ids);
    return;
  }
  const artifactTypes = commaList(value).map((artifactType) => {
    const resolved = ARTIFACT_TYPE_FLAGS[artifactType];
    if (!resolved) {
      throw new Error(
        `--artifact-type must be one of ${Object.keys(ARTIFACT_TYPE_FLAGS).join(', ')}`,
      );
    }
    return resolved;
  });
  options.artifactTypes = pushUnique(options.artifactTypes, artifactTypes);
}

export function archivedEntityRepairScopeFromOptions(
  options: RepairArchivedEntityArtifactsCliOptions,
): ArchivedEntityRepairScope {
  return {
    ...(options.classes ? { classes: new Set(options.classes) } : {}),
    ...(options.archivedReasons ? { archivedReasons: new Set(options.archivedReasons) } : {}),
    ...(options.archivedSince ? { archivedSince: new Date(options.archivedSince) } : {}),
    ...(options.archivedBefore ? { archivedBefore: new Date(options.archivedBefore) } : {}),
    ...(options.entityIds ? { entityIds: new Set(options.entityIds) } : {}),
  };
}

export function parseRepairArchivedEntityArtifactsArgs(
  argv: string[],
): RepairArchivedEntityArtifactsCliOptions {
  const options: RepairArchivedEntityArtifactsCliOptions = {
    apply: false,
    confirmArchivedArtifactRepair: false,
    limit: 100,
    limitProvided: false,
    maxApply: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-archived-artifact-repair') {
      options.confirmArchivedArtifactRepair = true;
      continue;
    }
    if (arg.startsWith('--confirm-archived-artifact-repair=')) {
      throw new Error('--confirm-archived-artifact-repair does not accept a value');
    }
    if (arg === '--mode=dry-run' || arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const limit = arg.slice('--limit='.length).trim();
      if (!limit) throw new Error('--limit requires a number');
      options.limit = parsePositiveInteger(limit, '--limit');
      options.limitProvided = true;
      continue;
    }
    if (arg === '--limit') {
      const limit = argv[index + 1]?.trim();
      if (!limit || limit.startsWith('--')) throw new Error('--limit requires a number');
      options.limit = parsePositiveInteger(limit, '--limit');
      options.limitProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      const maxApply = arg.slice('--max-apply='.length).trim();
      if (!maxApply) throw new Error('--max-apply requires a number');
      options.maxApply = parsePositiveInteger(maxApply, '--max-apply');
      continue;
    }
    if (arg === '--max-apply') {
      const maxApply = argv[index + 1]?.trim();
      if (!maxApply || maxApply.startsWith('--')) {
        throw new Error('--max-apply requires a number');
      }
      options.maxApply = parsePositiveInteger(maxApply, '--max-apply');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }

    const scoped = parseScopeArg(arg, argv[index + 1]);
    if (scoped) {
      applyScopeArg(options, scoped.flag, scoped.value);
      if (scoped.consumedNext) index += 1;
      continue;
    }

    throw new Error(`Unknown research-entity:repair-archived-artifacts argument: ${arg}`);
  }

  return options;
}

export function assertArchivedEntityArtifactRepairApplyAllowed({
  apply,
  confirmArchivedArtifactRepair,
  limitProvided,
  maxApply,
  plannedWrites,
  classes,
}: {
  apply: boolean;
  confirmArchivedArtifactRepair?: boolean;
  limitProvided?: boolean;
  maxApply: number;
  plannedWrites: number;
  classes?: ArchivedEntityRepairClass[];
}): void {
  if (!apply) return;
  if (!classes || classes.length !== 1) {
    throw new Error(
      '--apply requires exactly one --class so a run settles one archive class at a time for research-entity:repair-archived-artifacts',
    );
  }
  if (classes[0] === 'merge-dead-end') {
    throw new Error(
      '--class=merge-dead-end has no survivor to relink to and is report-only; repair the tombstone chain first',
    );
  }
  if (limitProvided === false) {
    throw new Error(
      '--limit is required when --apply is set for research-entity:repair-archived-artifacts',
    );
  }
  if (!confirmArchivedArtifactRepair) {
    throw new Error(
      '--confirm-archived-artifact-repair is required when --apply is set for research-entity:repair-archived-artifacts',
    );
  }
  if (plannedWrites > maxApply) {
    throw new Error(`Apply would modify ${plannedWrites} artifacts, above --max-apply.`);
  }
}

export function writeRepairArchivedEntityArtifactsOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildRepairArchivedEntityArtifactsOutput(
  target: { environment: string; db: string; options?: RepairArchivedEntityArtifactsCliOptions },
  report: Record<string, unknown>,
  generatedAt = new Date(),
): Record<string, unknown> {
  return {
    generatedAt: generatedAt.toISOString(),
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...report,
  };
}

function stringId(value: unknown): string {
  return serializedDocumentId(value) || '';
}

function objectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeArchivedArtifactObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

function specFor(artifactType: ArchivedEntityArtifactType): ArtifactSpec {
  const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === artifactType);
  if (!spec) throw new Error(`No artifact spec for ${artifactType}`);
  return spec;
}

async function loadEntityNodes(): Promise<{
  archivedEntities: ArchivedEntityNode[];
  nodesById: Map<string, ArchivedEntityNode>;
}> {
  const toNode = (row: any): ArchivedEntityNode => ({
    id: stringId(row._id),
    archived: row.archived === true,
    canonicalGroupId: stringId(row.canonicalGroupId) || undefined,
    archivedReason: typeof row.archivedReason === 'string' ? row.archivedReason : '',
    archivedAt: row.archivedAt instanceof Date ? row.archivedAt : undefined,
  });
  const archivedEntities = (
    await ResearchEntity.find({ archived: true })
      .select('_id archived canonicalGroupId archivedReason archivedAt')
      .lean()
  ).map(toNode);
  const nodesById = new Map(archivedEntities.map((node) => [node.id, node]));
  const liveCanonicalIds = [
    ...new Set(archivedEntities.map((node) => node.canonicalGroupId).filter(Boolean)),
  ]
    .filter((id) => !nodesById.has(id as string))
    .map(objectId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  if (liveCanonicalIds.length > 0) {
    const canonicalRows = await ResearchEntity.find({ _id: { $in: liveCanonicalIds } })
      .select('_id archived canonicalGroupId archivedReason archivedAt')
      .lean();
    for (const row of canonicalRows) {
      const node = toNode(row);
      nodesById.set(node.id, node);
    }
  }
  return { archivedEntities, nodesById };
}

async function loadArchivedEntityArtifactPlan(
  limit: number,
  scope: ArchivedEntityRepairScope,
  artifactTypes: ArchivedEntityArtifactType[] | undefined,
): Promise<{
  scopedArchivedEntities: number;
  artifacts: ArchivedEntityArtifact[];
  plan: ArchivedEntityArtifactRepairPlan;
}> {
  const { archivedEntities, nodesById } = await loadEntityNodes();
  const dispositions = await resolveArchivedEntityDispositions(archivedEntities, nodesById);
  const scoped = new Map<string, ArchivedEntityDisposition>(
    [...dispositions].filter(([, disposition]) => dispositionMatchesScope(disposition, scope)),
  );
  const scopedIds = [...scoped.keys()]
    .map(objectId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const survivorIds = [
    ...new Set([...scoped.values()].map((disposition) => disposition.survivorId).filter(Boolean)),
  ]
    .map(objectId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const artifacts: ArchivedEntityArtifact[] = [];
  const canonicalArtifacts: ArchivedEntityArtifact[] = [];
  const db = mongoose.connection.db;
  if (!db || scopedIds.length === 0) {
    return {
      scopedArchivedEntities: scoped.size,
      artifacts,
      plan: buildArchivedEntityArtifactRepairPlan({ artifacts, dispositions: scoped }),
    };
  }

  const specs = ARTIFACT_SPECS.filter(
    (spec) => !artifactTypes || artifactTypes.includes(spec.artifactType),
  );
  for (const spec of specs) {
    const remainingLimit = Math.max(0, limit - artifacts.length);
    if (remainingLimit === 0) break;
    const collection = db.collection(spec.collection);
    const [artifactRows, canonicalRows] = await Promise.all([
      collection
        .find({ ...spec.activeMatch, [spec.entityIdPath]: { $in: scopedIds } })
        .sort({ _id: 1 })
        .limit(remainingLimit)
        .project(spec.projection)
        .toArray(),
      survivorIds.length > 0
        ? collection
            .find({ [spec.entityIdPath]: { $in: survivorIds } })
            .project(spec.projection)
            .toArray()
        : Promise.resolve([]),
    ]);
    artifacts.push(...artifactRows.map(spec.toArtifact));
    canonicalArtifacts.push(...canonicalRows.map(spec.toArtifact));
  }

  return {
    scopedArchivedEntities: scoped.size,
    artifacts,
    plan: buildArchivedEntityArtifactRepairPlan({
      artifacts,
      dispositions: scoped,
      canonicalArtifacts,
    }),
  };
}

function planSummary(plan: ArchivedEntityArtifactRepairPlan) {
  return {
    relink: plan.relink.length,
    mergeAndArchive: plan.mergeAndArchive.length,
    archiveWithoutCanonical: plan.archiveWithoutCanonical.length,
    skipped: plan.skipped.length,
  };
}

const ARCHIVED_ENTITY_ARTIFACT_ARCHIVE_REASON = 'research-entity:repair-archived-artifacts';

function retireArtifactUpdate(
  artifactType: ArchivedEntityArtifactType,
  note: string,
  now: Date,
): Record<string, unknown> {
  if (artifactType === 'RoleAssignment') {
    return {
      $set: {
        archived: true,
        reviewStatus: DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS,
        reviewNotes: note,
      },
    };
  }
  return {
    $set: attributedArchiveSet(ARCHIVED_ENTITY_ARTIFACT_ARCHIVE_REASON, {
      lastMaterializedAt: now,
    }),
  };
}

async function retireArtifact(
  artifactType: ArchivedEntityArtifactType,
  id: string,
  note: string,
  now: Date,
): Promise<number> {
  const db = mongoose.connection.db;
  const artifactObjectId = objectId(id);
  if (!db || !artifactObjectId) return 0;
  const result = await db
    .collection(specFor(artifactType).collection)
    .updateOne(
      { _id: artifactObjectId, archived: { $ne: true } },
      retireArtifactUpdate(artifactType, note, now),
    );
  return result.modifiedCount || 0;
}

async function mergeSignalEvidenceIntoSurvivor(
  duplicateId: string,
  canonicalId: string,
  now: Date,
): Promise<number> {
  const db = mongoose.connection.db;
  const duplicateObjectId = objectId(duplicateId);
  const canonicalObjectId = objectId(canonicalId);
  if (!db || !duplicateObjectId || !canonicalObjectId) return 0;
  const collection = db.collection(specFor('AccessSignal').collection);
  const duplicate = await collection.findOne(
    { _id: duplicateObjectId },
    { projection: { 'source.evidenceIds': 1 } },
  );
  const evidenceIds = duplicate?.source?.evidenceIds;
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) return 0;
  const result = await collection.updateOne(
    { _id: canonicalObjectId, archived: { $ne: true } },
    {
      $addToSet: { 'source.evidenceIds': { $each: evidenceIds } },
      $set: { lastMaterializedAt: now },
    },
  );
  return result.modifiedCount || 0;
}

async function applyRepairPlan(plan: ArchivedEntityArtifactRepairPlan) {
  const db = mongoose.connection.db;
  const now = new Date();
  const counts = {
    relinked: 0,
    mergedCanonicalArtifacts: 0,
    archivedMergedDuplicates: 0,
    archivedWithoutCanonical: 0,
  };
  if (!db) return counts;

  for (const item of plan.relink) {
    const spec = specFor(item.artifactType);
    const itemObjectId = objectId(item.id);
    const archivedEntityObjectId = objectId(item.archivedEntityId);
    const canonicalObjectId = objectId(item.canonicalResearchEntityId);
    if (!itemObjectId || !archivedEntityObjectId || !canonicalObjectId) continue;
    const set: Record<string, unknown> = { [spec.entityIdPath]: canonicalObjectId };
    if (item.artifactType === 'AccessSignal') set.lastMaterializedAt = now;
    try {
      const result = await db.collection(spec.collection).updateOne(
        {
          _id: itemObjectId,
          archived: { $ne: true },
          [spec.entityIdPath]: archivedEntityObjectId,
        },
        { $set: set },
      );
      counts.relinked += result.modifiedCount || 0;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      counts.archivedMergedDuplicates += await retireArtifact(
        item.artifactType,
        item.id,
        MERGED_DUPLICATE_ROLE_EDGE_NOTE,
        now,
      );
    }
  }

  for (const item of plan.mergeAndArchive) {
    if (item.artifactType === 'AccessSignal') {
      counts.mergedCanonicalArtifacts += await mergeSignalEvidenceIntoSurvivor(
        item.duplicateId,
        item.canonicalId,
        now,
      );
    }
    counts.archivedMergedDuplicates += await retireArtifact(
      item.artifactType,
      item.duplicateId,
      MERGED_DUPLICATE_ROLE_EDGE_NOTE,
      now,
    );
  }

  for (const item of plan.archiveWithoutCanonical) {
    counts.archivedWithoutCanonical += await retireArtifact(
      item.artifactType,
      item.id,
      NO_CANONICAL_ROLE_EDGE_NOTE,
      now,
    );
  }

  return counts;
}

async function main() {
  const options = parseRepairArchivedEntityArtifactsArgs(process.argv.slice(2));
  const applyGuardInput = {
    apply: options.apply,
    confirmArchivedArtifactRepair: options.confirmArchivedArtifactRepair,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    classes: options.classes,
  };
  assertArchivedEntityArtifactRepairApplyAllowed({ ...applyGuardInput, plannedWrites: 0 });
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:repair-archived-artifacts',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const { scopedArchivedEntities, artifacts, plan } = await loadArchivedEntityArtifactPlan(
    options.limit,
    archivedEntityRepairScopeFromOptions(options),
    options.artifactTypes,
  );
  const plannedWrites = archivedEntityArtifactPlanWriteCount(plan);
  assertArchivedEntityArtifactRepairApplyAllowed({ ...applyGuardInput, plannedWrites });
  const applied = options.apply ? await applyRepairPlan(plan) : undefined;
  const report = buildRepairArchivedEntityArtifactsOutput(
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
    {
      mode: options.apply ? 'apply' : 'dry-run',
      scopedArchivedEntities,
      scannedArtifacts: artifacts.length,
      limitReached: artifacts.length >= options.limit,
      plannedWrites,
      planSummary: planSummary(plan),
      planByClass: summarizeArchivedEntityArtifactRepairPlanByClass(plan),
      plan,
      ...(applied ? { applied } : {}),
    },
  );
  console.log(JSON.stringify(report, null, 2));
  writeRepairArchivedEntityArtifactsOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to repair archived entity artifacts:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
