import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildMismatchedPersonEmailRepairPlan,
  parseRepairMismatchedPersonEmailsArgs,
  type MismatchedExternalIdentityRepairPlan,
  type MismatchedPersonEmailInputUser,
  type MismatchedPersonEmailRepairPlan,
  type RepairMismatchedPersonEmailsArgs,
} from './repairMismatchedPersonEmailsCore';

dotenv.config();

const REPAIR_SOURCE = 'mismatched-person-email-repair';

export function assertRepairMismatchedPersonEmailsApplyAllowed(
  args: RepairMismatchedPersonEmailsArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
  plannedRepairs?: number,
) {
  if (args.apply) {
    if (!args.confirmMismatchedEmailRepair) {
      throw new Error(
        '--confirm-mismatched-email-repair is required when --apply is set for users:repair-mismatched-emails.',
      );
    }
    if (!args.limitProvided) {
      throw new Error('--limit is required when --apply is set for users:repair-mismatched-emails.');
    }
    if (!args.maxApply) {
      throw new Error('--max-apply is required when --apply is set.');
    }
    if (plannedRepairs !== undefined) {
      if (plannedRepairs <= 0) {
        throw new Error('Apply requires at least one mismatched person email repair.');
      }
      if (plannedRepairs > args.maxApply) {
        throw new Error(`Apply would update ${plannedRepairs} users, above --max-apply.`);
      }
    }
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'users:repair-mismatched-emails',
    mongoUrl,
    env,
  });
}

function writeOutput(summary: object, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(summary, null, 2)}\n`);
}

async function loadUsers(limit: number): Promise<{
  users: MismatchedPersonEmailInputUser[];
  activeEmailsByUserId: Map<string, string>;
}> {
  const activeRows = await User.find({
    archived: { $ne: true },
  })
    .select('_id netid fname lname email orcid profileUrls')
    .sort({ email: 1, _id: 1 })
    .lean()
    .exec();

  const emailCounts = new Map<string, number>();
  for (const user of activeRows) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!/@yale\.edu$/i.test(email)) continue;
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }
  const duplicateEmails = new Set(
    [...emailCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([email]) => email),
  );
  const orcidCounts = new Map<string, number>();
  for (const user of activeRows) {
    const orcid = String(user.orcid || '').trim();
    if (!orcid) continue;
    orcidCounts.set(orcid, (orcidCounts.get(orcid) || 0) + 1);
  }
  const duplicateOrcids = new Set(
    [...orcidCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([orcid]) => orcid),
  );

  const candidateRows = activeRows
    .filter(
      (user) =>
        duplicateEmails.has(String(user.email || '').trim().toLowerCase()) ||
        duplicateOrcids.has(String(user.orcid || '').trim()),
    )
    .slice(0, limit);

  return {
    users: candidateRows.map((user) => ({
      id: String(user._id || ''),
      netid: user.netid,
      fname: user.fname,
      lname: user.lname,
      email: user.email,
      orcid: user.orcid || undefined,
      profileUrls: user.profileUrls,
    })),
    activeEmailsByUserId: new Map(
      activeRows.map((user) => [String(user._id || ''), String(user.email || '')]),
    ),
  };
}

async function applyRepairs(
  repairs: MismatchedPersonEmailRepairPlan[],
  externalIdentityRepairs: MismatchedExternalIdentityRepairPlan[],
): Promise<Array<Record<string, unknown>>> {
  const applied: Array<Record<string, unknown>> = [];

  for (const repair of repairs) {
    const result = await User.updateOne(
      {
        _id: repair.userId,
        archived: { $ne: true },
        email: repair.currentEmail,
      },
      {
        $set: {
          email: repair.repairEmail,
          updatedAt: new Date(),
        },
        $addToSet: {
          dataSources: REPAIR_SOURCE,
        },
      },
    );
    applied.push({
      ...repair,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  }

  for (const repair of externalIdentityRepairs) {
    const unsetPatch: Record<string, ''> = {};
    if (repair.clearOrcid) unsetPatch.orcid = '';
    for (const key of repair.removeProfileUrlKeys) {
      unsetPatch[`profileUrls.${key}`] = '';
    }

    const result = await User.updateOne(
      {
        _id: repair.userId,
        archived: { $ne: true },
        ...(repair.clearOrcid ? { orcid: repair.identityValue } : {}),
      },
      {
        ...(Object.keys(unsetPatch).length ? { $unset: unsetPatch } : {}),
        $set: {
          updatedAt: new Date(),
        },
        $addToSet: {
          dataSources: REPAIR_SOURCE,
        },
      },
    );
    applied.push({
      ...repair,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  }

  return applied;
}

export async function runRepairMismatchedPersonEmails(
  args: RepairMismatchedPersonEmailsArgs,
) {
  const { users, activeEmailsByUserId } = await loadUsers(args.limit);
  const plan = buildMismatchedPersonEmailRepairPlan({ users, activeEmailsByUserId });
  const allRepairs = [...plan.repairs, ...plan.externalIdentityRepairs];
  const repairsToApply = args.maxApply ? allRepairs.slice(0, args.maxApply) : allRepairs;
  const emailRepairsToApply = repairsToApply.filter(
    (repair): repair is MismatchedPersonEmailRepairPlan => 'repairEmail' in repair,
  );
  const externalIdentityRepairsToApply = repairsToApply.filter(
    (repair): repair is MismatchedExternalIdentityRepairPlan => 'identityField' in repair,
  );
  assertRepairMismatchedPersonEmailsApplyAllowed(
    args,
    process.env,
    undefined,
    repairsToApply.length,
  );
  const applied = args.apply
    ? await applyRepairs(emailRepairsToApply, externalIdentityRepairsToApply)
    : [];

  return {
    mode: args.apply ? 'apply' : 'dry-run',
    scannedUsers: users.length,
    candidateUsers: plan.candidateUsers,
    repairableUsers: repairsToApply.length,
    skippedUsers: plan.skippedUsers,
    repairs: emailRepairsToApply,
    externalIdentityRepairs: externalIdentityRepairsToApply,
    skipped: plan.skipped,
    applied,
  };
}

async function main() {
  const args = parseRepairMismatchedPersonEmailsArgs(process.argv.slice(2));
  const guard = assertRepairMismatchedPersonEmailsApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const summary = await runRepairMismatchedPersonEmails(args);
  const output = {
    ...summary,
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options: args,
  };
  console.log(JSON.stringify(output, null, 2));
  writeOutput(output, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
