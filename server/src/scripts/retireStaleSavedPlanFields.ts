import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { STALE_SAVED_PLAN_FIELDS, assertStaleSavedPlanFieldsFullyUnset } from './retireStaleSavedPlanFieldsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'retire:stale-saved-plan-fields';
const COLLECTION = 'users';

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetireStaleSavedPlanFieldsArgs {
  apply: boolean;
  confirmRetireStaleSavedPlanFields: boolean;
  output?: string;
}

export function parseRetireStaleSavedPlanFieldsArgs(
  argv: string[],
): RetireStaleSavedPlanFieldsArgs {
  const args: RetireStaleSavedPlanFieldsArgs = {
    apply: false,
    confirmRetireStaleSavedPlanFields: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-retire-stale-saved-plan-fields') {
      args.confirmRetireStaleSavedPlanFields = true;
      continue;
    }
    if (arg.startsWith('--confirm-retire-stale-saved-plan-fields=')) {
      throw new Error('--confirm-retire-stale-saved-plan-fields does not accept a value');
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return args;
}

export function assertRetireStaleSavedPlanFieldsApplyAllowed(
  args: Pick<RetireStaleSavedPlanFieldsArgs, 'apply' | 'confirmRetireStaleSavedPlanFields'>,
): void {
  if (args.apply && !args.confirmRetireStaleSavedPlanFields) {
    throw new Error(
      `--confirm-retire-stale-saved-plan-fields is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
}

function assertConnectedToDevelopment(mongoUrl: string | undefined): void {
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertOperatorEnvironmentMatchesDatabase('development', databaseNameFromMongoUrl(mongoUrl));
}

async function countStaleFieldPresence(db: MongoDb): Promise<number> {
  return db.collection(COLLECTION).countDocuments({
    $or: STALE_SAVED_PLAN_FIELDS.map((field) => ({ [field]: { $exists: true } })),
  });
}

export interface RetireStaleSavedPlanFieldsResult {
  mode: 'dry-run' | 'apply';
  fields: readonly string[];
  presentBefore: number;
  presentAfter: number;
  matched: number;
  modified: number;
}

export async function retireStaleSavedPlanFields(options: {
  apply: boolean;
  db?: MongoDb;
}): Promise<RetireStaleSavedPlanFieldsResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const presentBefore = await countStaleFieldPresence(db);
  let matched = 0;
  let modified = 0;

  if (options.apply && presentBefore > 0) {
    const unset = Object.fromEntries(STALE_SAVED_PLAN_FIELDS.map((field) => [field, '']));
    const result = await db.collection(COLLECTION).updateMany(
      { $or: STALE_SAVED_PLAN_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
      { $unset: unset },
    );
    matched = result.matchedCount || 0;
    modified = result.modifiedCount || 0;
  }

  const presentAfter = await countStaleFieldPresence(db);
  if (options.apply) assertStaleSavedPlanFieldsFullyUnset(presentAfter);

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    fields: STALE_SAVED_PLAN_FIELDS,
    presentBefore,
    presentAfter,
    matched,
    modified,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseRetireStaleSavedPlanFieldsArgs(process.argv.slice(2));
  assertRetireStaleSavedPlanFieldsApplyAllowed(args);

  const mongoUrl = process.env.MONGODBURL;
  assertConnectedToDevelopment(mongoUrl);

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  assertOperatorEnvironmentMatchesDatabase('development', db.databaseName);

  const result = await retireStaleSavedPlanFields({ apply: args.apply });

  const report = {
    generatedAt: new Date().toISOString(),
    databaseName: db.databaseName,
    options: args,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  writeOutput(report, args.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to retire stale saved-plan fields:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
