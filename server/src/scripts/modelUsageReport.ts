import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import {
  assertOperatorEnvironmentMatchesDatabase,
  parseOperatorDatabaseEnvironment,
} from './operatorDatabaseEnvironment';
import {
  formatModelUsageReport,
  parseModelUsageReportArgs,
  readModelUsageReport,
} from './modelUsageReportCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const args = parseModelUsageReportArgs(process.argv.slice(2));
  const environment = parseOperatorDatabaseEnvironment(args.environment);
  if (!environment) throw new Error(`Unknown --environment ${args.environment || '(missing)'}`);

  await initializeConnections();
  assertOperatorEnvironmentMatchesDatabase(environment, mongoose.connection.db?.databaseName || '');

  const report = await readModelUsageReport(new Date(Date.now() - args.sinceDays * DAY_MS));
  for (const line of formatModelUsageReport(report)) console.log(line);
}

if (process.argv[1] && process.argv[1].includes('modelUsageReport')) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
