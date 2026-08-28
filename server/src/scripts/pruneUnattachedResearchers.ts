import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { Account } from '../models/account';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';
import {
  planUnattachedResearcherPrune,
  type PrunableResearcher,
} from './pruneUnattachedResearchersCore';

dotenv.config();

const SCRIPT_NAME = 'research:prune-unattached-researchers';

export interface PruneUnattachedResearchersCliOptions {
  apply: boolean;
  confirmPruneUnattachedResearchers: boolean;
  output?: string;
}

export function parsePruneUnattachedResearchersArgs(
  argv: string[],
): PruneUnattachedResearchersCliOptions {
  const options: PruneUnattachedResearchersCliOptions = {
    apply: false,
    confirmPruneUnattachedResearchers: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-prune-unattached-researchers') {
      options.confirmPruneUnattachedResearchers = true;
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

export function assertDevelopmentTarget(mongoUrl: string | undefined): void {
  let database = '';
  try {
    database = new URL(mongoUrl || '').pathname.replace(/^\//, '');
  } catch {
    database = '';
  }
  if (database.toLowerCase() !== 'development') {
    throw new Error(
      `${SCRIPT_NAME} only applies against the Development database; refusing target "${database || '(unknown)'}".`,
    );
  }
}

export function assertPruneUnattachedResearchersApplyAllowed(
  options: Pick<PruneUnattachedResearchersCliOptions, 'apply' | 'confirmPruneUnattachedResearchers'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !options.confirmPruneUnattachedResearchers) {
    throw new Error(
      `--confirm-prune-unattached-researchers is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  if (options.apply) {
    assertDevelopmentTarget(mongoUrl);
  }
  return assertScriptApplyAllowed({ apply: options.apply, scriptName: SCRIPT_NAME, mongoUrl, env });
}

async function main() {
  const options = parsePruneUnattachedResearchersArgs(process.argv.slice(2));
  const guard = assertPruneUnattachedResearchersApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();

  const [researcherRows, rolePersonIds, dedupeTargetIds, loginAccountRows] = await Promise.all([
    Researcher.find({}, { accountId: 1, displayName: 1, dedupedIntoResearcherId: 1 }).lean(),
    RoleAssignment.distinct('personId'),
    Researcher.distinct('dedupedIntoResearcherId', { dedupedIntoResearcherId: { $ne: null } }),
    Account.find({ lastLoginAt: { $exists: true, $ne: null } }, { _id: 1 }).lean(),
  ]);

  const researchers: PrunableResearcher[] = researcherRows.map((row: any) => ({
    id: serializedDocumentId(row._id) || '',
    accountId: row.accountId ? serializedDocumentId(row.accountId) || undefined : undefined,
    displayName: row.displayName,
    hasDedupedInto: Boolean(row.dedupedIntoResearcherId),
  }));

  const plan = planUnattachedResearcherPrune({
    researchers,
    rolePersonIds: rolePersonIds.map((id: any) => serializedDocumentId(id) || '').filter(Boolean),
    dedupeTargetIds: dedupeTargetIds
      .map((id: any) => serializedDocumentId(id) || '')
      .filter(Boolean),
    accountsWithLogin: loginAccountRows
      .map((row: any) => serializedDocumentId(row._id) || '')
      .filter(Boolean),
  });

  if (options.apply) {
    if (plan.researcherIdsToDelete.length > 0) {
      await Researcher.deleteMany({ _id: { $in: plan.researcherIdsToDelete } });
    }
    if (plan.accountIdsToDelete.length > 0) {
      await Account.deleteMany({ _id: { $in: plan.accountIdsToDelete } });
    }
  }

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scanned: plan.scanned,
    attached: plan.attached,
    dedupeInvolved: plan.dedupeInvolved,
    researchersToDelete: plan.researcherIdsToDelete.length,
    accountsToDelete: plan.accountIdsToDelete.length,
    accountsRetainedForLogin: plan.accountsRetainedForLogin,
    sample: plan.sample,
  };

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to prune unattached researchers:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
