import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import {
  buildArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifact,
  type ArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifactType,
} from './repairArchivedEntityArtifactsCore';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

interface ArtifactSpec {
  artifactType: ArchivedEntityArtifactType;
  collection: string;
  activeMatch?: Record<string, unknown>;
}

export interface RepairArchivedEntityArtifactsCliOptions {
  apply: boolean;
  confirmArchivedArtifactRepair: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
}

const __filename = fileURLToPath(import.meta.url);

const ARTIFACT_SPECS: ArtifactSpec[] = [
  {
    artifactType: 'ResearchEntityMember',
    collection: 'research_entity_members',
    activeMatch: { isCurrentMember: { $ne: false } },
  },
  { artifactType: 'EntryPathway', collection: 'entry_pathways' },
  { artifactType: 'AccessSignal', collection: 'access_signals' },
  { artifactType: 'ContactRoute', collection: 'contact_routes' },
  { artifactType: 'PostedOpportunity', collection: 'posted_opportunities' },
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
}: {
  apply: boolean;
  confirmArchivedArtifactRepair?: boolean;
  limitProvided?: boolean;
  maxApply: number;
  plannedWrites: number;
}): void {
  if (!apply) return;
  if (limitProvided === false) {
    throw new Error('--limit is required when --apply is set for research-entity:repair-archived-artifacts');
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

async function collectionExists(collectionName: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const matches = await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function loadArchivedEntityArtifactPlan(limit: number): Promise<{
  artifacts: ArchivedEntityArtifact[];
  canonicalArtifacts: ArchivedEntityArtifact[];
  plan: ArchivedEntityArtifactRepairPlan;
}> {
  const archivedEntities = await ResearchEntity.find({
    archived: true,
  })
    .select('_id canonicalGroupId')
    .lean();
  const canonicalByArchivedId = new Map(
    archivedEntities.map((entity: any) => [stringId(entity._id), stringId(entity.canonicalGroupId)]),
  );
  const archivedIds = [...canonicalByArchivedId.keys()]
    .map(objectId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const canonicalIds = [...new Set(canonicalByArchivedId.values())]
    .map(objectId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const artifacts: ArchivedEntityArtifact[] = [];
  const canonicalArtifacts: ArchivedEntityArtifact[] = [];
  const db = mongoose.connection.db;
  if (!db || archivedIds.length === 0) {
    return {
      artifacts,
      canonicalArtifacts,
      plan: buildArchivedEntityArtifactRepairPlan({ artifacts, canonicalArtifacts }),
    };
  }

  for (const spec of ARTIFACT_SPECS) {
    const remainingLimit = Math.max(0, limit - artifacts.length);
    if (remainingLimit === 0) break;
    if (!(await collectionExists(spec.collection))) continue;
    const collection = db.collection(spec.collection);
    const [artifactRows, canonicalRows] = await Promise.all([
      collection
        .find({
          archived: { $ne: true },
          ...(spec.activeMatch || {}),
          researchEntityId: { $in: archivedIds },
        })
        .limit(remainingLimit)
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
          userId: 1,
          role: 1,
        })
        .toArray(),
      collection
        .find({
          archived: { $ne: true },
          ...(spec.activeMatch || {}),
          researchEntityId: { $in: canonicalIds },
        })
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
          userId: 1,
          role: 1,
        })
        .toArray(),
    ]);

    for (const row of artifactRows) {
      const researchEntityId = stringId(row.researchEntityId);
      artifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row._id),
        researchEntityId,
        canonicalResearchEntityId: canonicalByArchivedId.get(researchEntityId) || '',
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
        userId: stringId(row.userId),
        role: stringId(row.role),
      });
    }

    for (const row of canonicalRows) {
      const researchEntityId = stringId(row.researchEntityId);
      canonicalArtifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row._id),
        researchEntityId,
        canonicalResearchEntityId: researchEntityId,
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
        userId: stringId(row.userId),
        role: stringId(row.role),
      });
    }
  }

  return {
    artifacts,
    canonicalArtifacts,
    plan: buildArchivedEntityArtifactRepairPlan({ artifacts, canonicalArtifacts }),
  };
}

function planWriteCount(plan: ArchivedEntityArtifactRepairPlan): number {
  return plan.relink.length + plan.mergeAndArchive.length + plan.archiveWithoutCanonical.length;
}

function planSummary(plan: ArchivedEntityArtifactRepairPlan) {
  return {
    relink: plan.relink.length,
    mergeAndArchive: plan.mergeAndArchive.length,
    archiveWithoutCanonical: plan.archiveWithoutCanonical.length,
    skipped: plan.skipped.length,
  };
}

