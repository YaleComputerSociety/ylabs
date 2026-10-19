/**
 * research-entity:plan-roster-mint-withdrawal - reads what the roster mint withdrawal
 * would do for one roster run, and writes nothing (#5380).
 *
 * It takes the plan from the reconciler itself, so it cannot disagree with the
 * materialize pass that applies it. The per-row file carries slugs, so it is written
 * with mode 0600 and belongs under `/tmp`, never in a commit or an issue.
 *
 *   yarn --cwd server research-entity:plan-roster-mint-withdrawal --run <scrapeRunId>
 *   yarn --cwd server research-entity:plan-roster-mint-withdrawal --run <id> --output /tmp/plan.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { reconcileRosterMintWithdrawalsFromRun } from '../scrapers/rosterMintWithdrawal';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export function parseRosterMintWithdrawalPlanArgs(argv: readonly string[]): {
  runId: string;
  output?: string;
} {
  let runId = '';
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') runId = argv[(index += 1)] ?? '';
    else if (arg.startsWith('--run=')) runId = arg.slice('--run='.length);
    else if (arg === '--output') output = resolveSafeJsonReportOutputPath(argv[(index += 1)]);
    else if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!mongoose.Types.ObjectId.isValid(runId)) throw new Error('--run <scrapeRunId> is required');
  return { runId, ...(output ? { output } : {}) };
}

async function main(): Promise<void> {
  const options = parseRosterMintWithdrawalPlanArgs(process.argv.slice(2));
  await initializeConnections();
  try {
    const plan = await reconcileRosterMintWithdrawalsFromRun(options.runId, { dryRun: true });
    const archivedByTier: Record<string, number> = {};
    for (const row of plan.rows) {
      if (row.action !== 'archive') continue;
      archivedByTier[row.tier || 'unset'] = (archivedByTier[row.tier || 'unset'] ?? 0) + 1;
    }
    console.log(
      JSON.stringify(
        {
          mode: 'plan',
          runId: options.runId,
          outcome: plan.outcome,
          counts: plan.counts,
          archivedByTier,
          departments: plan.departments.map(({ withdrawnSlugs, ...department }) => ({
            ...department,
            withdrawnRows: withdrawnSlugs.length,
          })),
        },
        null,
        2,
      ),
    );
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
      console.log(`\nPer-row plan written to ${options.output}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  main().catch((error) => {
    console.error('Failed to plan the roster mint withdrawal:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
