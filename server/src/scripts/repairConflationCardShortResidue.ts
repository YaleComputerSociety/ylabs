import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import {
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
} from '../services/studentVisibilityGateService';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  GRANT_DERIVED_PI_SHELL_SLUG_RE,
  REPAIR_SOURCE_NAME,
} from './repairNihNsfPiCenterLabConflationCore';
import {
  planConflationCardShortResidueRepair,
  summarizeConflationCardShortResidueRepair,
  type CardResidueRepairPlan,
} from './repairConflationCardShortResidueCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PUBLIC = new Set<string>(publicStudentVisibilityTiers);

export interface RepairConflationCardShortResidueCliOptions {
  dryRun: boolean;
  confirm: boolean;
  output?: string;
}

export function parseRepairConflationCardShortResidueArgs(
  argv: string[],
): RepairConflationCardShortResidueCliOptions {
  const options: RepairConflationCardShortResidueCliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-conflation-card-short-residue-repair') {
      options.confirm = true;
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

export async function runConflationCardShortResidueRepair(options: {
  dryRun: boolean;
}): Promise<{
  mode: 'dry-run' | 'apply';
  summary: ReturnType<typeof summarizeConflationCardShortResidueRepair>;
  plans: CardResidueRepairPlan[];
  promoted: number;
}> {
  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    slug: { $regex: GRANT_DERIVED_PI_SHELL_SLUG_RE },
    entityType: 'LAB',
    'fieldProvenance.shortDescription.sourceName': REPAIR_SOURCE_NAME,
  })
    .select('_id slug fullDescription shortDescription researchAreas fieldProvenance')
    .sort({ _id: 1 })
    .lean();

  const now = new Date();
  const plans = (entities as any[])
    .map((entity) =>
      planConflationCardShortResidueRepair(
        {
          id: String(entity._id),
          slug: entity.slug,
          fullDescription: entity.fullDescription,
          shortDescription: entity.shortDescription,
          researchAreas: entity.researchAreas,
          shortDescriptionProvenanceSource: entity.fieldProvenance?.shortDescription?.sourceName,
        },
        now,
      ),
    )
    .filter((plan): plan is CardResidueRepairPlan => plan !== null);

  let promoted = 0;
  if (!options.dryRun && plans.length > 0) {
    await ResearchEntity.bulkWrite(
      plans.map((plan) => ({
        updateOne: { filter: { _id: plan.id }, update: { $set: plan.set } },
      })),
      { ordered: false },
    );

    const recordIds = plans.map((plan) => plan.id);
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds,
    } as any);
    await applyStudentVisibilityGatePlans(gatePlans);
    promoted = gatePlans.filter((plan) => PUBLIC.has(plan.tier)).length;

    const updatedDocs = await ResearchEntity.find({ _id: { $in: recordIds } }).lean();
    await syncEntities('researchEntity', updatedDocs);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeConflationCardShortResidueRepair(plans),
    plans,
    promoted,
  };
}

async function main(): Promise<void> {
  const options = parseRepairConflationCardShortResidueArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-conflation-card-short-residue-repair.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'conflation card-short residue repair',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runConflationCardShortResidueRepair({ dryRun: options.dryRun });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved conflation card-short residue repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ summary: result.summary, promoted: result.promoted }, null, 2));
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
