import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { StudentOutreach } from '../models/studentOutreach';
import { sanitizeLogValue } from '../utils/logSanitizer';

export interface OutreachCountRow {
  deliveryMethod?: unknown;
  outcome?: unknown;
  outcomeReportedAt?: unknown;
  count?: unknown;
}

export function buildStudentOutreachCountReport(rows: OutreachCountRow[]) {
  const report = {
    totalAttempts: 0,
    officialRouteAttempts: 0,
    confirmedOutcomes: 0,
    selfReportedOutcomes: 0,
    outcomes: {} as Record<string, number>,
  };
  for (const row of rows) {
    const count = typeof row.count === 'number' && row.count > 0 ? Math.floor(row.count) : 0;
    report.totalAttempts += count;
    if (row.deliveryMethod === 'official-route') report.officialRouteAttempts += count;
    if (row.outcomeReportedAt) {
      report.confirmedOutcomes += count;
      if (row.deliveryMethod === 'external-self-reported') report.selfReportedOutcomes += count;
      const outcome = typeof row.outcome === 'string' ? row.outcome : 'unknown';
      report.outcomes[outcome] = (report.outcomes[outcome] || 0) + count;
    }
  }
  return report;
}

async function main() {
  await initializeConnections();
  const rows = await StudentOutreach.aggregate([
    { $match: { studentConsentedToAggregateUse: true } },
    {
      $group: {
        _id: {
          deliveryMethod: '$deliveryMethod',
          outcome: '$outcome',
          outcomeReportedAt: { $ne: ['$outcomeReportedAt', null] },
        },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        deliveryMethod: '$_id.deliveryMethod',
        outcome: '$_id.outcome',
        outcomeReportedAt: '$_id.outcomeReportedAt',
        count: 1,
      },
    },
  ]);
  console.log(
    JSON.stringify(
      { generatedAt: new Date().toISOString(), ...buildStudentOutreachCountReport(rows) },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .catch((error) => {
      console.error('Failed to build PFR-3 outreach report:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
