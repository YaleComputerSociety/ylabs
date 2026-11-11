/**
 * Deletes one account's data on request, for someone who cannot sign in to do it
 * themselves (#4156). It calls the same service as the self-serve route, so an emailed
 * request removes exactly what a signed-in deletion removes.
 *
 * Dry-run by default, and a dry run is read-only: it prints the per-collection residue for
 * the netid, which is also how a finished deletion is verified, since every count must read
 * zero afterwards. Output carries counts only, never the netid.
 *
 * Accounts are environment-local, so it acts on one environment per run, and it reads that
 * environment's own deletion keys, so a Production run never borrows Development's. A
 * deletion records a request for the other environments; `--process-pending-from <source>`
 * then deletes those people in `--environment`, one run per target, and marks it done on the
 * source's request, which also writes the source database.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo, createScriptMongoConnection } from '../db/connections';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { processPendingDeletionRequests } from '../services/accountDeletionRequestProcessor';
import {
  ACCOUNT_DELETION_AUDIT_HMAC_KEY_MIN_LENGTH,
  deleteAccountData,
  normalizeAccountNetid,
  readAccountDataResidue,
} from '../services/accountDataService';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'accounts:delete-account-data';
export const DELETE_CONFIRM_FLAG = '--confirm-delete-account-data';
export const PENDING_FROM_FLAG = '--process-pending-from';

export type DeleteAccountDataEnvironment = 'development' | 'beta' | 'production';

const ENVIRONMENT_VARIABLE_PREFIXES: Record<DeleteAccountDataEnvironment, string> = {
  development: '',
  beta: 'BETA_',
  production: 'PRODUCTION_',
};

export const ACCOUNT_DELETION_KEY_VARIABLES = [
  'POSTHOG_PERSONAL_API_KEY',
  'POSTHOG_PROJECT_ID',
  'ACCOUNT_DELETION_AUDIT_HMAC_KEY',
] as const;

export interface DeleteAccountDataArgs {
  environment: DeleteAccountDataEnvironment;
  netid: string;
  pendingFrom: DeleteAccountDataEnvironment | null;
  apply: boolean;
  confirm: boolean;
}

function parseEnvironment(value: string | undefined): DeleteAccountDataEnvironment {
  if (value === 'development' || value === 'beta' || value === 'production') return value;
  throw new Error(`--environment must be development, beta or production; received ${value}`);
}

function parseNetid(value: string | undefined): string {
  const netid = normalizeAccountNetid(value);
  if (!netid) throw new Error('--netid must be a Yale netid');
  return netid;
}

export function parseDeleteAccountDataArgs(argv: string[]): DeleteAccountDataArgs {
  const args = {
    environment: 'development',
    netid: '',
    pendingFrom: null,
    apply: false,
    confirm: false,
  } as DeleteAccountDataArgs;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === DELETE_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--environment=')) {
      args.environment = parseEnvironment(arg.slice('--environment='.length));
    } else if (arg === '--environment') {
      args.environment = parseEnvironment(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--netid=')) {
      args.netid = parseNetid(arg.slice('--netid='.length));
    } else if (arg === '--netid') {
      args.netid = parseNetid(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith(`${PENDING_FROM_FLAG}=`)) {
      args.pendingFrom = parseEnvironment(arg.slice(PENDING_FROM_FLAG.length + 1));
    } else if (arg === PENDING_FROM_FLAG) {
      args.pendingFrom = parseEnvironment(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg.split('=')[0]}`);
  }
  if (Boolean(args.netid) === Boolean(args.pendingFrom)) {
    throw new Error(`Give exactly one of --netid or ${PENDING_FROM_FLAG}`);
  }
  if (args.pendingFrom === args.environment) {
    throw new Error(`${PENDING_FROM_FLAG} must name a different environment than --environment`);
  }
  if (args.apply && !args.confirm) {
    throw new Error(`${DELETE_CONFIRM_FLAG} is required when --apply is set.`);
  }
  return args;
}

export function resolveDeleteAccountDataMongoUrl(
  environment: DeleteAccountDataEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = `${ENVIRONMENT_VARIABLE_PREFIXES[environment]}MONGODBURL`;
  const value = env[variable]?.trim();
  if (!value) {
    throw new Error(
      `${variable} is required to reach the ${environment} environment. A worktree has no server/.env of its own, so copy or symlink one in.`,
    );
  }
  return value;
}

export function resolveDeleteAccountDataServiceEnv(
  environment: DeleteAccountDataEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const prefix = ENVIRONMENT_VARIABLE_PREFIXES[environment];
  return Object.fromEntries(
    ACCOUNT_DELETION_KEY_VARIABLES.map((variable) => [variable, env[`${prefix}${variable}`]]),
  );
}

async function deleteOneNetid(args: DeleteAccountDataArgs): Promise<Record<string, unknown>> {
  const before = await readAccountDataResidue(args.netid);
  const deletion = args.apply
    ? await deleteAccountData(args.netid, {
        requester: 'operator',
        env: resolveDeleteAccountDataServiceEnv(args.environment),
        environment: args.environment,
      })
    : null;
  const after = args.apply ? await readAccountDataResidue(args.netid) : null;
  return { residueBefore: before, deletion, residueAfter: after };
}

async function processPendingFrom(
  args: DeleteAccountDataArgs,
  source: DeleteAccountDataEnvironment,
): Promise<Record<string, unknown>> {
  const sourceKey = resolveDeleteAccountDataServiceEnv(source).ACCOUNT_DELETION_AUDIT_HMAC_KEY;
  if (!sourceKey || sourceKey.trim().length < ACCOUNT_DELETION_AUDIT_HMAC_KEY_MIN_LENGTH) {
    throw new Error(
      `The ${source} ACCOUNT_DELETION_AUDIT_HMAC_KEY is required to match its pending requests.`,
    );
  }
  const sourceUrl = resolveDeleteAccountDataMongoUrl(source);
  assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl: sourceUrl });
  const sourceConnection = await createScriptMongoConnection(sourceUrl);
  try {
    const summary = await processPendingDeletionRequests({
      sourceDb: sourceConnection.db!,
      sourceKey: sourceKey.trim(),
      target: args.environment,
      targetServiceEnv: resolveDeleteAccountDataServiceEnv(args.environment),
      apply: args.apply,
    });
    return { pendingFrom: source, pendingRequests: summary };
  } finally {
    await sourceConnection.close();
  }
}

async function main(): Promise<void> {
  const args = parseDeleteAccountDataArgs(process.argv.slice(2));
  const mongoUrl = resolveDeleteAccountDataMongoUrl(args.environment);
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });

  await connectScriptMongo(mongoUrl);
  try {
    const outcome = args.pendingFrom
      ? await processPendingFrom(args, args.pendingFrom)
      : await deleteOneNetid(args);
    console.log(
      JSON.stringify({
        script: SCRIPT_NAME,
        environment: args.environment,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        ...outcome,
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
