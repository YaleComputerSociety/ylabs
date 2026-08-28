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
  planResearchEntityKindResync,
  summarizeResearchEntityKindResync,
  type ResearchEntityKindPlanRow,
} from './resyncResearchEntityKindCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SYNC_BATCH_SIZE = 200;

export interface ResearchEntityKindResyncOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function parseResearchEntityKindResyncArgs(argv: string[]): ResearchEntityKindResyncOptions {
  const options: ResearchEntityKindResyncOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-kind-resync') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown research-entity:resync-kind argument: ${arg}`);
    }
  }
  return options;
}

export function assertResearchEntityKindResyncApplyAllowed(
  options: Pick<ResearchEntityKindResyncOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-kind-resync.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface ResearchEntityKindResyncResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  planned: number;
  updated: number;
  synced: number;
  errors: number;
  byEntityType: Record<string, number>;
  samples: ResearchEntityKindPlanRow[];
}

export async function runResearchEntityKindResync(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<ResearchEntityKindResyncResult> {
  const query = ResearchEntity.find({}, { _id: 1, slug: 1, entityType: 1, kind: 1 }).sort({
    _id: 1,
  });
  if (options.limit) query.limit(options.limit);

  const candidates = (await query.lean()) as Array<Record<string, unknown>>;
  const plan = planResearchEntityKindResync(
    candidates.map((doc) => ({
      id: doc._id,
      slug: typeof doc.slug === 'string' ? doc.slug : undefined,
      entityType: typeof doc.entityType === 'string' ? doc.entityType : undefined,
      kind: typeof doc.kind === 'string' ? doc.kind : undefined,
    })),
  );
  const summary = summarizeResearchEntityKindResync(candidates.length, plan);

  const result: ResearchEntityKindResyncResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: summary.scanned,
    planned: summary.planned,
    updated: 0,
    synced: 0,
    errors: 0,
    byEntityType: summary.byEntityType,
    samples: plan.slice(0, 25),
  };

  if (options.dryRun || plan.length === 0) return result;

  for (let i = 0; i < plan.length; i += SYNC_BATCH_SIZE) {
    const batch = plan.slice(i, i + SYNC_BATCH_SIZE);
    try {
      await ResearchEntity.bulkWrite(
        batch.map((row) => ({
          updateOne: { filter: { _id: row.id }, update: { $set: { kind: row.kindTo } } },
        })),
      );
      result.updated += batch.length;
      const fresh = await ResearchEntity.find({ _id: { $in: batch.map((row) => row.id) } }).lean();
      await syncEntities('researchEntity', fresh);
      result.synced += fresh.length;
    } catch (error) {
      result.errors += batch.length;
      console.error('research-entity kind resync batch failed:', sanitizeLogValue(error));
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseResearchEntityKindResyncArgs(process.argv.slice(2));
  assertResearchEntityKindResyncApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity:resync-kind',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runResearchEntityKindResync({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved research-entity kind resync report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
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
