/**
 * Deletes the accounts nobody ever signed into and unsets `Researcher.accountId` on the
 * researchers linked to them, so `accounts` holds only logins (#5000).
 *
 * Development only. Beta and Production receive the result through
 * `beta:refresh-from-development` and promotion, whose account carry keeps every Production
 * login. It is dry-run by default; `--apply` also needs the confirmation flag and writes a
 * mode-0600 JSON backup of every row it deletes under the OS temp directory first.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  applyIdentityOnlyAccountRetirement,
  planIdentityOnlyAccountRetirement,
} from './retireIdentityOnlyAccountsCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'accounts:retire-identity-only';
export const RETIRE_CONFIRM_FLAG = '--confirm-retire-identity-only-accounts';

export interface RetireIdentityOnlyAccountsArgs {
  apply: boolean;
  confirm: boolean;
}

export function parseRetireIdentityOnlyAccountsArgs(
  argv: string[],
): RetireIdentityOnlyAccountsArgs {
  const args: RetireIdentityOnlyAccountsArgs = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === RETIRE_CONFIRM_FLAG) args.confirm = true;
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (args.apply && !args.confirm) {
    throw new Error(`${RETIRE_CONFIRM_FLAG} is required when --apply is set.`);
  }
  return args;
}

export function assertDevelopmentTarget(dbLabel: string): void {
  if (!/\/Development$/.test(dbLabel)) {
    throw new Error(`${SCRIPT_NAME} runs against Development only; target is ${dbLabel}.`);
  }
}

async function main(): Promise<void> {
  const args = parseRetireIdentityOnlyAccountsArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL?.trim();
  if (!mongoUrl) {
    throw new Error(
      'MONGODBURL is required. A worktree has no server/.env of its own, so copy or symlink one in.',
    );
  }
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });
  assertDevelopmentTarget(guard.dbLabel);

  await connectScriptMongo(mongoUrl);
  try {
    const db = mongoose.connection.db!;
    const plan = await planIdentityOnlyAccountRetirement(db);
    let backup: string | null = null;
    let result = null;
    if (args.apply) {
      const ids = plan.retirable.map((row) => row.accountId);
      const rows = await db
        .collection('accounts')
        .find({ _id: { $in: ids } })
        .toArray();
      const links = plan.retirable.filter((row) => row.linkedResearcherIds.length > 0);
      backup = path.join(os.tmpdir(), `retire-identity-only-accounts-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify({ accounts: rows, links }), { mode: 0o600 });
      result = await applyIdentityOnlyAccountRetirement(db, plan);
    }
    console.log(
      JSON.stringify({
        script: SCRIPT_NAME,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        candidates: plan.candidates,
        retirable: plan.retirable.length,
        linkedResearchers: plan.retirable.reduce(
          (sum, row) => sum + row.linkedResearcherIds.length,
          0,
        ),
        identityCopies: plan.identityCopies.length,
        held: plan.held,
        loginAccountsKept: plan.loginAccountsKept,
        backup,
        result,
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
