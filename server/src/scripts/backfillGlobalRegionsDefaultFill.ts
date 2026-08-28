import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
} from './scriptWriteGuards';
import {
  planGlobalRegionsDefaultFillCollapse,
  type GlobalRegionsDoc,
} from './backfillGlobalRegionsDefaultFillCore';

dotenv.config();

const SCRIPT_NAME = 'programs:backfill-global-regions';

export interface BackfillGlobalRegionsCliOptions {
  apply: boolean;
  confirmGlobalRegionsBackfill: boolean;
  limit: number;
  output?: string;
}

export function parseBackfillGlobalRegionsArgs(argv: string[]): BackfillGlobalRegionsCliOptions {
  const options: BackfillGlobalRegionsCliOptions = {
    apply: false,
    confirmGlobalRegionsBackfill: false,
    limit: Infinity,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-global-regions-backfill') {
      options.confirmGlobalRegionsBackfill = true;
      continue;
    }
    if (arg.startsWith('--confirm-global-regions-backfill=')) {
      throw new Error('--confirm-global-regions-backfill does not accept a value');
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown global regions backfill argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function assertDevelopmentTarget(mongoUrl: string | undefined): void {
  let database = '';
  try {
    database = new URL(mongoUrl || '').pathname.replace(/^\//, '');
  } catch {
    database = '';
  }
  if (database.toLowerCase() !== 'development') {
    throw new Error(
      `${SCRIPT_NAME} only applies against the Development database; refusing target "${database || '(unknown)'}".`,
    );
  }
}

export function assertBackfillGlobalRegionsApplyAllowed(
  options: Pick<BackfillGlobalRegionsCliOptions, 'apply' | 'confirmGlobalRegionsBackfill' | 'limit'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error(`--limit is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (options.apply && !options.confirmGlobalRegionsBackfill) {
    throw new Error(`--confirm-global-regions-backfill is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (options.apply) {
    assertDevelopmentTarget(mongoUrl);
  }
  return assertScriptApplyAllowed({ apply: options.apply, scriptName: SCRIPT_NAME, mongoUrl, env });
}

async function main() {
  const options = parseBackfillGlobalRegionsArgs(process.argv.slice(2));
  const guard = assertBackfillGlobalRegionsApplyAllowed(options, process.env, process.env.MONGODBURL);
  await initializeConnections();

  const query = Fellowship.find({ archived: { $ne: true } }).sort({ title: 1 });
  if (Number.isFinite(options.limit)) query.limit(options.limit);
  const rows = await query.select({ title: 1, globalRegions: 1 }).lean();

  const docs: GlobalRegionsDoc[] = rows.map((row) => ({
    id: serializedDocumentId(row._id) || '',
    title: row.title || '',
    globalRegions: Array.isArray(row.globalRegions) ? row.globalRegions : [],
  }));

  const plan = planGlobalRegionsDefaultFillCollapse(docs);

  if (options.apply) {
    for (const target of plan.toCollapse) {
      await Fellowship.updateOne({ _id: target.id }, { $set: { globalRegions: [] } });
    }
  }

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scanned: plan.scanned,
    collapsed: plan.toCollapse.length,
    histogramBefore: plan.histogramBefore,
    histogramAfter: plan.histogramAfter,
    sample: plan.toCollapse.slice(0, 20),
    options,
  };

  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill global regions default fill:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
