import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import type { FilterQuery } from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import {
  buildUserEmailHygieneSummary,
  parseUserEmailHygieneArgs,
  SUSPICIOUS_USER_EMAIL_PATTERN,
  type UserEmailHygieneArgs,
  type UserEmailHygieneInputUser,
  type UserEmailHygieneSummary,
} from './userEmailHygieneCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export function buildSuspiciousUserEmailFilter(): FilterQuery<typeof User> {
  return {
    email: {
      $exists: true,
      $ne: '',
      $regex: SUSPICIOUS_USER_EMAIL_PATTERN,
    },
  };
}

export function writeUserEmailHygieneOutput(
  summary: object,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(summary, null, 2)}\n`);
}

export function buildUserEmailHygieneOutput<T extends object>(
  summary: T,
  metadata: {
    environment?: string;
    db?: string;
    options: UserEmailHygieneArgs;
  },
): T & {
  environment?: string;
  db?: string;
  options: UserEmailHygieneArgs;
} {
  return {
    ...summary,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function assertUserEmailHygieneApplyAllowed(
  args: UserEmailHygieneArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'users:email-hygiene',
    mongoUrl,
    env,
  });

  if (args.apply) {
    throw new Error(
      'users:email-hygiene apply mode is blocked; run without --apply for a review artifact.',
    );
  }

  return guard;
}

async function loadSuspiciousUsers(
  args: UserEmailHygieneArgs,
): Promise<{ totalCount: number; users: UserEmailHygieneInputUser[] }> {
  const filter = buildSuspiciousUserEmailFilter();
  const [totalCount, rows] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select('_id netid fname lname email')
      .limit(args.limit)
      .lean()
      .exec(),
  ]);

  return {
    totalCount,
    users: rows.map((row) => ({
      id: String(row._id || ''),
      netid: row.netid,
      fname: row.fname,
      lname: row.lname,
      email: row.email,
    })),
  };
}

export async function runUserEmailHygiene(
  args: UserEmailHygieneArgs,
): Promise<UserEmailHygieneSummary> {
  if (args.apply) {
    throw new Error(
      'users:email-hygiene apply mode is blocked; run without --apply for a review artifact.',
    );
  }
  const { totalCount, users } = await loadSuspiciousUsers(args);
  return buildUserEmailHygieneSummary({
    totalCount,
    sampleSize: args.sampleSize,
    users,
  });
}

async function main() {
  const args = parseUserEmailHygieneArgs(process.argv.slice(2));
  const guard = assertUserEmailHygieneApplyAllowed(args, process.env, process.env.MONGODBURL);
  await initializeConnections();
  const summary = await runUserEmailHygiene(args);
  const output = buildUserEmailHygieneOutput(summary, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options: args,
  });
  console.log(JSON.stringify(output, null, 2));
  writeUserEmailHygieneOutput(output, args.output);
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
