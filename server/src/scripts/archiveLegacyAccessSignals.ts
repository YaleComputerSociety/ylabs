import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { attributedArchiveSet } from '../models/entityArchival';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  ARCHIVE_LEGACY_ACCESS_SIGNALS_REASON,
  LEGACY_ACCESS_SIGNAL_PREDICATES,
  assertLegacyAccessSignalsFullyArchived,
} from './archiveLegacyAccessSignalsCore';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = ARCHIVE_LEGACY_ACCESS_SIGNALS_REASON;
const COLLECTION = 'signals';
const CONFIRM_FLAG = '--confirm-archive-legacy-access-signals';
const PATH_OPTIONS = ['output', 'snapshot'] as const;

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface ArchiveLegacyAccessSignalsArgs {
  apply: boolean;
  confirmArchiveLegacyAccessSignals: boolean;
  output?: string;
  snapshot?: string;
}

export function parseArchiveLegacyAccessSignalsArgs(
  argv: string[],
): ArchiveLegacyAccessSignalsArgs {
  const args: ArchiveLegacyAccessSignalsArgs = {
    apply: false,
    confirmArchiveLegacyAccessSignals: false,
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
    if (arg === CONFIRM_FLAG) {
      args.confirmArchiveLegacyAccessSignals = true;
      continue;
    }
    if (arg.startsWith(`${CONFIRM_FLAG}=`)) {
      throw new Error(`${CONFIRM_FLAG} does not accept a value`);
    }
    const option = PATH_OPTIONS.find((name) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (option) {
      const inline = arg.startsWith(`--${option}=`);
      args[option] = resolveSafeJsonReportOutputPath(
        inline ? arg.slice(option.length + 3) : argv[index + 1],
        `--${option}`,
      );
      if (!inline) index += 1;
      continue;
    }
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return args;
}

export function assertArchiveLegacyAccessSignalsApplyAllowed(
  args: Pick<ArchiveLegacyAccessSignalsArgs, 'apply' | 'confirmArchiveLegacyAccessSignals'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.apply && !args.confirmArchiveLegacyAccessSignals) {
    throw new Error(`${CONFIRM_FLAG} is required when --apply is set for ${SCRIPT_NAME}`);
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
    env,
  });
}

export interface LegacyAccessSignalPredicateResult {
  name: string;
  presentBefore: number;
  matched: number;
  modified: number;
  presentAfter: number;
  entitiesAffected: number;
}

export interface ArchiveLegacyAccessSignalsResult {
  mode: 'dry-run' | 'apply';
  predicates: LegacyAccessSignalPredicateResult[];
  snapshotRows: number;
}

export async function snapshotLegacyAccessSignals(db: MongoDb): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const predicate of LEGACY_ACCESS_SIGNAL_PREDICATES) {
    const found = await db
      .collection(COLLECTION)
      .find(predicate.filter, {
        projection: {
          _id: 1,
          type: 1,
          'source.name': 1,
          derivationKey: 1,
          researchEntityId: 1,
          archived: 1,
        },
      })
      .toArray();
    rows.push(...found.map((row) => ({ predicate: predicate.name, ...row })));
  }
  return rows;
}

export async function archiveLegacyAccessSignals(options: {
  apply: boolean;
  db?: MongoDb;
  snapshotRows?: number;
}): Promise<ArchiveLegacyAccessSignalsResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const collection = db.collection(COLLECTION);
  const predicates: LegacyAccessSignalPredicateResult[] = [];
  for (const predicate of LEGACY_ACCESS_SIGNAL_PREDICATES) {
    const presentBefore = await collection.countDocuments(predicate.filter);
    const entitiesAffected = (await collection.distinct('researchEntityId', predicate.filter))
      .length;
    let matched = 0;
    let modified = 0;
    if (options.apply && presentBefore > 0) {
      const result = await collection.updateMany(predicate.filter, {
        $set: attributedArchiveSet(ARCHIVE_LEGACY_ACCESS_SIGNALS_REASON),
      });
      matched = result.matchedCount || 0;
      modified = result.modifiedCount || 0;
    }
    const presentAfter = await collection.countDocuments(predicate.filter);
    predicates.push({
      name: predicate.name,
      presentBefore,
      matched,
      modified,
      presentAfter,
      entitiesAffected,
    });
  }

  if (options.apply) {
    assertLegacyAccessSignalsFullyArchived(
      Object.fromEntries(predicates.map((result) => [result.name, result.presentAfter])),
    );
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    predicates,
    snapshotRows: options.snapshotRows ?? 0,
  };
}

function writeJson(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseArchiveLegacyAccessSignalsArgs(process.argv.slice(2));
  const guard = assertArchiveLegacyAccessSignalsApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  let snapshotRows = 0;
  if (args.snapshot) {
    const rows = await snapshotLegacyAccessSignals(db);
    writeJson(rows, args.snapshot);
    snapshotRows = rows.length;
  }

  const result = await archiveLegacyAccessSignals({ apply: args.apply, snapshotRows });

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    databaseName: db.databaseName,
    options: args,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  writeJson(report, args.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to archive the legacy access signals:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
