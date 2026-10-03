import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { WeeklySweepRun } from '../models/weeklySweepRun';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  formatWeeklySweepRuns,
  formatWeeklySweepRunsComparison,
  parseWeeklySweepRunsReportArgs,
  type StoredWeeklySweepRun,
} from './weeklySweepRunsReportCore';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
  quiet: true,
});

export async function runWeeklySweepRunsReport(argv: string[]): Promise<number> {
  const args = parseWeeklySweepRunsReportArgs(argv);
  if (!process.env.MONGODBURL) {
    console.error('MONGODBURL is required');
    return 1;
  }
  await connectScriptMongo(process.env.MONGODBURL);
  try {
    const runs = (await WeeklySweepRun.find({})
      .sort({ startedAt: -1 })
      .limit(args.limit)
      .lean()) as unknown as StoredWeeklySweepRun[];
    console.log(`Database ${mongoose.connection.db?.databaseName ?? 'unknown'}\n`);
    if (args.json) {
      console.log(JSON.stringify(runs, null, 2));
    } else if (args.compare) {
      console.log(formatWeeklySweepRunsComparison(runs));
    } else {
      console.log(formatWeeklySweepRuns(runs));
    }
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectScriptInvocation(import.meta.url, 'weeklySweepRunsReport')) {
  runWeeklySweepRunsReport(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[weekly-sweep:runs] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
