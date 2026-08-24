import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  GRANT_DERIVED_PI_SHELL_SLUG_RE,
  planNihNsfPiCenterLabConflationRepair,
  summarizeNihNsfPiCenterLabConflationRepair,
  type ConflationRepairPlan,
  type ConflationRepairSummary,
} from './repairNihNsfPiCenterLabConflationCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface RepairNihNsfPiCenterLabConflationCliOptions {
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

export function parseRepairNihNsfPiCenterLabConflationArgs(
  argv: string[],
): RepairNihNsfPiCenterLabConflationCliOptions {
  const options: RepairNihNsfPiCenterLabConflationCliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-nih-nsf-pi-center-lab-conflation-repair') {
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

export interface RepairNihNsfPiCenterLabConflationResult {
  mode: 'dry-run' | 'apply';
  summary: ConflationRepairSummary;
  plans: ConflationRepairPlan[];
}

export async function runNihNsfPiCenterLabConflationRepair(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<RepairNihNsfPiCenterLabConflationResult> {
  const query = ResearchEntity.find({
    archived: { $ne: true },
    slug: { $regex: GRANT_DERIVED_PI_SHELL_SLUG_RE },
    entityType: { $ne: 'LAB' },
    kind: 'lab',
  })
    .select(
      '_id slug name kind entityType websiteUrl fullDescription shortDescription researchAreas recentGrants sourceUrls',
    )
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = await query.lean();

  const now = new Date();
  const plans = entities
    .map((entity) =>
      planNihNsfPiCenterLabConflationRepair({ id: String(entity._id), ...entity }, now),
    )
    .filter((plan): plan is ConflationRepairPlan => plan !== null);

  if (!options.dryRun && plans.length > 0) {
    await ResearchEntity.bulkWrite(
      plans.map((plan) => ({
        updateOne: {
          filter: { _id: plan.id },
          update: { $set: plan.set, $unset: plan.unset },
        },
      })),
    );
    for (const plan of plans) {
      await Observation.updateMany(plan.supersedeObservationFilter, {
        $set: { superseded: true },
      });
      if (plan.supersedeDescriptionFilter) {
        await Observation.updateMany(plan.supersedeDescriptionFilter, {
          $set: { superseded: true },
        });
      }
    }
    const updatedDocs = await ResearchEntity.find({
      _id: { $in: plans.map((plan) => plan.id) },
    }).lean();
    await syncEntities('researchEntity', updatedDocs);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeNihNsfPiCenterLabConflationRepair(plans),
    plans,
  };
}

async function main(): Promise<void> {
  const options = parseRepairNihNsfPiCenterLabConflationArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-nih-nsf-pi-center-lab-conflation-repair.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity nih/nsf-pi center-lab conflation repair',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runNihNsfPiCenterLabConflationRepair({
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
      console.log(`Saved nih/nsf-pi center-lab conflation repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(JSON.stringify(result.plans, null, 2));
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
