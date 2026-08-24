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
  planCenterRosterSchoolResidueRow,
  summarizeCenterRosterSchoolResidue,
  type CenterRosterSchoolResiduePlanRow,
  type CenterRosterSchoolResidueSummary,
} from './fix1610CenterRosterSchoolResidueCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Center/institute roster URLs known to have leaked their spanning
 * `departments` seed onto member entities (#1055/#1390). Scoped to the
 * confirmed-affected sources rather than every ResearchEntity so this backfill
 * cannot touch a school value asserted through an unrelated path.
 */
const AFFECTED_ROSTER_SOURCE_URL = 'https://wti.yale.edu/humans/faculty';

export interface CenterRosterSchoolResidueCliOptions {
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

export function parseCenterRosterSchoolResidueArgs(
  argv: string[],
): CenterRosterSchoolResidueCliOptions {
  const options: CenterRosterSchoolResidueCliOptions = { dryRun: true, confirm: false };
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

export interface CenterRosterSchoolResidueResult {
  mode: 'dry-run' | 'apply';
  summary: CenterRosterSchoolResidueSummary;
  changes: CenterRosterSchoolResiduePlanRow[];
}

export async function runCenterRosterSchoolResidueBackfill(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<CenterRosterSchoolResidueResult> {
  resetOrgUnitCanonicalizerCache();

  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    sourceUrls: AFFECTED_ROSTER_SOURCE_URL,
  };

  const query = ResearchEntity.find(filter)
    .select('_id slug name school schools departments websiteUrl sourceUrls fieldProvenance')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = await query.lean();

  const rows: CenterRosterSchoolResiduePlanRow[] = [];
  for (const entity of entities) {
    const row = await planCenterRosterSchoolResidueRow({ id: String(entity._id), ...entity });
    if (row) rows.push(row);
  }

  if (!options.dryRun && rows.length > 0) {
    await ResearchEntity.bulkWrite(
      rows.map((row) => ({
        updateOne: { filter: { _id: row.id }, update: { $set: row.update } },
      })),
    );
    const updatedDocs = await ResearchEntity.find({
      _id: { $in: rows.map((row) => row.id) },
    }).lean();
    await syncEntities('researchEntity', updatedDocs);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeCenterRosterSchoolResidue(rows),
    changes: rows,
  };
}

async function main(): Promise<void> {
  const options = parseCenterRosterSchoolResidueArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity center-roster school residue backfill (#1610)',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runCenterRosterSchoolResidueBackfill({
      dryRun: options.dryRun,
      limit: options.limit,
    });
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
      console.log(`Saved center-roster school residue backfill report to ${safeOutput}`);
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
