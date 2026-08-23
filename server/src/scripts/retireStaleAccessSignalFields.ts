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
import { STALE_ACCESS_SIGNAL_FIELDS, assertStaleAccessSignalFieldsFullyUnset } from './retireStaleAccessSignalFieldsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'retire:stale-access-signal-fields';
const COLLECTION = 'research_entities';

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetireStaleAccessSignalFieldsArgs {
  apply: boolean;
  confirmRetireStaleAccessSignalFields: boolean;
  output?: string;
}

export function parseRetireStaleAccessSignalFieldsArgs(
  argv: string[],
): RetireStaleAccessSignalFieldsArgs {
  const args: RetireStaleAccessSignalFieldsArgs = {
    apply: false,
    confirmRetireStaleAccessSignalFields: false,
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
    if (arg === '--confirm-retire-stale-access-signal-fields') {
      args.confirmRetireStaleAccessSignalFields = true;
      continue;
    }
    if (arg.startsWith('--confirm-retire-stale-access-signal-fields=')) {
      throw new Error('--confirm-retire-stale-access-signal-fields does not accept a value');
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

export function assertRetireStaleAccessSignalFieldsApplyAllowed(
  args: Pick<RetireStaleAccessSignalFieldsArgs, 'apply' | 'confirmRetireStaleAccessSignalFields'>,
): void {
  if (args.apply && !args.confirmRetireStaleAccessSignalFields) {
    throw new Error(
      `--confirm-retire-stale-access-signal-fields is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
}

function assertConnectedToDevelopment(mongoUrl: string | undefined): void {
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertOperatorEnvironmentMatchesDatabase('development', databaseNameFromMongoUrl(mongoUrl));
}

async function countStaleFieldPresence(db: MongoDb): Promise<number> {
  return db.collection(COLLECTION).countDocuments({
    $or: STALE_ACCESS_SIGNAL_FIELDS.map((field) => ({ [field]: { $exists: true } })),
  });
}

export interface RetireStaleAccessSignalFieldsResult {
  mode: 'dry-run' | 'apply';
  fields: readonly string[];
  presentBefore: number;
  presentAfter: number;
  matched: number;
  modified: number;
}

export async function retireStaleAccessSignalFields(options: {
  apply: boolean;
  db?: MongoDb;
}): Promise<RetireStaleAccessSignalFieldsResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const presentBefore = await countStaleFieldPresence(db);
  let matched = 0;
  let modified = 0;

  if (options.apply && presentBefore > 0) {
    const unset = Object.fromEntries(STALE_ACCESS_SIGNAL_FIELDS.map((field) => [field, '']));
    const result = await db.collection(COLLECTION).updateMany(
      { $or: STALE_ACCESS_SIGNAL_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
      { $unset: unset },
    );
    matched = result.matchedCount || 0;
    modified = result.modifiedCount || 0;
  }

  const presentAfter = await countStaleFieldPresence(db);
  if (options.apply) assertStaleAccessSignalFieldsFullyUnset(presentAfter);

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    fields: STALE_ACCESS_SIGNAL_FIELDS,
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
  const args = parseRetireStaleAccessSignalFieldsArgs(process.argv.slice(2));
  assertRetireStaleAccessSignalFieldsApplyAllowed(args);

  const mongoUrl = process.env.MONGODBURL;
  assertConnectedToDevelopment(mongoUrl);

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  assertOperatorEnvironmentMatchesDatabase('development', db.databaseName);

  const result = await retireStaleAccessSignalFields({ apply: args.apply });

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
      console.error('Failed to retire stale access-signal fields:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
