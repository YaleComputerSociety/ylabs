import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Account } from '../models/account';
import { Researcher } from '../models/researcher';
import { User } from '../models/user';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertRepairAccountLinkedResearcherDisplayNamesApplyAllowed,
  buildAccountLinkedResearcherDisplayNamePlan,
  parseRepairAccountLinkedResearcherDisplayNamesArgs,
  type AccountLinkedResearcherDisplayNamePlan,
  type AccountLinkedResearcherInput,
} from './repairAccountLinkedResearcherDisplayNamesCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

const asObjectIdKey = (value: unknown): string | undefined =>
  value instanceof mongoose.Types.ObjectId ? value.toString() : undefined;

async function gatherAccountLinkedResearcherInputs(): Promise<AccountLinkedResearcherInput[]> {
  const researchers = await Researcher.find({
    accountId: { $exists: true },
    $or: [{ displayName: { $exists: false } }, { displayName: null }, { displayName: '' }],
  })
    .select('_id accountId')
    .lean();

  if (researchers.length === 0) return [];

  const accountIds = Array.from(
    new Set(researchers.map((researcher: any) => asObjectIdKey(researcher.accountId)).filter(Boolean)),
  ).map((id) => new mongoose.Types.ObjectId(id as string));

  const accounts = accountIds.length
    ? await Account.find({ _id: { $in: accountIds } })
        .select('_id netid')
        .lean()
    : [];
  const netidByAccountId = new Map<string, string>();
  for (const account of accounts as any[]) {
    if (account._id && typeof account.netid === 'string') {
      netidByAccountId.set(account._id.toString(), account.netid);
    }
  }

  const netids = Array.from(new Set([...netidByAccountId.values()]));
  const users = netids.length
    ? await User.find({ netid: { $in: netids } })
        .select('netid fname lname')
        .lean()
    : [];
  const userByNetid = new Map<string, any>();
  for (const user of users as any[]) {
    if (typeof user.netid === 'string') userByNetid.set(user.netid, user);
  }

  return researchers.map((researcher: any) => {
    const netid = researcher.accountId
      ? netidByAccountId.get(researcher.accountId.toString())
      : undefined;
    const user = netid ? userByNetid.get(netid) : undefined;
    return {
      researcherId: researcher._id.toString(),
      netid,
      legacyFirstName: typeof user?.fname === 'string' ? user.fname : undefined,
      legacyLastName: typeof user?.lname === 'string' ? user.lname : undefined,
    };
  });
}

export async function repairAccountLinkedResearcherDisplayNames(options: {
  apply: boolean;
}): Promise<{ mode: 'dry-run' | 'apply'; applied: number } & AccountLinkedResearcherDisplayNamePlan> {
  const inputs = await gatherAccountLinkedResearcherInputs();
  const plan = buildAccountLinkedResearcherDisplayNamePlan(inputs);

  let applied = 0;
  if (options.apply) {
    for (const repair of plan.repairs) {
      await Researcher.updateOne(
        { _id: new mongoose.Types.ObjectId(repair.researcherId) },
        { $set: { displayName: repair.displayName } },
      );
      applied += 1;
    }
  }

  return { mode: options.apply ? 'apply' : 'dry-run', applied, ...plan };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseRepairAccountLinkedResearcherDisplayNamesArgs(process.argv.slice(2));
  assertRepairAccountLinkedResearcherDisplayNamesApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'repair:researcher-display-names',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const result = await repairAccountLinkedResearcherDisplayNames({ apply: args.apply });

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  writeOutput(report, args.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(
        'Failed to repair account-linked researcher display names:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
