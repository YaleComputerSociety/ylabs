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
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface ArtifactSpec {
  artifactType: ArchivedEntityArtifactType;
  collection: string;
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
  { artifactType: 'EntryPathway', collection: 'entry_pathways' },
  { artifactType: 'AccessSignal', collection: 'access_signals' },
  { artifactType: 'ContactRoute', collection: 'contact_routes' },
  { artifactType: 'PostedOpportunity', collection: 'posted_opportunities' },
];

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
      const output = arg.slice('--output='.length).trim();
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
      continue;
    }
    if (arg === '--output') {
      const output = argv[index + 1]?.trim();
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
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
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
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
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof (value as { toHexString?: () => string }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString();
  }
  return String(value);
}

function objectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
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
    canonicalGroupId: { $exists: true, $ne: null },
  })
    .select('_id canonicalGroupId')
    .lean();
  const canonicalByArchivedId = new Map(
    archivedEntities.map((entity: any) => [stringId(entity._id), stringId(entity.canonicalGroupId)]),
  );
  const archivedIds = [...canonicalByArchivedId.keys()]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map(objectId);
  const canonicalIds = [...new Set(canonicalByArchivedId.values())]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map(objectId);
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
          researchEntityId: { $in: archivedIds },
        })
        .limit(remainingLimit)
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
        })
        .toArray(),
      collection
        .find({
          archived: { $ne: true },
          researchEntityId: { $in: canonicalIds },
        })
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
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
  if (!db || !mongoose.Types.ObjectId.isValid(id)) return 0;
  const set: Record<string, unknown> = {
    archived: true,
    lastMaterializedAt: now,
  };
  if (canonicalResearchEntityId && mongoose.Types.ObjectId.isValid(canonicalResearchEntityId)) {
    set.researchEntityId = objectId(canonicalResearchEntityId);
  }
  const result = await db.collection(collectionName).updateOne({ _id: objectId(id) }, { $set: set });
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
    if (!spec || !mongoose.Types.ObjectId.isValid(item.id)) continue;
    try {
      const result = await db.collection(spec.collection).updateOne(
        { _id: objectId(item.id), archived: { $ne: true } },
        {
          $set: {
            researchEntityId: objectId(item.canonicalResearchEntityId),
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
    if (!spec) continue;
    const collection = db.collection(spec.collection);
    const duplicate = await collection.findOne(
      { _id: objectId(item.duplicateId) },
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
        { _id: objectId(item.canonicalId) },
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
          { [child.field]: objectId(item.duplicateId), archived: { $ne: true } },
          { $set: { [child.field]: objectId(item.canonicalId), lastMaterializedAt: now } },
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
      console.error('Failed to repair archived entity artifacts:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
