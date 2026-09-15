import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RETIRED_UNDERGRADUATE_LOGISTICS_FIELDS,
  RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES,
  assertUndergraduateLogisticsFieldsFullyUnset,
  assertUndergraduateLogisticsIndexDropAllowed,
} from './retireUndergraduateLogisticsFieldsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'retire:undergraduate-logistics-fields';
const COLLECTION = 'research_entities';

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetireUndergraduateLogisticsFieldsArgs {
  apply: boolean;
  confirmRetireUndergraduateLogisticsFields: boolean;
  output?: string;
}

export function parseRetireUndergraduateLogisticsFieldsArgs(
  argv: string[],
): RetireUndergraduateLogisticsFieldsArgs {
  const args: RetireUndergraduateLogisticsFieldsArgs = {
    apply: false,
    confirmRetireUndergraduateLogisticsFields: false,
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
    if (arg === '--confirm-retire-undergraduate-logistics-fields') {
      args.confirmRetireUndergraduateLogisticsFields = true;
      continue;
    }
    if (arg.startsWith('--confirm-retire-undergraduate-logistics-fields=')) {
      throw new Error(
        '--confirm-retire-undergraduate-logistics-fields does not accept a value',
      );
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

export function assertRetireUndergraduateLogisticsFieldsApplyAllowed(
  args: Pick<
    RetireUndergraduateLogisticsFieldsArgs,
    'apply' | 'confirmRetireUndergraduateLogisticsFields'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.apply && !args.confirmRetireUndergraduateLogisticsFields) {
    throw new Error(
      `--confirm-retire-undergraduate-logistics-fields is required when --apply is set for ${SCRIPT_NAME}`,
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
  $or: RETIRED_UNDERGRADUATE_LOGISTICS_FIELDS.map((field) => ({ [field]: { $exists: true } })),
};

async function countFieldPresence(db: MongoDb): Promise<number> {
  return db.collection(COLLECTION).countDocuments(fieldPresenceFilter);
}

async function findRetiredIndexNames(db: MongoDb): Promise<string[]> {
  const indexes = await db.collection(COLLECTION).indexes();
  const present = new Set(indexes.map((index) => index.name));
  return RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES.filter((name) => present.has(name));
}

export interface RetireUndergraduateLogisticsFieldsResult {
  mode: 'dry-run' | 'apply';
  fields: readonly string[];
  presentBefore: number;
  presentAfter: number;
  matched: number;
  modified: number;
  indexNames: readonly string[];
  indexesPresentBefore: string[];
  indexesDropped: string[];
}

export async function retireUndergraduateLogisticsFields(options: {
  apply: boolean;
  db?: MongoDb;
}): Promise<RetireUndergraduateLogisticsFieldsResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const presentBefore = await countFieldPresence(db);
  const indexesPresentBefore = await findRetiredIndexNames(db);
  let matched = 0;
  let modified = 0;
  const indexesDropped: string[] = [];

  if (options.apply && presentBefore > 0) {
    const unset = Object.fromEntries(
      RETIRED_UNDERGRADUATE_LOGISTICS_FIELDS.map((field) => [field, '']),
    );
    const result = await db
      .collection(COLLECTION)
      .updateMany(fieldPresenceFilter, { $unset: unset });
    matched = result.matchedCount || 0;
    modified = result.modifiedCount || 0;
  }

  const presentAfter = await countFieldPresence(db);

  if (options.apply) {
    assertUndergraduateLogisticsFieldsFullyUnset(presentAfter);
    for (const indexName of indexesPresentBefore) {
      assertUndergraduateLogisticsIndexDropAllowed(presentAfter);
      await db.collection(COLLECTION).dropIndex(indexName);
      indexesDropped.push(indexName);
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    fields: RETIRED_UNDERGRADUATE_LOGISTICS_FIELDS,
    presentBefore,
    presentAfter,
    matched,
    modified,
    indexNames: RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES,
    indexesPresentBefore,
    indexesDropped,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseRetireUndergraduateLogisticsFieldsArgs(process.argv.slice(2));
  const guard = assertRetireUndergraduateLogisticsFieldsApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const result = await retireUndergraduateLogisticsFields({ apply: args.apply });

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
      console.error(
        'Failed to retire the undergraduate-logistics fields:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
