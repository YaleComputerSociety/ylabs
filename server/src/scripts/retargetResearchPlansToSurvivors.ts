import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { retargetResearchPlansToMergeSurvivors } from '../services/researchPlanSurvivorRetarget';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config({ quiet: true });

export interface RetargetResearchPlansOptions {
  mode: 'dry-run' | 'apply';
  confirm: boolean;
}

export function parseRetargetResearchPlansArgs(argv: string[]): RetargetResearchPlansOptions {
  const options: RetargetResearchPlansOptions = { mode: 'dry-run', confirm: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.mode = 'apply';
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.mode = 'dry-run';
    else if (arg === '--confirm-research-plan-retarget') options.confirm = true;
    else throw new Error(`Unknown research-plans:retarget-merged argument: ${arg}`);
  }
  if (options.mode === 'apply' && !options.confirm) {
    throw new Error('Apply mode requires --confirm-research-plan-retarget');
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseRetargetResearchPlansArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.mode === 'apply',
    scriptName: 'retargetResearchPlansToSurvivors',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const report = await retargetResearchPlansToMergeSurvivors({ apply: options.mode === 'apply' });
  console.log(
    JSON.stringify(
      { mode: options.mode, environment: guard.environment, db: guard.dbLabel, ...report },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .catch((error) => {
      console.error('Failed to retarget research plans:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
