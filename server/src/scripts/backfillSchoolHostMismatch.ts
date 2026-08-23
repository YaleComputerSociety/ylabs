import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  DISJOINT_SCHOOLS,
  planSchoolHostMismatchRow,
  summarizeSchoolHostMismatch,
  type SchoolHostMismatchPlanRow,
  type SchoolHostMismatchSummary,
} from './backfillSchoolHostMismatchCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface SchoolHostMismatchCliOptions {
  dryRun: boolean;
  confirm: boolean;
  limit?: number;
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

export function parseSchoolHostMismatchArgs(argv: string[]): SchoolHostMismatchCliOptions {
  const options: SchoolHostMismatchCliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm') {
      options.confirm = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
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

export interface SchoolHostMismatchResult {
  mode: 'dry-run' | 'apply';
  summary: SchoolHostMismatchSummary;
  changes: SchoolHostMismatchPlanRow[];
}

export async function runSchoolHostMismatchBackfill(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<SchoolHostMismatchResult> {
  resetOrgUnitCanonicalizerCache();

  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    school: { $in: DISJOINT_SCHOOLS },
  };

  const query = ResearchEntity.find(filter)
    .select('_id slug name school schools departments websiteUrl sourceUrls fullDescription researchAreas entityType')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = await query.lean();

  const rows: SchoolHostMismatchPlanRow[] = [];
  for (const entity of entities) {
    const row = await planSchoolHostMismatchRow({ id: String(entity._id), ...entity });
    if (row) rows.push(row);
  }

  if (!options.dryRun && rows.length > 0) {
    await ResearchEntity.bulkWrite(
      rows.map((row) => ({
        updateOne: { filter: { _id: row.id }, update: { $set: row.update } },
      })),
    );
    const updatedDocs = await ResearchEntity.find({ _id: { $in: rows.map((row) => row.id) } }).lean();
    await syncEntities('researchEntity', updatedDocs);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeSchoolHostMismatch(rows),
    changes: rows,
  };
}

async function main(): Promise<void> {
  const options = parseSchoolHostMismatchArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity school/host-mismatch backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runSchoolHostMismatchBackfill({ dryRun: options.dryRun, limit: options.limit });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.limit },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved school/host-mismatch backfill report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(JSON.stringify(result.changes, null, 2));
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
