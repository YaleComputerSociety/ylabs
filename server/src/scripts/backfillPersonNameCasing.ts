import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { canonicalPersonName, personNameCasingChanged } from '../scrapers/utils/personNameCasing';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const UPPERCASE_RUN_PATTERN = /[A-Z]{3,}/;

export interface PersonNameCasingBackfillOptions {
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

export function parsePersonNameCasingBackfillArgs(argv: string[]): PersonNameCasingBackfillOptions {
  const options: PersonNameCasingBackfillOptions = {
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
    else if (arg === '--confirm-person-name-casing') options.confirm = true;
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
      throw new Error(`Unknown backfill:person-name-casing argument: ${arg}`);
    }
  }
  return options;
}

export function assertPersonNameCasingApplyAllowed(
  options: Pick<PersonNameCasingBackfillOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-person-name-casing.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface PersonNameCasingBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  updated: number;
  errors: number;
  samples: Array<{ id: string; from: string; to: string }>;
}

export interface ResearcherCasingModel {
  find: (
    filter: Record<string, unknown>,
    projection: Record<string, unknown>,
  ) => { lean: () => Promise<Array<Record<string, unknown>>> };
  updateOne: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => Promise<unknown>;
}

export async function runPersonNameCasingBackfill(
  options: { dryRun: boolean; limit?: number },
  model: ResearcherCasingModel = Researcher as unknown as ResearcherCasingModel,
): Promise<PersonNameCasingBackfillResult> {
  const candidates = await model
    .find(
      { displayName: UPPERCASE_RUN_PATTERN, archived: { $ne: true } },
      { _id: 1, displayName: 1 },
    )
    .lean();

  const result: PersonNameCasingBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    updated: 0,
    errors: 0,
    samples: [],
  };

  for (const researcher of candidates) {
    if (options.limit && result.scanned >= options.limit) break;
    const current = researcher.displayName;
    if (typeof current !== 'string' || !personNameCasingChanged(current)) continue;
    result.scanned += 1;
    const normalized = canonicalPersonName(current);
    try {
      if (!options.dryRun) {
        await model.updateOne({ _id: researcher._id }, { $set: { displayName: normalized } });
      }
      result.updated += 1;
      if (result.samples.length < 60) {
        result.samples.push({ id: String(researcher._id), from: current, to: normalized });
      }
    } catch (error) {
      result.errors += 1;
      console.error(
        `person-name-casing backfill failed for ${String(researcher._id)}:`,
        sanitizeLogValue(error),
      );
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parsePersonNameCasingBackfillArgs(process.argv.slice(2));
  assertPersonNameCasingApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfill:person-name-casing',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runPersonNameCasingBackfill({
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
      console.log(`Saved person-name-casing backfill report to ${safeOutput}`);
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
