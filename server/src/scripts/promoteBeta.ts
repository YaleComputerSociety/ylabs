import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { WeeklySweepRun } from '../models/weeklySweepRun';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
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
      loadWeeklyRun: async (runId) =>
        (runId
          ? await WeeklySweepRun.findById(runId).lean()
          : await WeeklySweepRun.findOne({})
              .sort({ startedAt: -1 })
              .lean()) as unknown as StoredWeeklySweepRun | null,
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
