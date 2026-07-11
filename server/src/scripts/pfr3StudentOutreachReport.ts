import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { StudentOutreach } from '../models/studentOutreach';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { buildStudentOutreachCountReport } from './pfr3RolloutCore';

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
