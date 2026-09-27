import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { LaneBenchmark } from '../models/laneBenchmark';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { parseGoldLabelFile } from './laneBenchmarkLabelCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'lane:benchmark-label';
export const CONFIRM_FLAG = '--confirm-lane-benchmark-label';

export interface LabelArgs {
  benchmarkId: string;
  file: string;
  replace: boolean;
  dryRun: boolean;
  confirmed: boolean;
}

export function parseLabelArgs(argv: string[]): LabelArgs {
  const args: Partial<LabelArgs> & { replace: boolean; dryRun: boolean; confirmed: boolean } = {
    replace: false,
    dryRun: true,
    confirmed: false,
  };
  for (const arg of argv) {
    if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === CONFIRM_FLAG) args.confirmed = true;
    else if (arg === '--replace') args.replace = true;
    else if (arg.startsWith('--id=')) args.benchmarkId = arg.slice('--id='.length).trim();
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length).trim();
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!args.benchmarkId) throw new Error(`${SCRIPT_NAME} requires --id=<benchmark-id>`);
  if (!args.file) throw new Error(`${SCRIPT_NAME} requires --file=<labels.json>`);
  return args as LabelArgs;
}

async function main(): Promise<void> {
  const args = parseLabelArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !args.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!args.dryRun && !args.confirmed)
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.dryRun ? 'dry-run' : 'apply'}`,
  );
  await initializeConnections();

  const benchmark = (await LaneBenchmark.findOne({ benchmarkId: args.benchmarkId })
    .select('benchmarkId only goldLabels')
    .lean()) as { only?: string[]; goldLabels?: unknown[] } | null;
  if (!benchmark) throw new Error(`No benchmark ${args.benchmarkId}`);
  if ((benchmark.goldLabels?.length ?? 0) > 0 && !args.replace) {
    throw new Error(
      `Benchmark ${args.benchmarkId} already carries gold labels; pass --replace to supersede them`,
    );
  }
  const labels = parseGoldLabelFile(JSON.parse(fs.readFileSync(args.file, 'utf8')), {
    only: benchmark.only ?? [],
  });
  const byField: Record<string, { present: number; absent: number }> = {};
  for (const label of labels) {
    byField[label.field] ??= { present: 0, absent: 0 };
    byField[label.field][label.expected] += 1;
  }
  if (!args.dryRun) {
    await LaneBenchmark.updateOne(
      { benchmarkId: args.benchmarkId },
      { $set: { goldLabels: labels, goldLabeledAt: new Date() } },
    );
  }
  console.log(
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        mode: args.dryRun ? 'dry-run' : 'apply',
        benchmarkId: args.benchmarkId,
        labelCount: labels.length,
        byField,
        replaced: (benchmark.goldLabels?.length ?? 0) > 0,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
