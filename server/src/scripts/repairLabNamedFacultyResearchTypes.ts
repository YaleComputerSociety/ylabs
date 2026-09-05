import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  LAB_TYPE_CORRECTIONS,
  planLabTypeCorrections,
  summarizeLabTypeCorrections,
  type LabTypeCorrectionEntity,
  type LabTypeCorrectionPlanRow,
} from './repairLabNamedFacultyResearchTypesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:repair-lab-named-faculty-research-types';

export interface LabTypeCorrectionCliOptions {
  dryRun: boolean;
  confirmLabTypeCorrection: boolean;
  output?: string;
}

export function parseLabTypeCorrectionArgs(argv: string[]): LabTypeCorrectionCliOptions {
  const options: LabTypeCorrectionCliOptions = { dryRun: true, confirmLabTypeCorrection: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-lab-type-correction') options.confirmLabTypeCorrection = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function runLabTypeCorrections(options: { dryRun: boolean }): Promise<{
  mode: 'dry-run' | 'apply';
  summary: ReturnType<typeof summarizeLabTypeCorrections>;
  rows: LabTypeCorrectionPlanRow[];
}> {
  const entities = await ResearchEntity.find({
    slug: { $in: LAB_TYPE_CORRECTIONS.map((correction) => correction.slug) },
  })
    .select('slug name entityType kind archived manuallyLockedFields studentVisibilityTier')
    .lean<LabTypeCorrectionEntity[]>();

  const rows = planLabTypeCorrections(entities);
  const planned = rows.filter((row) => row.outcome === 'plan');

  if (!options.dryRun && planned.length > 0) {
    await ResearchEntity.bulkWrite(
      planned.map((row) => ({
        updateOne: { filter: { slug: row.slug }, update: { $set: row.update } },
      })),
    );
    const updated = await ResearchEntity.find({
      slug: { $in: planned.map((row) => row.slug) },
    }).lean();
    await syncEntities('researchEntity', updated as any);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeLabTypeCorrections(rows),
    rows,
  };
}

async function main(): Promise<void> {
  const options = parseLabTypeCorrectionArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmLabTypeCorrection) {
    throw new Error(`${SCRIPT_NAME} apply mode requires --confirm-lab-type-correction.`);
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runLabTypeCorrections({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, ...result },
          null,
          2,
        ),
      );
      console.log(`Saved lab-type correction report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
    if (apply && result.summary.plan > 0) {
      console.log(
        'Run student-visibility:gate to recompute the tier for these rows; take the before/after from the gate dry-run rather than from a query over student_ready.',
      );
    }
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
