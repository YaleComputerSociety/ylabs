import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { checkSourceLinkHealth, type SourceLinkHealth } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface FellowshipSourceLinkHealthBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

export function parseFellowshipSourceLinkHealthBackfillArgs(
  argv: string[],
): FellowshipSourceLinkHealthBackfillOptions {
  const options: FellowshipSourceLinkHealthBackfillOptions = {
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
    else if (arg === '--confirm-source-link-health') options.confirm = true;
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
      throw new Error(`Unknown fellowship source-link-health backfill argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function assertFellowshipSourceLinkHealthApplyAllowed(
  options: Pick<FellowshipSourceLinkHealthBackfillOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-source-link-health.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export function normalizeFellowshipSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

export interface FellowshipSourceLinkHealthBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  checked: number;
  updated: number;
  errors: number;
  byStatus: Record<string, number>;
  samples: Array<{
    id: string;
    title: string;
    url: string;
    healthStatus: string;
    httpStatusCode?: number;
  }>;
}

export async function runFellowshipSourceLinkHealthBackfill(options: {
  dryRun: boolean;
  limit?: number;
  checkLink?: (url: string) => Promise<SourceLinkHealth>;
}): Promise<FellowshipSourceLinkHealthBackfillResult> {
  const checkLink = options.checkLink ?? checkSourceLinkHealth;
  const fellowships = await Fellowship.find(
    { archived: { $ne: true } },
    { _id: 1, title: 1, sourceUrl: 1 },
  ).lean();

  const result: FellowshipSourceLinkHealthBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    checked: 0,
    updated: 0,
    errors: 0,
    byStatus: {},
    samples: [],
  };

  const healthCache = new Map<string, SourceLinkHealth>();

  for (const fellowship of fellowships as Array<Record<string, unknown>>) {
    if (options.limit && result.scanned >= options.limit) break;
    result.scanned += 1;
    const url = normalizeFellowshipSourceUrl(fellowship.sourceUrl);
    if (!url) continue;
    try {
      let health = healthCache.get(url);
      if (!health) {
        health = await checkLink(url);
        healthCache.set(url, health);
        result.checked += 1;
      }
      result.byStatus[health.healthStatus] = (result.byStatus[health.healthStatus] ?? 0) + 1;
      const sourceLinkHealth = {
        url,
        healthStatus: health.healthStatus,
        ...(typeof health.httpStatusCode === 'number'
          ? { httpStatusCode: health.httpStatusCode }
          : {}),
        checkedAt: new Date(),
      };
      if (result.samples.length < 25 && health.healthStatus !== 'HEALTHY') {
        result.samples.push({
          id: String(fellowship._id ?? ''),
          title: String(fellowship.title ?? ''),
          url,
          healthStatus: health.healthStatus,
          ...(typeof health.httpStatusCode === 'number'
            ? { httpStatusCode: health.httpStatusCode }
            : {}),
        });
      }
      if (!options.dryRun) {
        await Fellowship.updateOne({ _id: fellowship._id }, { $set: { sourceLinkHealth } });
      }
      result.updated += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `fellowship source-link-health backfill failed for ${String(fellowship._id)}:`,
        sanitizeLogValue(error),
      );
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseFellowshipSourceLinkHealthBackfillArgs(process.argv.slice(2));
  assertFellowshipSourceLinkHealthApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfill:fellowship-source-link-health',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runFellowshipSourceLinkHealthBackfill({
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
      console.log(`Saved fellowship source-link-health backfill report to ${safeOutput}`);
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
