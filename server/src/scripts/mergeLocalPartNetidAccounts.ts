import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  applyLocalPartNetidMerges,
  applyLoneLocalPartArchives,
  countReferencesToRepoint,
  planLocalPartNetidMerges,
  planLoneLocalPartArchives,
  projectedSharedEmailGroupsAfterApply,
} from './mergeLocalPartNetidAccountsCore';
import {
  applyLocalPartTwinResearcherMerges,
  planLocalPartTwinResearcherMerges,
  summarizeTwinResearcherMergeEdits,
} from './mergeLocalPartTwinResearchersCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'accounts:merge-local-part-netid-twins';
export const MERGE_CONFIRM_FLAG = '--confirm-merge-local-part-netid-twins';

export const MERGE_SCOPES = ['account-twins', 'researcher-twins', 'lone-accounts'] as const;
export type MergeScope = (typeof MERGE_SCOPES)[number];

export interface MergeLocalPartNetidAccountsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply?: number;
  output?: string;
  scope: MergeScope;
}

function parseScope(value: string | undefined): MergeScope {
  if (!value || !(MERGE_SCOPES as readonly string[]).includes(value)) {
    throw new Error(`--scope must be one of ${MERGE_SCOPES.join(', ')}`);
  }
  return value as MergeScope;
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
  const args: MergeLocalPartNetidAccountsArgs = {
    apply: false,
    confirm: false,
    scope: 'account-twins',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === MERGE_CONFIRM_FLAG) args.confirm = true;
    else if (arg === '--scope') {
      args.scope = parseScope(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--scope=')) args.scope = parseScope(arg.slice('--scope='.length));
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
    throw new Error(`Apply would write ${planned} rows, above --max-apply=${maxApply}.`);
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
    const twins = await planLocalPartNetidMerges(db);
    const researcherTwins = await planLocalPartTwinResearcherMerges(db);
    const lone = await planLoneLocalPartArchives(db);
    const planned: Record<MergeScope, number> = {
      'account-twins': twins.merges.length,
      'researcher-twins': researcherTwins.merges.length,
      'lone-accounts': lone.archives.length,
    };
    let applied: unknown = null;
    if (args.apply) {
      assertMergeCountWithinCap(planned[args.scope], args.maxApply);
      if (args.scope === 'account-twins') {
        applied = await applyLocalPartNetidMerges(db, twins.merges);
      } else if (args.scope === 'lone-accounts') {
        applied = await applyLoneLocalPartArchives(db, lone.archives);
      } else {
        const merged = await applyLocalPartTwinResearcherMerges(db, researcherTwins.merges);
        // A merge edits the roster of every row the loser held an edge on, so the gate re-reads
        // those rows rather than this script writing a tier.
        if (merged.touchedEntityIds.length > 0) {
          await runStudentVisibilityGate({
            collection: 'research',
            mode: 'apply',
            recordIds: merged.touchedEntityIds,
          });
        }
        const { touchedEntityIds, ...counts } = merged;
        applied = { ...counts, regatedEntities: touchedEntityIds.length };
      }
    }
    const report = {
      script: SCRIPT_NAME,
      db: guard.dbLabel,
      mode: args.apply ? 'apply' : 'dry-run',
      scope: args.scope,
      sharedEmailGroups: twins.sharedEmailGroups,
      plannedMerges: twins.merges.length,
      referencesHeldByPlannedMerges: await countReferencesToRepoint(db, twins.merges),
      refusals: twins.refusals,
      localPartAccountsWithoutTwin: twins.localPartAccountsWithoutTwin,
      projectedSharedEmailGroupsAfterApply: projectedSharedEmailGroupsAfterApply(twins),
      researcherTwins: {
        pairsWithBothResearchers: researcherTwins.pairsWithBothResearchers,
        plannedMerges: researcherTwins.merges.length,
        held: researcherTwins.held,
        edits: await summarizeTwinResearcherMergeEdits(db, researcherTwins.merges),
      },
      offShapePairsHeld: twins.refusals['off-shape-pair'],
      loneAccounts: {
        loneLocalPartAccounts: lone.loneLocalPartAccounts,
        plannedArchives: lone.archives.length,
        held: lone.held,
      },
      projectedSharedEmailGroupsAfterEveryScope:
        twins.sharedEmailGroups - twins.merges.length - researcherTwins.merges.length,
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
