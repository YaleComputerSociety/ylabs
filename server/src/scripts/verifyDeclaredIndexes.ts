import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import '../models';
import { connectScriptMongo } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  TARGET_URL_ENV,
  formatDeclaredIndexVerification,
  verifyDeclaredIndexes,
  type IndexCheckTarget,
} from './verifyDeclaredIndexesCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const isTarget = (value: string | undefined): value is IndexCheckTarget =>
  value === 'production' || value === 'beta';

export function parseVerifyDeclaredIndexesArgs(argv: string[]): { target: IndexCheckTarget } {
  let target: IndexCheckTarget | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--target' && !arg.startsWith('--target=')) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = arg === '--target' ? argv[++index] : arg.slice('--target='.length);
    if (!isTarget(value)) throw new Error('--target must be production or beta');
    target = value;
  }
  if (!target) throw new Error('--target production|beta is required');
  return { target };
}

export async function runVerifyDeclaredIndexes(argv: string[]): Promise<number> {
  const { target } = parseVerifyDeclaredIndexesArgs(argv);
  const url = process.env[TARGET_URL_ENV[target]];
  if (!url) throw new Error(`${TARGET_URL_ENV[target]} is required`);
  await connectScriptMongo(url);
  try {
    const result = await verifyDeclaredIndexes(mongoose.connection);
    const { lines, failed } = formatDeclaredIndexVerification(
      target,
      mongoose.connection.db?.databaseName ?? 'unknown',
      result,
    );
    for (const line of lines) (failed ? console.error : console.log)(line);
    return failed ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectScriptInvocation(import.meta.url, 'verifyDeclaredIndexes')) {
  runVerifyDeclaredIndexes(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[db:verify-indexes] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
