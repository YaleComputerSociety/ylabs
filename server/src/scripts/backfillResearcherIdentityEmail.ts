/**
 * Copies each live researcher's linked account email onto `Researcher.identifiers.email`
 * (#5000).
 *
 * `accounts` is becoming login-only, so a researcher's email has to live on the researcher
 * before the accounts no one ever signed into can be removed. The roster reads
 * `identifiers.email` first, so a copied value serves exactly what the account served.
 *
 * It is dry-run by default. It never overwrites an email a researcher already holds, and it
 * skips the `@example.invalid` placeholder a login without a Yalies email stores. Run it
 * against Development only: Beta and Production receive researchers through promotion.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import type { AnyBulkWriteOperation, Db, Document, ObjectId } from 'mongodb';
import { connectScriptMongo } from '../db/connections';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'researchers:backfill-identity-email';

const SERVABLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_EMAIL_DOMAIN = '@example.invalid';

export interface BackfillResearcherIdentityEmailArgs {
  apply: boolean;
}

export function parseBackfillResearcherIdentityEmailArgs(
  argv: string[],
): BackfillResearcherIdentityEmailArgs {
  const args: BackfillResearcherIdentityEmailArgs = { apply: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

export function copyableAccountEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!SERVABLE_EMAIL.test(normalized)) return null;
  if (normalized.endsWith(PLACEHOLDER_EMAIL_DOMAIN)) return null;
  return normalized;
}

export interface ResearcherIdentityEmailPlan {
  researchersLinkingAnAccount: number;
  alreadyHoldEmail: number;
  accountMissing: number;
  accountEmailNotCopyable: number;
  updates: Array<{ researcherId: ObjectId; email: string }>;
}

export async function planResearcherIdentityEmailBackfill(
  db: Db,
): Promise<ResearcherIdentityEmailPlan> {
  const researchers = await db
    .collection('researchers')
    .find(
      { archived: { $ne: true }, accountId: { $exists: true, $ne: null } },
      { projection: { _id: 1, accountId: 1, 'identifiers.email': 1 } },
    )
    .toArray();
  const accountIds = researchers.map((researcher) => researcher.accountId);
  const accounts = await db
    .collection('accounts')
    .find({ _id: { $in: accountIds } }, { projection: { _id: 1, email: 1 } })
    .toArray();
  const emailByAccountId = new Map<string, unknown>(
    accounts.map((account: Document) => [String(account._id), account.email]),
  );

  const plan: ResearcherIdentityEmailPlan = {
    researchersLinkingAnAccount: researchers.length,
    alreadyHoldEmail: 0,
    accountMissing: 0,
    accountEmailNotCopyable: 0,
    updates: [],
  };
  for (const researcher of researchers) {
    if (researcher.identifiers?.email) {
      plan.alreadyHoldEmail += 1;
      continue;
    }
    const accountKey = String(researcher.accountId);
    if (!emailByAccountId.has(accountKey)) {
      plan.accountMissing += 1;
      continue;
    }
    const email = copyableAccountEmail(emailByAccountId.get(accountKey));
    if (!email) {
      plan.accountEmailNotCopyable += 1;
      continue;
    }
    plan.updates.push({ researcherId: researcher._id, email });
  }
  return plan;
}

export async function applyResearcherIdentityEmailBackfill(
  db: Db,
  plan: ResearcherIdentityEmailPlan,
): Promise<number> {
  if (plan.updates.length === 0) return 0;
  const operations: AnyBulkWriteOperation[] = plan.updates.map((update) => ({
    updateOne: {
      filter: { _id: update.researcherId, 'identifiers.email': { $exists: false } },
      update: { $set: { 'identifiers.email': update.email } },
    },
  }));
  const result = await db.collection('researchers').bulkWrite(operations, { ordered: false });
  return result.matchedCount;
}

async function main(): Promise<void> {
  const args = parseBackfillResearcherIdentityEmailArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL?.trim();
  if (!mongoUrl) {
    throw new Error(
      'MONGODBURL is required. A worktree has no server/.env of its own, so copy or symlink one in.',
    );
  }
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });

  await connectScriptMongo(mongoUrl);
  try {
    const db = mongoose.connection.db!;
    const plan = await planResearcherIdentityEmailBackfill(db);
    const copied = args.apply ? await applyResearcherIdentityEmailBackfill(db, plan) : null;
    console.log(
      JSON.stringify({
        script: SCRIPT_NAME,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        researchersLinkingAnAccount: plan.researchersLinkingAnAccount,
        alreadyHoldEmail: plan.alreadyHoldEmail,
        accountMissing: plan.accountMissing,
        accountEmailNotCopyable: plan.accountEmailNotCopyable,
        planned: plan.updates.length,
        copied,
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
