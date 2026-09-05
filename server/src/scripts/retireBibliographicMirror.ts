import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RETIRED_COLLECTIONS,
  RETIRED_RESEARCH_ENTITY_FIELDS,
  RETIRED_USER_FIELDS,
  assertRetireBibliographicMirrorInvariants,
} from './retireBibliographicMirrorCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetireBibliographicMirrorArgs {
  apply: boolean;
  confirmRetireBibliographicMirror: boolean;
  output?: string;
}

export function parseRetireBibliographicMirrorArgs(argv: string[]): RetireBibliographicMirrorArgs {
  const args: RetireBibliographicMirrorArgs = {
    apply: false,
    confirmRetireBibliographicMirror: false,
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
    if (arg === '--confirm-retire-bibliographic-mirror') {
      args.confirmRetireBibliographicMirror = true;
      continue;
    }
    if (arg.startsWith('--confirm-retire-bibliographic-mirror=')) {
      throw new Error('--confirm-retire-bibliographic-mirror does not accept a value');
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
    throw new Error(`Unknown retire:bibliographic-mirror argument: ${arg}`);
  }

  return args;
}

export function assertRetireBibliographicMirrorApplyAllowed(
  args: Pick<RetireBibliographicMirrorArgs, 'apply' | 'confirmRetireBibliographicMirror'>,
): void {
  if (args.apply && !args.confirmRetireBibliographicMirror) {
    throw new Error(
      '--confirm-retire-bibliographic-mirror is required when --apply is set for retire:bibliographic-mirror',
    );
  }
}

export type RetireBibliographicMirrorCounts = Record<(typeof RETIRED_COLLECTIONS)[number], number>;

interface CollectionDropReport {
  name: string;
  existed: boolean;
  droppedCount: number;
}

interface UnsetFieldsReport {
  matched: number;
  modified: number;
}

export interface RetireBibliographicMirrorResult {
  mode: 'dry-run' | 'apply';
  before: RetireBibliographicMirrorCounts;
  after: RetireBibliographicMirrorCounts;
  droppedCollections: CollectionDropReport[];
  unsetUserFields: UnsetFieldsReport;
  unsetResearchEntityFields: UnsetFieldsReport;
}

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function countCollection(
  db: MongoDb,
  name: string,
  filter: Record<string, unknown> = {},
): Promise<number> {
  if (!(await collectionExists(db, name))) return 0;
  return db.collection(name).countDocuments(filter);
}

async function snapshotCounts(db: MongoDb): Promise<RetireBibliographicMirrorCounts> {
  const counts = await Promise.all(
    RETIRED_COLLECTIONS.map(async (name) => [name, await countCollection(db, name)] as const),
  );

  return Object.fromEntries(counts) as RetireBibliographicMirrorCounts;
}

async function unsetFields(
  db: MongoDb,
  name: string,
  fields: readonly string[],
): Promise<UnsetFieldsReport> {
  if (!(await collectionExists(db, name))) return { matched: 0, modified: 0 };
  const unset = Object.fromEntries(fields.map((field) => [field, '']));
  const matchClause = { $or: fields.map((field) => ({ [field]: { $exists: true } })) };
  const result = await db.collection(name).updateMany(matchClause, { $unset: unset });
  return { matched: result.matchedCount || 0, modified: result.modifiedCount || 0 };
}

export async function retireBibliographicMirror(options: {
  apply: boolean;
  db?: MongoDb;
}): Promise<RetireBibliographicMirrorResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const before = await snapshotCounts(db);

  let droppedCollections: CollectionDropReport[] = RETIRED_COLLECTIONS.map((name) => ({
    name,
    existed: false,
    droppedCount: 0,
  }));
  let unsetUserFields: UnsetFieldsReport = { matched: 0, modified: 0 };
  let unsetResearchEntityFields: UnsetFieldsReport = { matched: 0, modified: 0 };

  if (options.apply) {
    droppedCollections = [];
    for (const name of RETIRED_COLLECTIONS) {
      const existed = await collectionExists(db, name);
      const droppedCount = existed ? await db.collection(name).countDocuments() : 0;
      if (existed) await db.collection(name).drop();
      droppedCollections.push({ name, existed, droppedCount });
    }

    unsetUserFields = await unsetFields(db, 'users', RETIRED_USER_FIELDS);
    unsetResearchEntityFields = await unsetFields(
      db,
      'research_entities',
      RETIRED_RESEARCH_ENTITY_FIELDS,
    );
  }

  const after = await snapshotCounts(db);

  if (options.apply) {
    assertRetireBibliographicMirrorInvariants({ remainingByCollection: after });
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    before,
    after,
    droppedCollections,
    unsetUserFields,
    unsetResearchEntityFields,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseRetireBibliographicMirrorArgs(process.argv.slice(2));
  assertRetireBibliographicMirrorApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'retire:bibliographic-mirror',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const result = await retireBibliographicMirror({ apply: args.apply });

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  writeOutput(report, args.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to retire bibliographic mirror:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
