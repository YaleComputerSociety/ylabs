import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RETIRED_DOCUMENTED_WAY_IN_FIELDS,
  RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME,
  assertDocumentedWayInFieldsFullyUnset,
  assertDocumentedWayInIndexDropAllowed,
} from './retireDocumentedWayInFieldCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'retire:documented-way-in-field';
const COLLECTION = 'research_entities';

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetireDocumentedWayInFieldArgs {
  apply: boolean;
  confirmRetireDocumentedWayInField: boolean;
  output?: string;
}

export function parseRetireDocumentedWayInFieldArgs(
  argv: string[],
): RetireDocumentedWayInFieldArgs {
  const args: RetireDocumentedWayInFieldArgs = {
    apply: false,
    confirmRetireDocumentedWayInField: false,
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
    if (arg === '--confirm-retire-documented-way-in-field') {
      args.confirmRetireDocumentedWayInField = true;
      continue;
    }
    if (arg.startsWith('--confirm-retire-documented-way-in-field=')) {
      throw new Error('--confirm-retire-documented-way-in-field does not accept a value');
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

export function assertRetireDocumentedWayInFieldApplyAllowed(
  args: Pick<RetireDocumentedWayInFieldArgs, 'apply' | 'confirmRetireDocumentedWayInField'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.apply && !args.confirmRetireDocumentedWayInField) {
    throw new Error(
      `--confirm-retire-documented-way-in-field is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
    env,
  });
}

const fieldPresenceFilter = {
  $or: RETIRED_DOCUMENTED_WAY_IN_FIELDS.map((field) => ({ [field]: { $exists: true } })),
};

async function countFieldPresence(db: MongoDb): Promise<number> {
  return db.collection(COLLECTION).countDocuments(fieldPresenceFilter);
}

async function findRetiredIndexName(db: MongoDb): Promise<string | undefined> {
  const indexes = await db.collection(COLLECTION).indexes();
  return indexes.find((index) => index.name === RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME)?.name;
}

export interface RetireDocumentedWayInFieldResult {
  mode: 'dry-run' | 'apply';
  fields: readonly string[];
  presentBefore: number;
  presentAfter: number;
  matched: number;
  modified: number;
  indexName: string;
  indexPresentBefore: boolean;
  indexDropped: boolean;
}

export async function retireDocumentedWayInField(options: {
  apply: boolean;
  db?: MongoDb;
}): Promise<RetireDocumentedWayInFieldResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const presentBefore = await countFieldPresence(db);
  const indexPresentBefore = Boolean(await findRetiredIndexName(db));
  let matched = 0;
  let modified = 0;
  let indexDropped = false;

  if (options.apply && presentBefore > 0) {
    const unset = Object.fromEntries(RETIRED_DOCUMENTED_WAY_IN_FIELDS.map((field) => [field, '']));
    const result = await db
      .collection(COLLECTION)
      .updateMany(fieldPresenceFilter, { $unset: unset });
    matched = result.matchedCount || 0;
    modified = result.modifiedCount || 0;
  }

  const presentAfter = await countFieldPresence(db);

  if (options.apply) {
    assertDocumentedWayInFieldsFullyUnset(presentAfter);
    if (indexPresentBefore) {
      assertDocumentedWayInIndexDropAllowed(presentAfter);
      await db.collection(COLLECTION).dropIndex(RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME);
      indexDropped = true;
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    fields: RETIRED_DOCUMENTED_WAY_IN_FIELDS,
    presentBefore,
    presentAfter,
    matched,
    modified,
    indexName: RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME,
    indexPresentBefore,
    indexDropped,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseRetireDocumentedWayInFieldArgs(process.argv.slice(2));
  const guard = assertRetireDocumentedWayInFieldApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const result = await retireDocumentedWayInField({ apply: args.apply });

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
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
      console.error('Failed to retire the documented-way-in field:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
