import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const WRONG_YSM_ATOZ_INDEX_URL =
  'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/';
export const CORRECT_YSM_ATOZ_INDEX_URL =
  'https://medicine.yale.edu/about/a-to-z-index/lab-websites/';

export interface RepairYsmAtozIndexSourceUrlOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  explicitLimit: boolean;
  output?: string;
}

export function parseRepairYsmAtozIndexSourceUrlArgs(
  argv: string[],
): RepairYsmAtozIndexSourceUrlOptions {
  const options: RepairYsmAtozIndexSourceUrlOptions = {
    apply: false,
    confirm: false,
    limit: 0,
    explicitLimit: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-ysm-atoz-repair') options.confirm = true;
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
      throw new Error(`Unknown repair-ysm-atoz-index-source-url argument: ${arg}`);
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

export function assertRepairYsmAtozIndexSourceUrlApplyAllowed(
  options: Pick<RepairYsmAtozIndexSourceUrlOptions, 'apply' | 'confirm' | 'explicitLimit'>,
): void {
  if (!options.apply) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-ysm-atoz-repair.');
  }
  if (!options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface RepairYsmAtozIndexSourceUrlResult {
  mode: 'dry-run' | 'apply';
  matched: number;
  updated: number;
  slugs: string[];
}

export async function runRepairYsmAtozIndexSourceUrl(options: {
  apply: boolean;
  limit?: number;
}): Promise<RepairYsmAtozIndexSourceUrlResult> {
  const query = { sourceUrls: WRONG_YSM_ATOZ_INDEX_URL, archived: { $ne: true } };
  const matches = await ResearchEntity.find(query)
    .select('_id slug')
    .limit(options.limit || 0)
    .lean();

  let updated = 0;
  if (options.apply) {
    for (const entity of matches) {
      const result = await ResearchEntity.updateOne(
        { _id: entity._id },
        { $set: { 'sourceUrls.$[wrongUrl]': CORRECT_YSM_ATOZ_INDEX_URL } },
        { arrayFilters: [{ wrongUrl: WRONG_YSM_ATOZ_INDEX_URL }] },
      );
      updated += result.modifiedCount || 0;
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    matched: matches.length,
    updated,
    slugs: matches.map((entity) => String(entity.slug || entity._id)),
  };
}

async function main(): Promise<void> {
  const options = parseRepairYsmAtozIndexSourceUrlArgs(process.argv.slice(2));
  assertRepairYsmAtozIndexSourceUrlApplyAllowed(options);

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repair:ysm-atoz-index-source-url',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.apply ? 'apply' : 'dry-run'
    }`,
  );

  await mongoose.connect(process.env.MONGODBURL as string);
  try {
    const result = await runRepairYsmAtozIndexSourceUrl({
      apply: options.apply,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { apply: options.apply, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved repair report to ${safeOutput}`);
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
