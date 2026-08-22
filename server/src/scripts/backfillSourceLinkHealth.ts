import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { checkSourceLinkHealth, type SourceLinkHealth } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { collectSourceLinkHealthCandidates } from './backfillSourceLinkHealthCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface SourceLinkHealthBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

export function parseSourceLinkHealthBackfillArgs(argv: string[]): SourceLinkHealthBackfillOptions {
  const options: SourceLinkHealthBackfillOptions = {
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
      throw new Error(`Unknown source-link-health backfill argument: ${arg}`);
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

export function assertSourceLinkHealthApplyAllowed(
  options: Pick<SourceLinkHealthBackfillOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-source-link-health.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface SourceLinkHealthBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  checked: number;
  updated: number;
  errors: number;
  byStatus: Record<string, number>;
  samples: Array<{
    slug: string;
    url: string;
    healthStatus: string;
    httpStatusCode?: number;
  }>;
}

export async function runSourceLinkHealthBackfill(options: {
  dryRun: boolean;
  limit?: number;
  checkLink?: (url: string) => Promise<SourceLinkHealth>;
}): Promise<SourceLinkHealthBackfillResult> {
  const checkLink = options.checkLink ?? checkSourceLinkHealth;
  const entities = await ResearchEntity.find(
    { archived: { $ne: true } },
    { _id: 1, slug: 1, websiteUrl: 1, website: 1, sourceUrls: 1 },
  ).lean();

  const result: SourceLinkHealthBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    checked: 0,
    updated: 0,
    errors: 0,
    byStatus: {},
    samples: [],
  };

  const healthCache = new Map<string, SourceLinkHealth>();

  for (const entity of entities as Array<Record<string, unknown>>) {
    if (options.limit && result.scanned >= options.limit) break;
    result.scanned += 1;
    try {
      const signalRows = await Signal.find({
        researchEntityId: entity._id,
        type: { $in: accessSignalTypes },
        archived: false,
      })
        .select('sourceUrl')
        .lean();
      const signalSourceUrls = (signalRows as Array<{ sourceUrl?: unknown }>).map(
        (row) => row.sourceUrl,
      );
      const candidates = collectSourceLinkHealthCandidates(entity, signalSourceUrls);
      if (candidates.length === 0) continue;

      const now = new Date();
      const sourceLinkHealth: Array<{
        url: string;
        healthStatus: string;
        httpStatusCode?: number;
        checkedAt: Date;
      }> = [];
      for (const url of candidates) {
        let health = healthCache.get(url);
        if (!health) {
          health = await checkLink(url);
          healthCache.set(url, health);
          result.checked += 1;
        }
        result.byStatus[health.healthStatus] = (result.byStatus[health.healthStatus] ?? 0) + 1;
        sourceLinkHealth.push({
          url,
          healthStatus: health.healthStatus,
          ...(typeof health.httpStatusCode === 'number'
            ? { httpStatusCode: health.httpStatusCode }
            : {}),
          checkedAt: now,
        });
        if (result.samples.length < 25 && health.healthStatus !== 'HEALTHY') {
          result.samples.push({
            slug: String(entity.slug ?? ''),
            url,
            healthStatus: health.healthStatus,
            ...(typeof health.httpStatusCode === 'number'
              ? { httpStatusCode: health.httpStatusCode }
              : {}),
          });
        }
      }

      if (!options.dryRun) {
        await ResearchEntity.updateOne({ _id: entity._id }, { $set: { sourceLinkHealth } });
      }
      result.updated += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `source-link-health backfill failed for ${String(entity.slug ?? entity._id)}:`,
        sanitizeLogValue(error),
      );
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseSourceLinkHealthBackfillArgs(process.argv.slice(2));
  assertSourceLinkHealthApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfill:source-link-health',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runSourceLinkHealthBackfill({
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
      console.log(`Saved source-link-health backfill report to ${safeOutput}`);
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
