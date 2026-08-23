import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Account } from '../models/account';
import { User } from '../models/user';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildFusedIdentityArtifactPlan,
  parseRepairFusedIdentityArtifactsArgs,
  type FusedIdentityArchivePlan,
  type FusedIdentityArtifactInputUser,
  type RepairFusedIdentityArtifactsArgs,
} from './repairFusedIdentityArtifactsCore';

dotenv.config();

export function assertRepairFusedIdentityArtifactsApplyAllowed(
  args: RepairFusedIdentityArtifactsArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
  plannedArchives?: number,
) {
  if (args.apply) {
    if (!args.confirmFusedIdentityArchive) {
      throw new Error(
        '--confirm-fused-identity-archive is required when --apply is set for users:repair-fused-identity-artifacts.',
      );
    }
    if (!args.limitProvided) {
      throw new Error('--limit is required when --apply is set for users:repair-fused-identity-artifacts.');
    }
    if (!args.maxApply) {
      throw new Error('--max-apply is required when --apply is set.');
    }
    if (plannedArchives !== undefined) {
      if (plannedArchives <= 0) {
        throw new Error('Apply requires at least one fused-identity artifact to archive.');
      }
      if (plannedArchives > args.maxApply) {
        throw new Error(`Apply would archive ${plannedArchives} users, above --max-apply.`);
      }
    }
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'users:repair-fused-identity-artifacts',
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
  users: FusedIdentityArtifactInputUser[];
  activeEmailsByUserId: Map<string, string>;
  netidsWithLoginAccounts: Set<string>;
}> {
  const activeRows = await User.find({ archived: { $ne: true } })
    .select('_id netid fname lname email')
    .sort({ email: 1, _id: 1 })
    .lean()
    .exec();

  const accountNetids = (await Account.distinct('netid')) as string[];
  const netidsWithLoginAccounts = new Set(
    accountNetids.map((netid) => String(netid || '').trim().toLowerCase()).filter(Boolean),
  );

  const activeEmailsByUserId = new Map(
    activeRows.map((user) => [String(user._id || ''), String(user.email || '')]),
  );

  return {
    users: activeRows.slice(0, limit).map((user) => ({
      id: String(user._id || ''),
      netid: user.netid,
      fname: user.fname,
      lname: user.lname,
      email: user.email,
    })),
    activeEmailsByUserId,
    netidsWithLoginAccounts,
  };
}

async function applyArchives(
  archives: FusedIdentityArchivePlan[],
): Promise<Array<Record<string, unknown>>> {
  const applied: Array<Record<string, unknown>> = [];
  const archivedAt = new Date();

  for (const archive of archives) {
    const result = await User.updateOne(
      { _id: archive.userId, archived: { $ne: true } },
      {
        $set: {
          archived: true,
          dedupedIntoUserId: archive.canonicalUserId,
          dedupedAt: archivedAt,
          dedupeReason: 'fused_identity_conflation',
          dedupedIdentityField: 'email',
          dedupedIdentityValue: archive.email,
          updatedAt: archivedAt,
        },
      },
    );
    applied.push({
      ...archive,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  }

  return applied;
}

export async function runRepairFusedIdentityArtifacts(
  args: RepairFusedIdentityArtifactsArgs,
) {
  const { users, activeEmailsByUserId, netidsWithLoginAccounts } = await loadUsers(args.limit);
  const plan = buildFusedIdentityArtifactPlan({ users, activeEmailsByUserId, netidsWithLoginAccounts });
  const archivesToApply = args.maxApply ? plan.archives.slice(0, args.maxApply) : plan.archives;
  assertRepairFusedIdentityArtifactsApplyAllowed(
    args,
    process.env,
    undefined,
    archivesToApply.length,
  );
  const applied = args.apply ? await applyArchives(archivesToApply) : [];

  return {
    mode: args.apply ? 'apply' : 'dry-run',
    scannedUsers: users.length,
    candidateUsers: plan.candidateUsers,
    archivableUsers: archivesToApply.length,
    skippedUsers: plan.skippedUsers,
    archives: archivesToApply,
    skipped: plan.skipped,
    applied,
  };
}

async function main() {
  const args = parseRepairFusedIdentityArtifactsArgs(process.argv.slice(2));
  const guard = assertRepairFusedIdentityArtifactsApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const summary = await runRepairFusedIdentityArtifacts(args);
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
