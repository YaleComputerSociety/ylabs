import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  isRetiredLabMicrositeDrop,
  planDeadCitationDrop,
  type DeadCitationDropPlan,
} from './dropSupersededDeadCitationsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'data:drop-dead-citations';

export interface DropDeadCitationsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): DropDeadCitationsArgs {
  const args: DropDeadCitationsArgs = { apply: false, confirm: false, maxApply: 200 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-drop-dead-citations') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

export async function loadPlans(): Promise<DeadCitationDropPlan[]> {
  const entities = await ResearchEntity.find({ archived: { $ne: true } })
    .select('slug name studentVisibilityTier websiteUrl sourceUrls sourceLinkHealth')
    .lean();

  const plans: DeadCitationDropPlan[] = [];
  for (const entity of entities as any[]) {
    const plan = planDeadCitationDrop(entity);
    if (plan) plans.push(plan);
  }
  return plans.sort((a, b) => a.entitySlug.localeCompare(b.entitySlug));
}

async function applyPlans(plans: DeadCitationDropPlan[]): Promise<number> {
  let updated = 0;
  for (const plan of plans) {
    const update: Record<string, unknown> = { $set: { sourceUrls: plan.keptUrls } };
    if (plan.clearsWebsiteUrl) {
      update.$unset = { websiteUrl: '', 'fieldProvenance.websiteUrl': '' };
    }
    const result = await ResearchEntity.updateOne({ slug: plan.entitySlug }, update);
    if (result.modifiedCount > 0) updated += 1;
  }
  return updated;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const plans = await loadPlans();

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-drop-dead-citations is required when --apply is set.');
    }
    if (plans.length > args.maxApply) {
      throw new Error(
        `Apply would change ${plans.length} entities, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const updated = args.apply ? await applyPlans(plans) : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    plannedEntities: plans.length,
    plannedServedEntities: plans.filter((p) => p.studentVisibilityTier === 'student_ready').length,
    plannedDroppedCitations: plans.reduce((sum, p) => sum + p.droppedUrls.length, 0),
    plannedWebsiteUrlClears: plans.filter((p) => p.clearsWebsiteUrl).length,
    retiredLabMicrositeDrops: plans.filter(isRetiredLabMicrositeDrop).length,
    entitiesUpdated: updated,
    plans,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, plans: plans.slice(0, 20) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
