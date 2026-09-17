import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { inheritSchoolFromLeadPi } from '../scrapers/entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  summarizeLeadDepartmentInheritance,
  type LeadDepartmentInheritanceOutcome,
  type LeadDepartmentInheritanceSummary,
} from './backfillLeadDepartmentInheritanceCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CONFIRM_FLAG = '--confirm-lead-department';

export interface LeadDepartmentBackfillOptions {
  dryRun: boolean;
  confirmed: boolean;
  limit?: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return Number(value);
}

export function parseLeadDepartmentBackfillArgs(argv: string[]): LeadDepartmentBackfillOptions {
  const options: LeadDepartmentBackfillOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

interface CandidateRow {
  _id: unknown;
  slug?: string;
  manuallyLockedFields?: string[];
}

/**
 * Delivers the department a row's own lead PI already carries.
 *
 * `inheritSchoolFromLeadPi` runs only while a roster scrape materializes an
 * entity, so a row materialized before its lead's department was known, or before
 * that department was in the `OrgUnit` catalog, never picks it up. Catalog work is
 * therefore invisible until this pass runs: adding an alias changes what a string
 * resolves to, not what any served row stores.
 */
export async function runLeadDepartmentBackfill(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<{
  mode: 'dry-run' | 'apply';
  summary: LeadDepartmentInheritanceSummary;
  sample: LeadDepartmentInheritanceOutcome[];
}> {
  resetOrgUnitCanonicalizerCache();

  const query = ResearchEntity.find({
    archived: { $ne: true },
    $or: [
      { departments: { $size: 0 } },
      { departments: { $exists: false } },
      { school: { $in: ['', null] } },
    ],
  })
    .select('_id slug manuallyLockedFields')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const candidates = await query.lean<CandidateRow[]>();

  const outcomes: LeadDepartmentInheritanceOutcome[] = [];
  for (const candidate of candidates) {
    const result = await inheritSchoolFromLeadPi(String(candidate._id), {
      manuallyLockedFields: candidate.manuallyLockedFields,
      dryRun: options.dryRun,
    });
    outcomes.push({ id: String(candidate._id), slug: candidate.slug, result });
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeLeadDepartmentInheritance(outcomes),
    sample: outcomes.filter((outcome) => outcome.result.inherited).slice(0, 15),
  };
}

async function main(): Promise<void> {
  const options = parseLeadDepartmentBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirmed) throw new Error(`Apply mode requires ${CONFIRM_FLAG}.`);

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'lead-PI department inheritance backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runLeadDepartmentBackfill({
      dryRun: options.dryRun,
      limit: options.limit,
    });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, result },
          null,
          2,
        ),
      );
      console.log(`Saved report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ mode: result.mode, ...result.summary }, null, 2));
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
