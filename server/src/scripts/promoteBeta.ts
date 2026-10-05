import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { WeeklySweepRun } from '../models/weeklySweepRun';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import { WEEKLY_RUN_LOOKBACK } from './promoteCore';
import { runPromoteBeta } from './promoteFlowsCore';
import { baseRuntimeDeps } from './promoteRuntime';
import {
  assertSafeDevelopmentToBetaOptions,
  parseDevelopmentToBetaOptions,
} from './syncDevelopmentToBeta';
import { heldSweepSourceLocks } from './weeklyDevelopmentSweep';
import type { StoredWeeklySweepRun } from './weeklySweepRunsReportCore';

export async function promoteBetaMain(argv: string[]): Promise<number> {
  const mirrorOptions = parseDevelopmentToBetaOptions([]);
  assertSafeDevelopmentToBetaOptions(mirrorOptions);
  await connectScriptMongo(mirrorOptions.developmentUrl);
  try {
    return await runPromoteBeta(argv, {
      ...baseRuntimeDeps('beta'),
      loadWeeklyRuns: async (runIds) =>
        (runIds.length > 0
          ? await WeeklySweepRun.find({
              _id: { $in: runIds.filter((id) => mongoose.isValidObjectId(id)) },
            })
              .sort({ startedAt: -1 })
              .lean()
          : await WeeklySweepRun.find({})
              .sort({ startedAt: -1 })
              .limit(WEEKLY_RUN_LOOKBACK)
              .lean()) as unknown as StoredWeeklySweepRun[],
      heldSweepLocks: heldSweepSourceLocks,
    });
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectScriptInvocation(import.meta.url, 'promoteBeta')) {
  promoteBetaMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[promote:beta] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
