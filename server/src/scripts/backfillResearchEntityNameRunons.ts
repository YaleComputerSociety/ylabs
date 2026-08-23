import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntity } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { stripTrailingResearchHomeDescription } from '../utils/researchEntityNameNormalization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const RESEARCH_HOME_HEAD_NOUN_PREFILTER =
  /\b(?:labs?|laborator|cent(?:er|re)s?|institutes?|programme?s?|initiatives?|groups?|projects?|collaboratives?|consorti|networks?|clinics?|cores?)\b\s+\S/i;

export interface ResearchEntityNameRunonBackfillOptions {
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

export function parseResearchEntityNameRunonBackfillArgs(
  argv: string[],
): ResearchEntityNameRunonBackfillOptions {
  const options: ResearchEntityNameRunonBackfillOptions = {
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
    else if (arg === '--confirm-name-runons') options.confirm = true;
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
      throw new Error(`Unknown backfill:research-entity-name-runons argument: ${arg}`);
    }
  }
  return options;
}

export function assertResearchEntityNameRunonApplyAllowed(
  options: Pick<ResearchEntityNameRunonBackfillOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-name-runons.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface ResearchEntityNameRunonBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  updated: number;
  synced: number;
  errors: number;
  samples: Array<{
    slug: string;
    field: 'name' | 'displayName';
    from: string;
    to: string;
  }>;
}

export async function runResearchEntityNameRunonBackfill(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<ResearchEntityNameRunonBackfillResult> {
  const entities = await ResearchEntity.find(
    {
      $or: [
        { name: RESEARCH_HOME_HEAD_NOUN_PREFILTER },
        { displayName: RESEARCH_HOME_HEAD_NOUN_PREFILTER },
      ],
    },
    { _id: 1, slug: 1, name: 1, displayName: 1 },
  ).lean();

  const result: ResearchEntityNameRunonBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    updated: 0,
    synced: 0,
    errors: 0,
    samples: [],
  };

  for (const entity of entities as Array<Record<string, unknown>>) {
    if (options.limit && result.scanned >= options.limit) break;
    result.scanned += 1;
    try {
      const update: Record<string, string> = {};
      for (const field of ['name', 'displayName'] as const) {
        const current = entity[field];
        if (typeof current !== 'string') continue;
        const stripped = stripTrailingResearchHomeDescription(current);
        if (stripped === current || stripped.length === 0) continue;
        update[field] = stripped;
        if (result.samples.length < 25) {
          result.samples.push({
            slug: String(entity.slug ?? ''),
            field,
            from: current,
            to: stripped,
          });
        }
      }
      if (Object.keys(update).length === 0) continue;
      if (!options.dryRun) {
        await ResearchEntity.updateOne({ _id: entity._id }, { $set: update });
        const fresh = await ResearchEntity.findById(entity._id).lean();
        if (fresh) {
          await syncEntity('researchEntity', fresh);
          result.synced += 1;
        }
      }
      result.updated += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `research-entity name-runon backfill failed for ${String(entity.slug ?? entity._id)}:`,
        sanitizeLogValue(error),
      );
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseResearchEntityNameRunonBackfillArgs(process.argv.slice(2));
  assertResearchEntityNameRunonApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfill:research-entity-name-runons',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runResearchEntityNameRunonBackfill({
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
      console.log(`Saved research-entity name-runon backfill report to ${safeOutput}`);
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
