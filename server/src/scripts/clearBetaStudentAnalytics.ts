import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import type { FilterQuery } from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { AnalyticsEvent } from '../models/analytics';
import {
  BETA_STUDENT_ANALYTICS_USER_TYPES,
  buildClearBetaStudentAnalyticsSummary,
  parseClearBetaStudentAnalyticsArgs,
  type ClearBetaStudentAnalyticsArgs,
  type ClearBetaStudentAnalyticsSample,
  type ClearBetaStudentAnalyticsSummary,
} from './clearBetaStudentAnalyticsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export function buildBetaStudentAnalyticsEventFilter(): FilterQuery<typeof AnalyticsEvent> {
  return {
    userType: { $in: [...BETA_STUDENT_ANALYTICS_USER_TYPES] },
    netid: { $nin: ['devadmin', 'test123'], $not: /^(dev|test)/i },
  };
}

export function writeClearBetaStudentAnalyticsOutput(summary: object, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(summary, null, 2)}\n`);
}

export function buildClearBetaStudentAnalyticsOutput<T extends object>(
  summary: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ClearBetaStudentAnalyticsArgs;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options: ClearBetaStudentAnalyticsArgs;
} {
  return {
    generatedAt: new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
    ...summary,
  };
}

export function assertClearBetaStudentAnalyticsApplyAllowed(
  args: ClearBetaStudentAnalyticsArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'beta:clear-student-analytics',
    mongoUrl,
    env,
  });

  if (args.apply && guard.environment !== 'beta') {
    throw new Error('beta:clear-student-analytics apply mode requires SCRAPER_ENV=beta.');
  }
  if (args.apply && !args.confirmClearStudentAnalytics) {
    throw new Error(
      '--confirm-clear-student-analytics is required when --apply is set for beta:clear-student-analytics.',
    );
  }
  if (args.apply && !args.limitProvided) {
    throw new Error('--limit is required when --apply is set for beta:clear-student-analytics.');
  }

  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'beta:clear-student-analytics',
    mongoUrl,
    env,
  });

  return guard;
}

async function loadCandidateSummary(args: ClearBetaStudentAnalyticsArgs): Promise<{
  totalCount: number;
  distinctNetids: string[];
  samples: ClearBetaStudentAnalyticsSample[];
}> {
  const filter = buildBetaStudentAnalyticsEventFilter();
  const [totalCount, distinctNetids, samples] = await Promise.all([
    AnalyticsEvent.countDocuments(filter),
    AnalyticsEvent.distinct('netid', filter),
    AnalyticsEvent.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            netid: '$netid',
            userType: '$userType',
            eventType: '$eventType',
          },
          count: { $sum: 1 },
          firstEventAt: { $min: '$timestamp' },
          lastEventAt: { $max: '$timestamp' },
        },
      },
      { $sort: { count: -1, '_id.netid': 1, '_id.eventType': 1 } },
      { $limit: args.sampleSize },
    ]),
  ]);

  return {
    totalCount,
    distinctNetids: distinctNetids.map((netid) => String(netid || '')).filter(Boolean),
    samples: samples.map((row: any) => ({
      netid: String(row._id?.netid || ''),
      userType: row._id?.userType ? String(row._id.userType) : undefined,
      eventType: row._id?.eventType ? String(row._id.eventType) : undefined,
      count: Number(row.count) || 0,
      firstEventAt: row.firstEventAt,
      lastEventAt: row.lastEventAt,
    })),
  };
}

export async function runClearBetaStudentAnalytics(
  args: ClearBetaStudentAnalyticsArgs,
): Promise<ClearBetaStudentAnalyticsSummary> {
  const candidateSummary = await loadCandidateSummary(args);
  if (args.apply && candidateSummary.totalCount > args.limit) {
    throw new Error(
      `Apply would delete ${candidateSummary.totalCount} analytics events, above --limit.`,
    );
  }

  const deleteResult = args.apply
    ? await AnalyticsEvent.deleteMany(buildBetaStudentAnalyticsEventFilter())
    : { deletedCount: 0 };

  return buildClearBetaStudentAnalyticsSummary({
    apply: args.apply,
    totalCount: candidateSummary.totalCount,
    distinctNetids: candidateSummary.distinctNetids,
    sampleSize: args.sampleSize,
    samples: candidateSummary.samples,
    deletedCount: deleteResult.deletedCount || 0,
  });
}

async function main() {
  const args = parseClearBetaStudentAnalyticsArgs(process.argv.slice(2));
  const guard = assertClearBetaStudentAnalyticsApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const summary = await runClearBetaStudentAnalytics(args);
  const output = buildClearBetaStudentAnalyticsOutput(summary, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options: args,
  });
  console.log(JSON.stringify(output, null, 2));
  writeClearBetaStudentAnalyticsOutput(output, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
