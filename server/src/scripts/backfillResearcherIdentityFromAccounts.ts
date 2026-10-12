/**
 * Copies each live researcher's linked account netid and email onto
 * `Researcher.identifiers` (#5000).
 *
 * `accounts` is becoming login-only, so a researcher's identity has to live on the researcher
 * before the accounts no one ever signed into can be removed. Every reader prefers
 * `identifiers` and falls back to the linked account, so a copied value serves and joins
 * exactly what the account did.
 *
 * It is dry-run by default. It never overwrites a value a researcher already holds, skips the
 * `@example.invalid` placeholder a login without a Yalies email stores, and skips a netid
 * another researcher already holds, because `identifiers.netid` is unique. Run it against
 * Development only: Beta and Production receive researchers through promotion.
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

export const SCRIPT_NAME = 'researchers:backfill-identity-from-accounts';

const SERVABLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_EMAIL_DOMAIN = '@example.invalid';

export interface BackfillResearcherIdentityArgs {
  apply: boolean;
}

export function parseBackfillResearcherIdentityArgs(
  argv: string[],
): BackfillResearcherIdentityArgs {
  const args: BackfillResearcherIdentityArgs = { apply: false };
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

export function copyableAccountNetid(netid: unknown): string | null {
  if (typeof netid !== 'string') return null;
  const normalized = netid.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 64 ? normalized : null;
}

export interface FieldBackfillCounts {
  alreadyHeld: number;
  notCopyable: number;
  heldByAnotherResearcher: number;
  planned: number;
}

export interface ResearcherIdentityPlan {
  researchersLinkingAnAccount: number;
  accountMissing: number;
  email: FieldBackfillCounts;
  netid: FieldBackfillCounts;
  updates: Array<{ researcherId: ObjectId; set: { email?: string; netid?: string } }>;
}

const emptyCounts = (): FieldBackfillCounts => ({
  alreadyHeld: 0,
  notCopyable: 0,
  heldByAnotherResearcher: 0,
  planned: 0,
});

export async function planResearcherIdentityBackfill(db: Db): Promise<ResearcherIdentityPlan> {
  const researchers = await db
    .collection('researchers')
    .find(
      { archived: { $ne: true }, accountId: { $exists: true, $ne: null } },
      { projection: { _id: 1, accountId: 1, identifiers: 1 } },
    )
    .toArray();
  const accounts = await db
    .collection('accounts')
    .find(
      { _id: { $in: researchers.map((researcher) => researcher.accountId) } },
      { projection: { _id: 1, email: 1, netid: 1 } },
    )
    .toArray();
  const accountById = new Map<string, Document>(
    accounts.map((account: Document) => [String(account._id), account]),
  );
  const netidHolders = new Map<string, string>(
    (
      await db
        .collection('researchers')
        .find(
          { 'identifiers.netid': { $exists: true } },
          { projection: { 'identifiers.netid': 1 } },
        )
        .toArray()
    ).map((holder) => [String(holder.identifiers.netid), String(holder._id)]),
  );

  const plan: ResearcherIdentityPlan = {
    researchersLinkingAnAccount: researchers.length,
    accountMissing: 0,
    email: emptyCounts(),
    netid: emptyCounts(),
    updates: [],
  };
  for (const researcher of researchers) {
    const account = accountById.get(String(researcher.accountId));
    if (!account) {
      plan.accountMissing += 1;
      continue;
    }
    const set: { email?: string; netid?: string } = {};

    if (researcher.identifiers?.email) plan.email.alreadyHeld += 1;
    else {
      const email = copyableAccountEmail(account.email);
      if (email) set.email = email;
      else plan.email.notCopyable += 1;
    }

    if (researcher.identifiers?.netid) plan.netid.alreadyHeld += 1;
    else {
      const netid = copyableAccountNetid(account.netid);
      const holder = netid ? netidHolders.get(netid) : undefined;
      if (!netid) plan.netid.notCopyable += 1;
      else if (holder && holder !== String(researcher._id)) plan.netid.heldByAnotherResearcher += 1;
      else {
        set.netid = netid;
        netidHolders.set(netid, String(researcher._id));
      }
    }

    if (set.email) plan.email.planned += 1;
    if (set.netid) plan.netid.planned += 1;
    if (set.email || set.netid) plan.updates.push({ researcherId: researcher._id, set });
  }
  return plan;
}

export async function applyResearcherIdentityBackfill(
  db: Db,
  plan: ResearcherIdentityPlan,
): Promise<number> {
  const operations: AnyBulkWriteOperation[] = plan.updates.flatMap(({ researcherId, set }) =>
    Object.entries(set).map(([field, value]) => ({
      updateOne: {
        filter: { _id: researcherId, [`identifiers.${field}`]: { $exists: false } },
        update: { $set: { [`identifiers.${field}`]: value } },
      },
    })),
  );
  if (operations.length === 0) return 0;
  const result = await db.collection('researchers').bulkWrite(operations, { ordered: false });
  return result.modifiedCount;
}

async function main(): Promise<void> {
  const args = parseBackfillResearcherIdentityArgs(process.argv.slice(2));
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
    const plan = await planResearcherIdentityBackfill(db);
    const fieldsCopied = args.apply ? await applyResearcherIdentityBackfill(db, plan) : null;
    console.log(
      JSON.stringify({
        script: SCRIPT_NAME,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        researchersLinkingAnAccount: plan.researchersLinkingAnAccount,
        accountMissing: plan.accountMissing,
        email: plan.email,
        netid: plan.netid,
        fieldsCopied,
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
