import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  applyLocalPartNetidMerges,
  countReferencesToRepoint,
  planLocalPartNetidMerges,
  projectedSharedEmailGroupsAfterApply,
  type LocalPartMergeApplyResult,
} from './mergeLocalPartNetidAccountsCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'accounts:merge-local-part-netid-twins';
export const MERGE_CONFIRM_FLAG = '--confirm-merge-local-part-netid-twins';

export interface MergeLocalPartNetidAccountsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply?: number;
  output?: string;
}

function parseMaxApply(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

export function parseMergeLocalPartNetidAccountsArgs(
  argv: string[],
): MergeLocalPartNetidAccountsArgs {
  const args: MergeLocalPartNetidAccountsArgs = { apply: false, confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === MERGE_CONFIRM_FLAG) args.confirm = true;
    else if (arg === '--max-apply') {
      args.maxApply = parseMaxApply(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--max-apply=')) {
      args.maxApply = parseMaxApply(arg.slice('--max-apply='.length));
    } else if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

export function assertMergeLocalPartNetidAccountsApplyAllowed(
  args: MergeLocalPartNetidAccountsArgs,
  databaseName: string | undefined,
): void {
  if (!args.apply) return;
  if (!args.confirm) throw new Error(`${MERGE_CONFIRM_FLAG} is required when --apply is set.`);
  if (args.maxApply === undefined) throw new Error('--max-apply is required when --apply is set.');
  // Beta and Production receive accounts through sync and promotion, never through this.
  if (databaseName !== 'Development') {
    throw new Error(
      `${SCRIPT_NAME} apply is restricted to the Development database (resolved: ${databaseName || 'unknown'}).`,
    );
  }
}

export function assertMergeCountWithinCap(planned: number, maxApply: number | undefined): void {
  if (maxApply !== undefined && planned > maxApply) {
    throw new Error(`Apply would merge ${planned} accounts, above --max-apply=${maxApply}.`);
  }
}

async function main(): Promise<void> {
  const args = parseMergeLocalPartNetidAccountsArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL?.trim();
  if (!mongoUrl) throw new Error(`MONGODBURL is required for ${SCRIPT_NAME}.`);
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });

  await connectScriptMongo(mongoUrl);
  try {
    const db = mongoose.connection.db!;
    assertMergeLocalPartNetidAccountsApplyAllowed(args, db.databaseName);
    const plan = await planLocalPartNetidMerges(db);
    let applied: LocalPartMergeApplyResult | null = null;
    if (args.apply) {
      assertMergeCountWithinCap(plan.merges.length, args.maxApply);
      applied = await applyLocalPartNetidMerges(db, plan.merges);
    }
    const report = {
      script: SCRIPT_NAME,
      db: guard.dbLabel,
      mode: args.apply ? 'apply' : 'dry-run',
      sharedEmailGroups: plan.sharedEmailGroups,
      plannedMerges: plan.merges.length,
      referencesHeldByPlannedMerges: await countReferencesToRepoint(db, plan.merges),
      refusals: plan.refusals,
      localPartAccountsWithoutTwin: plan.localPartAccountsWithoutTwin,
      projectedSharedEmailGroupsAfterApply: projectedSharedEmailGroupsAfterApply(plan),
      applied,
    };
    if (args.output) {
      fs.mkdirSync(path.dirname(args.output), { recursive: true });
      fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(JSON.stringify(report));
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
