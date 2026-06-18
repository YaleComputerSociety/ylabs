/**
 * Queue hygiene: close out the perpetually-"open" formalization-only program queue
 * items. These are funding/formalization fellowships intentionally capped at
 * `limited_but_safe`; because `limited_but_safe` is not a public tier, the visibility
 * gate never resolves their release-queue rows, so they sit "open" forever as noise.
 *
 * This marks the open `review_exception` program items whose blockers include
 * `formalization_only` as `accepted_warning` (an intended, reviewed cap) so the open
 * queue reflects only genuinely-actionable repairs. It does NOT touch record tiers.
 *
 * Dry-run by default. Apply requires `--apply --confirm-accept-formalization-exceptions`.
 *
 *   yarn --cwd server tsx src/scripts/acceptFormalizationReviewExceptions.ts            # dry-run
 *   yarn --cwd server tsx src/scripts/acceptFormalizationReviewExceptions.ts --apply \
 *     --confirm-accept-formalization-exceptions
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { VisibilityReleaseQueueItem } from '../models/visibilityReleaseQueueItem';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

const ACCEPTED_NOTE =
  'Accepted intended cap: formalization-only funding program; safe at limited_but_safe, no entry-route repair available.';

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-accept-formalization-exceptions') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length).trim());
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-accept-formalization-exceptions is required when --apply is set.');
  }
  return options;
}

const FILTER = {
  collection: 'programs' as const,
  status: 'open',
  repairStage: 'review_exception',
  blockerReasons: 'formalization_only',
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'acceptFormalizationReviewExceptions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const matches = await VisibilityReleaseQueueItem.find(FILTER)
    .select('recordId label blockerReasons')
    .lean();

  let modified = 0;
  if (options.apply && matches.length > 0) {
    const now = new Date();
    const result = await VisibilityReleaseQueueItem.updateMany(FILTER, {
      $set: {
        status: 'accepted_warning',
        repairStatus: 'resolved',
        resolvedAt: now,
        resolvedByTier: 'limited_but_safe',
        lastSeenAt: now,
        nextRepairAction: ACCEPTED_NOTE,
      },
    });
    modified = result.modifiedCount || 0;
  }

  const output = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    matched: matches.length,
    modified,
    sample: matches.slice(0, 10).map((m: any) => m.label),
  };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to accept formalization review exceptions:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
