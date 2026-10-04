import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { LoginSignalTally } from '../models/loginSignalTally';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  formatLoginSignalTallies,
  loginSignalTallyDateFilter,
  parseLoginSignalTallyReportArgs,
  TALLY_MONGO_URL_ENV_VARS,
  type StoredLoginSignalTally,
} from './loginSignalTallyReportCore';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
  quiet: true,
});

export async function runLoginSignalTallyReport(argv: string[]): Promise<number> {
  const args = parseLoginSignalTallyReportArgs(argv);
  const variable = TALLY_MONGO_URL_ENV_VARS[args.environment];
  const mongoUrl = process.env[variable];
  if (!mongoUrl) {
    console.error(`${variable} is required to read the ${args.environment} environment`);
    return 1;
  }
  await connectScriptMongo(mongoUrl);
  try {
    const rows = (await LoginSignalTally.find(loginSignalTallyDateFilter(args), { _id: 0 })
      .sort({ date: 1 })
      .lean()) as unknown as StoredLoginSignalTally[];
    console.log(`Database ${mongoose.connection.db?.databaseName ?? 'unknown'}\n`);
    console.log(args.json ? JSON.stringify(rows, null, 2) : formatLoginSignalTallies(rows));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectScriptInvocation(import.meta.url, 'loginSignalTallyReport')) {
  runLoginSignalTallyReport(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[auth:login-signal-tally] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
