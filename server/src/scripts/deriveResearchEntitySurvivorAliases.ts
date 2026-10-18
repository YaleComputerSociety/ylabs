import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import {
  applyMergedFromPlan,
  loadMergedFromNodes,
  planMergedFromDerivation,
} from '../services/researchEntityMergedFrom';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const DERIVE_SURVIVOR_ALIASES_SCRIPT_NAME = 'research-entity:derive-survivor-aliases';
export const DERIVE_SURVIVOR_ALIASES_CONFIRM_FLAG = '--confirm-derive-survivor-aliases';

export interface DeriveSurvivorAliasesOptions {
  apply: boolean;
  output?: string;
}

export function parseDeriveSurvivorAliasesArgs(argv: string[]): DeriveSurvivorAliasesOptions {
  let apply = false;
  let confirmed = false;
  let output: string | undefined;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === DERIVE_SURVIVOR_ALIASES_CONFIRM_FLAG) {
      confirmed = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown ${DERIVE_SURVIVOR_ALIASES_SCRIPT_NAME} argument: ${arg}`);
  }
  if (apply && !confirmed) {
    throw new Error(
      `${DERIVE_SURVIVOR_ALIASES_SCRIPT_NAME} apply requires ${DERIVE_SURVIVOR_ALIASES_CONFIRM_FLAG}`,
    );
  }
  return { apply, ...(output ? { output } : {}) };
}

async function main(): Promise<void> {
  const options = parseDeriveSurvivorAliasesArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: DERIVE_SURVIVOR_ALIASES_SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const plan = planMergedFromDerivation(await loadMergedFromNodes());
  const applied = options.apply ? await applyMergedFromPlan(plan) : null;
  const report = {
    script: DERIVE_SURVIVOR_ALIASES_SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    tombstones: plan.tombstones,
    unresolvedTombstones: plan.unresolvedTombstones,
    survivorsWithMergedFrom: plan.survivorsWithMergedFrom,
    mergedEntries: plan.mergedEntries,
    plannedWrites: plan.writes.length,
    plannedClears: plan.clears.length,
    applied,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify({ ...report, plan }, null, 2)}\n`);
  }
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
