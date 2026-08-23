/**
 * Repairs research-entity `shortDescription` values that are a semantically
 * empty "Studies <generic head noun>." summary (e.g. "Studies the field.",
 * "Studies the organism.") by rebuilding the card from the entity's own clean
 * `researchAreas[]` instead (issue #952). Fail closed: an entity without a
 * usable research-area topic is left untouched rather than blanked.
 *
 * Dry-run-first. Apply requires `--confirm-vacuous-focus-repair`, is blocked
 * against production by `assertScriptApplyAllowed`, and only rewrites entities
 * whose card actually changes. Meilisearch is re-synced for the changed
 * entities after an apply so the search card matches Mongo.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planVacuousFocusRepairRow,
  summarizeVacuousFocusRepair,
  type VacuousFocusRepairPlanRow,
  type VacuousFocusRepairSummary,
} from './repairVacuousFocusShortDescriptionsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface VacuousFocusRepairCliOptions {
  dryRun: boolean;
  confirm: boolean;
  syncMeili: boolean;
  limit?: number;
  batchSize: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseVacuousFocusRepairArgs(argv: string[]): VacuousFocusRepairCliOptions {
  const options: VacuousFocusRepairCliOptions = {
    dryRun: true,
    confirm: false,
    syncMeili: true,
    batchSize: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-vacuous-focus-repair') options.confirm = true;
    else if (arg === '--no-sync') options.syncMeili = false;
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parsePositiveInt(arg.slice('--batch-size='.length), '--batch-size');
    } else if (arg === '--batch-size') {
      options.batchSize = parsePositiveInt(argv[i + 1], '--batch-size');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export interface VacuousFocusRepairResult {
  mode: 'dry-run' | 'apply';
  summary: VacuousFocusRepairSummary;
  changes: VacuousFocusRepairPlanRow[];
  meiliSynced: number;
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  researchAreas?: unknown;
}

export async function runVacuousFocusRepair(options: {
  dryRun: boolean;
  syncMeili: boolean;
  limit?: number;
  batchSize: number;
}): Promise<VacuousFocusRepairResult> {
  const query = ResearchEntity.find({
    archived: { $ne: true },
    shortDescription: { $type: 'string' },
  })
    .select('_id slug name shortDescription researchAreas')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const rows = entities.map((entity) =>
    planVacuousFocusRepairRow({
      id: String(entity._id),
      slug: entity.slug,
      name: entity.name,
      shortDescription: entity.shortDescription,
      researchAreas: entity.researchAreas,
    }),
  );
  const changedRows = rows.filter((row) => row.changed);

  let meiliSynced = 0;
  if (!options.dryRun && changedRows.length > 0) {
    for (let i = 0; i < changedRows.length; i += options.batchSize) {
      const batch = changedRows.slice(i, i + options.batchSize);
      await ResearchEntity.bulkWrite(
        batch.map((row) => ({
          updateOne: {
            filter: { _id: row.id },
            update: { $set: { shortDescription: row.after } },
          },
        })),
      );
    }
    if (options.syncMeili) {
      const changedIds = changedRows.map((row) => row.id);
      const freshDocs = await ResearchEntity.find({ _id: { $in: changedIds } }).lean();
      await syncEntities('researchEntity', freshDocs);
      meiliSynced = freshDocs.length;
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeVacuousFocusRepair(rows),
    changes: changedRows,
    meiliSynced,
  };
}

async function main(): Promise<void> {
  const options = parseVacuousFocusRepairArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-vacuous-focus-repair.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'vacuous-focus short-description repair',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runVacuousFocusRepair({
      dryRun: options.dryRun,
      syncMeili: options.syncMeili,
      limit: options.limit,
      batchSize: options.batchSize,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        syncMeili: options.syncMeili,
        limit: options.limit,
        batchSize: options.batchSize,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved vacuous-focus repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ summary: result.summary, meiliSynced: result.meiliSynced }, null, 2));
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
