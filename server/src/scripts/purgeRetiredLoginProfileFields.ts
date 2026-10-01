/**
 * Unsets the three `Account.profile` paths a login used to persist and nothing ever read:
 * a student's residential college, class year and major (#4162).
 *
 * The login path stopped writing them in the same change and unsets them on any sign-in
 * that resolves no Yalies record, so an account that keeps signing in sheds them on its
 * own. This is for the tail that never signs in again.
 *
 * It is dry-run by default and a dry run is read-only, which is the point: Development
 * logins do not go through CAS and hold none of these values, so the population lives in
 * Production and an operator needs a way to count it before deciding to clear it. Clearing
 * stored personal data is that operator's decision, not a lane's and not a promotion's.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const SCRIPT_NAME = 'accounts:purge-retired-login-profile-fields';
export const PURGE_CONFIRM_FLAG = '--confirm-purge-retired-login-profile-fields';
export const RETIRED_LOGIN_PROFILE_PATHS = ['profile.college', 'profile.year', 'profile.major'];

export type PurgeEnvironment = 'development' | 'beta' | 'production';

const MONGO_URL_ENV_VARS: Record<PurgeEnvironment, string> = {
  development: 'MONGODBURL',
  beta: 'BETA_MONGODBURL',
  production: 'PRODUCTION_MONGODBURL',
};

export interface PurgeRetiredLoginProfileFieldsArgs {
  environment: PurgeEnvironment;
  apply: boolean;
  confirm: boolean;
}

export function parsePurgeRetiredLoginProfileFieldsArgs(
  argv: string[],
): PurgeRetiredLoginProfileFieldsArgs {
  const args: PurgeRetiredLoginProfileFieldsArgs = {
    environment: 'development',
    apply: false,
    confirm: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === PURGE_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--environment=')) {
      args.environment = parseEnvironment(arg.slice('--environment='.length));
    } else if (arg === '--environment') {
      args.environment = parseEnvironment(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

function parseEnvironment(value: string | undefined): PurgeEnvironment {
  if (value === 'development' || value === 'beta' || value === 'production') return value;
  throw new Error(`--environment must be development, beta or production; received ${value}`);
}

export function assertPurgeRetiredLoginProfileFieldsApplyAllowed(
  args: PurgeRetiredLoginProfileFieldsArgs,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`${PURGE_CONFIRM_FLAG} is required when --apply is set.`);
  }
}

export function resolvePurgeMongoUrl(
  environment: PurgeEnvironment,
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

export function retiredLoginProfileFieldsFilter(): Record<string, unknown> {
  return { $or: RETIRED_LOGIN_PROFILE_PATHS.map((field) => ({ [field]: { $exists: true } })) };
}

export function retiredLoginProfileFieldsUnset(): Record<string, ''> {
  return Object.fromEntries(RETIRED_LOGIN_PROFILE_PATHS.map((field) => [field, '']));
}

async function main(): Promise<void> {
  const args = parsePurgeRetiredLoginProfileFieldsArgs(process.argv.slice(2));
  assertPurgeRetiredLoginProfileFieldsApplyAllowed(args);

  const mongoUrl = resolvePurgeMongoUrl(args.environment);
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });

  await connectScriptMongo(mongoUrl);
  try {
    const accounts = mongoose.connection.db!.collection('accounts');
    const filter = retiredLoginProfileFieldsFilter();
    const matched = await accounts.countDocuments(filter);
    const byField: Record<string, number> = {};
    for (const field of RETIRED_LOGIN_PROFILE_PATHS) {
      byField[field] = await accounts.countDocuments({ [field]: { $exists: true } });
    }
    const cleared = args.apply
      ? (await accounts.updateMany(filter, { $unset: retiredLoginProfileFieldsUnset() }))
          .modifiedCount
      : 0;
    console.log(
      JSON.stringify({
        script: SCRIPT_NAME,
        environment: args.environment,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        accountsHoldingAnyRetiredPath: matched,
        accountsByRetiredPath: byField,
        cleared,
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
