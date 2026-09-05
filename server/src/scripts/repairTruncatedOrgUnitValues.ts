import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  getOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
} from '../scrapers/orgUnitCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planTruncatedValueRepair,
  summarizeTruncatedValueRepair,
  type TruncatedValueRepairPlanRow,
} from './repairTruncatedOrgUnitValuesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:repair-truncated-org-unit-values';

export interface TruncatedValueRepairCliOptions {
  dryRun: boolean;
  confirmTruncatedValueRepair: boolean;
  output?: string;
}

export function parseTruncatedValueRepairArgs(argv: string[]): TruncatedValueRepairCliOptions {
  const options: TruncatedValueRepairCliOptions = {
    dryRun: true,
    confirmTruncatedValueRepair: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-truncated-value-repair') options.confirmTruncatedValueRepair = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function runTruncatedValueRepair(options: { dryRun: boolean }): Promise<{
  mode: 'dry-run' | 'apply';
  summary: ReturnType<typeof summarizeTruncatedValueRepair>;
  changedRows: TruncatedValueRepairPlanRow[];
}> {
  resetOrgUnitCanonicalizerCache();
  const canonicalizer = await getOrgUnitCanonicalizer();
  const canonicalizeDepartment = (value: string): string | null =>
    canonicalizer.canonicalizeDepartments([value]).values[0] || null;

  const entities = (await ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug departments orgAffiliationLabels studentVisibilityTier')
    .lean()) as any[];
  const byId = new Map(entities.map((entity) => [String(entity._id), entity]));
  const bySlug = new Map(entities.map((entity) => [entity.slug, entity]));

  const rawValuesBySlug = new Map<string, string[]>();
  const observations = (await Observation.find({
    field: 'departments',
    superseded: { $ne: true },
  })
    .select('entityId entityKey value')
    .lean()) as any[];
  for (const observation of observations) {
    const entity =
      (observation.entityId && byId.get(String(observation.entityId))) ||
      (observation.entityKey && bySlug.get(observation.entityKey));
    if (!entity || !Array.isArray(observation.value)) continue;
    const values = rawValuesBySlug.get(entity.slug) || [];
    for (const value of observation.value) if (typeof value === 'string') values.push(value);
    rawValuesBySlug.set(entity.slug, values);
  }

  const rows = [...rawValuesBySlug.entries()].map(([slug, values]) =>
    planTruncatedValueRepair(bySlug.get(slug), values, canonicalizeDepartment),
  );
  const changedRows = rows.filter((row) => row.changed);

  if (!options.dryRun && changedRows.length > 0) {
    await ResearchEntity.bulkWrite(
      changedRows.map((row) => ({
        updateOne: { filter: { slug: row.slug }, update: { $set: row.update } },
      })),
    );
    const updated = await ResearchEntity.find({
      slug: { $in: changedRows.map((row) => row.slug) },
    }).lean();
    await syncEntities('researchEntity', updated as any);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeTruncatedValueRepair(rows),
    changedRows,
  };
}

async function main(): Promise<void> {
  const options = parseTruncatedValueRepairArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirmTruncatedValueRepair) {
    throw new Error(`${SCRIPT_NAME} apply mode requires --confirm-truncated-value-repair.`);
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runTruncatedValueRepair({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, ...result },
          null,
          2,
        ),
      );
      console.log(`Saved truncated-value repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    for (const row of result.changedRows.filter(
      (candidate) => candidate.tier === 'student_ready',
    )) {
      console.log(
        `  served ${row.slug}: departments ${JSON.stringify(row.beforeDepartments)} -> ${JSON.stringify(row.afterDepartments)}`,
      );
    }
    if (apply && result.summary.changed > 0) {
      console.log(
        'Run student-visibility:gate next and take the before/after from that dry-run rather than from a census.',
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
