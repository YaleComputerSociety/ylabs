import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import type { Collection, Document } from 'mongodb';
import { connectScriptMongo } from '../db/connections';
import { RESEARCH_PLAN_RESTORE_WINDOW_MS } from '../models/researchPlan';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'research-plans:expire-legacy-archived';
export const EXPIRE_CONFIRM_FLAG = '--confirm-expire-legacy-archived-research-plans';
export const RESEARCH_PLANS_COLLECTION = 'research_plans';

export type ExpireEnvironment = 'development' | 'beta' | 'production';

const MONGO_URL_ENV_VARS: Record<ExpireEnvironment, string> = {
  development: 'MONGODBURL',
  beta: 'BETA_MONGODBURL',
  production: 'PRODUCTION_MONGODBURL',
};

export interface ExpireLegacyArchivedResearchPlansArgs {
  environment: ExpireEnvironment;
  apply: boolean;
  confirm: boolean;
}

export function parseExpireLegacyArchivedResearchPlansArgs(
  argv: string[],
): ExpireLegacyArchivedResearchPlansArgs {
  const args: ExpireLegacyArchivedResearchPlansArgs = {
    environment: 'development',
    apply: false,
    confirm: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === EXPIRE_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--environment=')) {
      args.environment = parseEnvironment(arg.slice('--environment='.length));
    } else if (arg === '--environment') {
      args.environment = parseEnvironment(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

function parseEnvironment(value: string | undefined): ExpireEnvironment {
  if (value === 'development' || value === 'beta' || value === 'production') return value;
  throw new Error(`--environment must be development, beta or production; received ${value}`);
}

export function assertExpireLegacyArchivedResearchPlansApplyAllowed(
  args: ExpireLegacyArchivedResearchPlansArgs,
): void {
  if (args.apply && !args.confirm) {
    throw new Error(`${EXPIRE_CONFIRM_FLAG} is required when --apply is set.`);
  }
}

export function resolveExpireMongoUrl(
  environment: ExpireEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = MONGO_URL_ENV_VARS[environment];
  const value = env[variable]?.trim();
  if (!value) {
    throw new Error(
      `${variable} is required to reach the ${environment} environment. A worktree has no server/.env of its own, so copy or symlink one in.`,
    );
  }
  return value;
}

export function legacyArchivedResearchPlanFilter(): Record<string, unknown> {
  return { archived: true, restorableUntil: { $exists: false } };
}

export function restoreWindowFromLastUpdatePipeline(): Document[] {
  return [
    {
      $set: {
        restorableUntil: {
          $add: [{ $ifNull: ['$updatedAt', '$$NOW'] }, RESEARCH_PLAN_RESTORE_WINDOW_MS],
        },
      },
    },
  ];
}

export interface ExpireLegacyArchivedResearchPlansResult {
  mode: 'dry-run' | 'apply';
  legacyArchivedBefore: number;
  legacyArchivedHoldingPrivateNotes: number;
  legacyArchivedHoldingChecklist: number;
  restoreWindowAlreadyPassed: number;
  activePlans: number;
  stamped: number;
  legacyArchivedAfter: number;
}

export async function expireLegacyArchivedResearchPlans(
  plans: Collection,
  options: { apply: boolean; now?: Date },
): Promise<ExpireLegacyArchivedResearchPlansResult> {
  const legacy = legacyArchivedResearchPlanFilter();
  const now = options.now ?? new Date();
  const legacyArchivedBefore = await plans.countDocuments(legacy);
  const legacyArchivedHoldingPrivateNotes = await plans.countDocuments({
    ...legacy,
    privateNotes: { $exists: true, $nin: [null, ''] },
  });
  const legacyArchivedHoldingChecklist = await plans.countDocuments({
    ...legacy,
    'checklist.0': { $exists: true },
  });
  const restoreWindowAlreadyPassed = await plans.countDocuments({
    ...legacy,
    $or: [
      { updatedAt: { $exists: false } },
      { updatedAt: { $lte: new Date(now.getTime() - RESEARCH_PLAN_RESTORE_WINDOW_MS) } },
    ],
  });
  const activePlans = await plans.countDocuments({ archived: { $ne: true } });
  const stamped = options.apply
    ? (await plans.updateMany(legacy, restoreWindowFromLastUpdatePipeline())).modifiedCount
    : 0;
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    legacyArchivedBefore,
    legacyArchivedHoldingPrivateNotes,
    legacyArchivedHoldingChecklist,
    restoreWindowAlreadyPassed,
    activePlans,
    stamped,
    legacyArchivedAfter: await plans.countDocuments(legacy),
  };
}

async function main(): Promise<void> {
  const args = parseExpireLegacyArchivedResearchPlansArgs(process.argv.slice(2));
  assertExpireLegacyArchivedResearchPlansApplyAllowed(args);

  const mongoUrl = resolveExpireMongoUrl(args.environment);
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });

  await connectScriptMongo(mongoUrl);
  try {
    const result = await expireLegacyArchivedResearchPlans(
      mongoose.connection.db!.collection(RESEARCH_PLANS_COLLECTION),
      { apply: args.apply },
    );
    console.log(
      JSON.stringify({
        script: SCRIPT_NAME,
        environment: args.environment,
        db: guard.dbLabel,
        ...result,
      }),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch(async (error) => {
    console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
