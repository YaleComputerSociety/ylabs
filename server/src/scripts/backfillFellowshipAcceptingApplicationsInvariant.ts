/**
 * Backfill of the stored-data invariant from #1346: `isAcceptingApplications` must
 * not be `true` while `deadline` is already in the past. The read-time serializer
 * (`publicFellowshipForStudent`) already corrects this for students, but the raw
 * stored field still carries the contradiction, so any consumer that trusts it
 * directly (admin table, an "Open Only" filter, future notification logic) would
 * mislabel these records as open.
 *
 * Dry-run by default. Apply requires `--apply --confirm-accepting-applications-invariant-backfill`.
 *
 *   yarn --cwd server tsx src/scripts/backfillFellowshipAcceptingApplicationsInvariant.ts
 *   yarn --cwd server tsx src/scripts/backfillFellowshipAcceptingApplicationsInvariant.ts \
 *     --apply --confirm-accepting-applications-invariant-backfill
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose, { type AnyBulkWriteOperation } from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-accepting-applications-invariant-backfill') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(
      '--confirm-accepting-applications-invariant-backfill is required when --apply is set.',
    );
  }
  return options;
}

interface ContradictionEntry {
  recordId: string;
  title: unknown;
  deadline: unknown;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillFellowshipAcceptingApplicationsInvariant',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const now = new Date();
  const records: any[] = await Fellowship.find({
    isAcceptingApplications: true,
    deadline: { $lt: now },
  })
    .select({ title: 1, deadline: 1 })
    .lean();

  const contradictions: ContradictionEntry[] = records.map((record) => ({
    recordId: String(record._id),
    title: record.title,
    deadline: record.deadline,
  }));

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    contradictionsFound: contradictions.length,
  };

  if (options.apply && contradictions.length > 0) {
    const operations: AnyBulkWriteOperation[] = contradictions.map((entry) => ({
      updateOne: {
        filter: { _id: entry.recordId },
        update: { $set: { isAcceptingApplications: false } },
      },
    }));
    await Fellowship.bulkWrite(operations, { ordered: false });
  }

  const output = { summary, contradictions };
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
      console.error(
        'Failed to backfill fellowship accepting-applications invariant:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
