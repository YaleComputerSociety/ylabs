import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { buildRematerializeFieldChanges } from './rematerializeResearchEntitiesCore';
import {
  MERGE_REMATERIALIZE_AUDITED_FIELDS,
  assertMergeRematerializeApplyAllowed,
  classifyMergeRematerializeChanges,
  parseMergeRematerializeDriftArgs,
  summarizeMergeRematerializeDrift,
  type MergeRematerializeEntityReport,
} from './mergeRematerializeDriftCore';
import { rematerializeMergeCanonicalFillOnly } from '../services/researchEntityMergeRematerializeService';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SELECT_FIELDS = ['slug', ...MERGE_REMATERIALIZE_AUDITED_FIELDS].join(' ');

async function loadMergeSurvivors(limit: number, slugs: string[]) {
  const twinCounts = await ResearchEntity.aggregate<{
    _id: mongoose.Types.ObjectId;
    twins: number;
  }>([
    { $match: { archived: true, canonicalGroupId: { $ne: null } } },
    { $group: { _id: '$canonicalGroupId', twins: { $sum: 1 } } },
  ]);
  const twinsById = new Map(twinCounts.map((row) => [String(row._id), row.twins]));

  const filter: Record<string, unknown> = {
    _id: { $in: twinCounts.map((row) => row._id) },
    archived: { $ne: true },
  };
  if (slugs.length > 0) filter.slug = { $in: slugs };

  const survivors = await ResearchEntity.find(filter)
    .select(SELECT_FIELDS)
    .sort({ slug: 1 })
    .limit(limit)
    .lean<Array<Record<string, unknown> & { _id: mongoose.Types.ObjectId; slug?: string }>>();

  return survivors.map((survivor) => ({
    survivor,
    archivedTwinCount: twinsById.get(String(survivor._id)) || 0,
  }));
}

async function auditSurvivor(
  survivor: Record<string, unknown> & { _id: mongoose.Types.ObjectId; slug?: string },
  archivedTwinCount: number,
  apply: boolean,
): Promise<MergeRematerializeEntityReport> {
  const entityId = String(survivor._id);
  if (apply) {
    const filled = await rematerializeMergeCanonicalFillOnly(entityId);
    return {
      entityId,
      slug: survivor.slug,
      archivedTwinCount,
      skipped: filled.skipped,
      filledFields: filled.filledFields,
      changes: classifyMergeRematerializeChanges(
        (filled.filledFields || []).map((field) => ({
          field,
          before: survivor[field],
          after: undefined,
        })),
      ).map((change) => ({ ...change, kind: 'recovered' as const })),
    };
  }
  const result = await materializeEntity('researchEntity', { entityId }, { dryRun: true });
  if (result.skipped) {
    return {
      entityId,
      slug: survivor.slug,
      archivedTwinCount,
      skipped: result.skipped,
      changes: [],
    };
  }
  const changes = buildRematerializeFieldChanges(
    survivor,
    result.plannedSet || {},
    result.plannedUnset || {},
    MERGE_REMATERIALIZE_AUDITED_FIELDS,
  );
  return {
    entityId,
    slug: survivor.slug,
    archivedTwinCount,
    changes: classifyMergeRematerializeChanges(changes),
  };
}

async function main() {
  const args = parseMergeRematerializeDriftArgs(process.argv.slice(2));
  assertMergeRematerializeApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:audit-merge-rematerialize-drift',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();

  const survivors = await loadMergeSurvivors(args.limit, args.slugs);
  const entities: MergeRematerializeEntityReport[] = [];
  for (const { survivor, archivedTwinCount } of survivors) {
    entities.push(await auditSurvivor(survivor, archivedTwinCount, args.apply));
  }

  const summary = summarizeMergeRematerializeDrift(entities);
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply-fill-only' : 'read-only',
    auditedFields: MERGE_REMATERIALIZE_AUDITED_FIELDS,
    requestedLimit: args.limit,
    requestedSlugs: args.slugs,
    mergeSurvivorsSelected: survivors.length,
    summary,
    entities,
  };

  console.log(JSON.stringify({ ...report, entities: undefined }, null, 2));
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${args.output}`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to audit merge rematerialize drift:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