async function archiveArtifact(
  collectionName: string,
  id: string,
  now: Date,
  canonicalResearchEntityId?: string,
) {
  const db = mongoose.connection.db;
  const artifactObjectId = objectId(id);
  if (!db || !artifactObjectId) return 0;
  const set: Record<string, unknown> = {
    archived: true,
    lastMaterializedAt: now,
  };
  const canonicalObjectId = objectId(canonicalResearchEntityId);
  if (canonicalObjectId) {
    set.researchEntityId = canonicalObjectId;
  }
  const result = await db.collection(collectionName).updateOne({ _id: artifactObjectId }, { $set: set });
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
    childReferencesRelinked: 0,
  };
  if (!db) return counts;

  for (const item of plan.relink) {
    const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === item.artifactType);
    const itemObjectId = objectId(item.id);
    const canonicalObjectId = objectId(item.canonicalResearchEntityId);
    if (!spec || !itemObjectId || !canonicalObjectId) continue;
    try {
      const result = await db.collection(spec.collection).updateOne(
        { _id: itemObjectId, archived: { $ne: true } },
        {
          $set: {
            researchEntityId: canonicalObjectId,
            lastMaterializedAt: now,
          },
        },
      );
      counts.relinked += result.modifiedCount || 0;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      counts.archivedWithoutCanonical += await archiveArtifact(
        spec.collection,
        item.id,
        now,
        item.canonicalResearchEntityId,
      );
    }
  }

  for (const item of plan.mergeAndArchive) {
    const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === item.artifactType);
    const duplicateObjectId = objectId(item.duplicateId);
    const canonicalObjectId = objectId(item.canonicalId);
    if (!spec || !duplicateObjectId || !canonicalObjectId) continue;
    const collection = db.collection(spec.collection);
    const duplicate = await collection.findOne(
      { _id: duplicateObjectId },
      { projection: { sourceEvidenceIds: 1, sourceUrls: 1 } },
    );
    const addToSet: Record<string, { $each: unknown[] }> = {};
    if (Array.isArray(duplicate?.sourceEvidenceIds) && duplicate.sourceEvidenceIds.length > 0) {
      addToSet.sourceEvidenceIds = { $each: duplicate.sourceEvidenceIds };
    }
    if (Array.isArray(duplicate?.sourceUrls) && duplicate.sourceUrls.length > 0) {
      addToSet.sourceUrls = { $each: duplicate.sourceUrls };
    }
    if (Object.keys(addToSet).length > 0) {
      const result = await collection.updateOne(
        { _id: canonicalObjectId },
        { $addToSet: addToSet, $set: { lastMaterializedAt: now } },
      );
      counts.mergedCanonicalArtifacts += result.modifiedCount || 0;
    }

    if (item.artifactType === 'EntryPathway') {
      const childSpecs = [
        { collection: 'access_signals', field: 'entryPathwayId' },
        { collection: 'contact_routes', field: 'entryPathwayId' },
        { collection: 'posted_opportunities', field: 'entryPathwayId' },
      ];
      for (const child of childSpecs) {
        if (!(await collectionExists(child.collection))) continue;
        const result = await db.collection(child.collection).updateMany(
          { [child.field]: duplicateObjectId, archived: { $ne: true } },
          { $set: { [child.field]: canonicalObjectId, lastMaterializedAt: now } },
        );
        counts.childReferencesRelinked += result.modifiedCount || 0;
      }
    }

    counts.archivedMergedDuplicates += await archiveArtifact(
      spec.collection,
      item.duplicateId,
      now,
    );
  }

  for (const item of plan.archiveWithoutCanonical) {
    const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === item.artifactType);
    if (!spec) continue;
    counts.archivedWithoutCanonical += await archiveArtifact(spec.collection, item.id, now);
  }

  return counts;
}

async function main() {
  const options = parseRepairArchivedEntityArtifactsArgs(process.argv.slice(2));
  assertArchivedEntityArtifactRepairApplyAllowed({
    apply: options.apply,
    confirmArchivedArtifactRepair: options.confirmArchivedArtifactRepair,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedWrites: 0,
  });
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:repair-archived-artifacts',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const { artifacts, plan } = await loadArchivedEntityArtifactPlan(options.limit);
  assertArchivedEntityArtifactRepairApplyAllowed({
    apply: options.apply,
    confirmArchivedArtifactRepair: options.confirmArchivedArtifactRepair,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedWrites: planWriteCount(plan),
  });
  const applied = options.apply ? await applyRepairPlan(plan) : undefined;
  const report = buildRepairArchivedEntityArtifactsOutput(
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
    {
      mode: options.apply ? 'apply' : 'dry-run',
      scannedArtifacts: artifacts.length,
      plannedWrites: planWriteCount(plan),
      planSummary: planSummary(plan),
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
