/**
 * Reads, and on `--apply` repairs, the student-visibility verdict stored on
 * archived research rows.
 *
 * The gate scopes itself to live rows, so an archived row keeps whichever tier
 * and reasons it held when it was last seen and nothing ever withdraws them. No
 * student sees a wrong page, because every serve path and every product
 * aggregation filters `archived`. The damage is to measurement: a direct query
 * grouped by tier over-reports, and the zero-hard-blocker held population read
 * 708 counting all rows against 9 counting live rows, which was ranked as the
 * largest releasable population in the corpus before the filter was applied
 * (#2896).
 *
 * The dry-run output is the reproducible corrected count: it prints every tier
 * both ways and names the difference, so the number is a command rather than an
 * ad-hoc pipeline. `--assert-clean` turns it into a gate.
 *
 * Usage:
 *   yarn --cwd server research-entity:archived-visibility-verdicts
 *   yarn --cwd server research-entity:archived-visibility-verdicts \
 *     --apply --confirm-archived-visibility-verdict-repair
 *   yarn --cwd server research-entity:archived-visibility-verdicts --assert-clean
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import {
  ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS,
  archivedStudentVisibilityVerdictFilter,
  liveEntityFilter,
} from '../models/entityArchival';
import {
  clearArchivedResearchStudentVisibility,
  isBlockingVisibilityReason,
} from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  formatArchivedVerdictCensus,
  HELD_STUDENT_VISIBILITY_TIERS,
  summarizeArchivedVerdictCensus,
  type ArchivedVerdictCensus,
} from './archivedStudentVisibilityVerdictsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'research-entity:archived-visibility-verdicts';

export interface ArchivedVerdictRepairArgs {
  apply: boolean;
  confirmArchivedVisibilityVerdictRepair: boolean;
  assertClean: boolean;
  output?: string;
}

export function parseArchivedVerdictRepairArgs(argv: string[]): ArchivedVerdictRepairArgs {
  const args: ArchivedVerdictRepairArgs = {
    apply: false,
    confirmArchivedVisibilityVerdictRepair: false,
    assertClean: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-archived-visibility-verdict-repair') {
      args.confirmArchivedVisibilityVerdictRepair = true;
      continue;
    }
    if (arg.startsWith('--confirm-archived-visibility-verdict-repair=')) {
      throw new Error('--confirm-archived-visibility-verdict-repair does not accept a value');
    }
    if (arg === '--assert-clean') {
      args.assertClean = true;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

export function assertArchivedVerdictRepairApplyAllowed(
  args: Pick<ArchivedVerdictRepairArgs, 'apply' | 'confirmArchivedVisibilityVerdictRepair'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.apply && !args.confirmArchivedVisibilityVerdictRepair) {
    throw new Error(
      `--confirm-archived-visibility-verdict-repair is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  return assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl, env });
}

export async function readArchivedVerdictCensus(): Promise<ArchivedVerdictCensus> {
  const [totalRows, archivedRows, archivedRowsStoringVerdict, liveRowsNeverGated] =
    await Promise.all([
      ResearchEntity.countDocuments({}),
      ResearchEntity.countDocuments({ archived: true }),
      ResearchEntity.countDocuments(archivedStudentVisibilityVerdictFilter()),
      ResearchEntity.countDocuments(
        liveEntityFilter({ studentVisibilityComputedAt: { $exists: false } }),
      ),
    ]);

  const archivedRowsByField: Record<string, number> = {};
  for (const field of ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS) {
    archivedRowsByField[field] = await ResearchEntity.countDocuments({
      archived: true,
      [field]: { $exists: true },
    });
  }

  const tierRows = (await ResearchEntity.aggregate([
    {
      $group: {
        _id: { tier: '$studentVisibilityTier', archived: { $eq: ['$archived', true] } },
        count: { $sum: 1 },
      },
    },
    { $project: { _id: 0, tier: '$_id.tier', archived: '$_id.archived', count: 1 } },
  ])) as Array<{ tier?: string | null; archived: boolean; count: number }>;

  const heldDocuments = (await ResearchEntity.find(
    { studentVisibilityTier: { $in: [...HELD_STUDENT_VISIBILITY_TIERS] } },
    { studentVisibilityReasons: 1, archived: 1 },
  ).lean()) as Array<{ archived?: boolean; studentVisibilityReasons?: string[] }>;

  return summarizeArchivedVerdictCensus({
    totalRows,
    archivedRows,
    archivedRowsStoringVerdict,
    archivedRowsByField,
    tierRows,
    heldRows: heldDocuments.map((document) => ({
      archived: document.archived === true,
      hasHardBlocker: (document.studentVisibilityReasons || []).some(isBlockingVisibilityReason),
    })),
    liveRowsNeverGated,
  });
}

export interface ArchivedVerdictRepairResult {
  mode: 'dry-run' | 'apply';
  before: ArchivedVerdictCensus;
  after?: ArchivedVerdictCensus;
  cleared: number;
}

export async function repairArchivedStudentVisibilityVerdicts(options: {
  apply: boolean;
}): Promise<ArchivedVerdictRepairResult> {
  const before = await readArchivedVerdictCensus();
  if (!options.apply) return { mode: 'dry-run', before, cleared: 0 };

  const cleared = await clearArchivedResearchStudentVisibility();
  const after = await readArchivedVerdictCensus();
  if (after.archivedRowsStoringVerdict > 0) {
    throw new Error(
      `${SCRIPT_NAME} left ${after.archivedRowsStoringVerdict} archived rows storing a verdict`,
    );
  }
  return { mode: 'apply', before, after, cleared };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseArchivedVerdictRepairArgs(process.argv.slice(2));
  const guard = assertArchivedVerdictRepairApplyAllowed(args, process.env, process.env.MONGODBURL);

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const result = await repairArchivedStudentVisibilityVerdicts({ apply: args.apply });
  const census = result.after || result.before;

  console.log(`${SCRIPT_NAME} (${result.mode}) on ${db.databaseName} [${guard.environment}]`);
  if (result.after) {
    console.log('--- before ---');
    console.log(formatArchivedVerdictCensus(result.before));
    console.log(`cleared: ${result.cleared}`);
    console.log('--- after ---');
  }
  console.log(formatArchivedVerdictCensus(census));

  writeOutput(
    {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      databaseName: db.databaseName,
      options: args,
      ...result,
    },
    args.output,
  );

  if (args.assertClean && census.violations.length > 0) {
    throw new Error(
      `${SCRIPT_NAME} --assert-clean failed: ${census.violations.length} violations remain`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(
        'Failed to read or repair archived student-visibility verdicts:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
