import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planInvisibleFormatCharacterRepair,
  summarizeInvisibleFormatCharacterRepair,
  type InvisibleFormatCharacterRepairRow,
} from './repairInvisibleFormatCharactersCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'data:repair-invisible-format-characters';
const CONFIRM_FLAG = '--confirm-invisible-format-characters';
const RESEARCH_ENTITIES = 'research_entities';
const RESEARCHERS = 'researchers';

export interface InvisibleFormatCharacterCliOptions {
  dryRun: boolean;
  confirm: boolean;
  output?: string;
}

export function parseInvisibleFormatCharacterArgs(
  argv: readonly string[],
): InvisibleFormatCharacterCliOptions {
  const options: InvisibleFormatCharacterCliOptions = { dryRun: true, confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

export interface InvisibleFormatCharacterResult {
  mode: 'dry-run' | 'apply';
  scanned: Record<string, number>;
  summary: ReturnType<typeof summarizeInvisibleFormatCharacterRepair>;
  documentsUpdated: number;
  entitiesResynced: number;
  rows: Array<Omit<InvisibleFormatCharacterRepairRow, 'set'>>;
}

export async function runInvisibleFormatCharacterRepair(options: {
  dryRun: boolean;
}): Promise<InvisibleFormatCharacterResult> {
  // Read and write through the native collections, not the models. The served
  // `profileSynthesisDescription` is not declared on the research-entity schema, so a
  // strict Mongoose `$set` drops it silently: a first apply here reported 20 documents
  // updated while the two rows holding that field stayed dirty.
  const db = mongoose.connection.db;
  if (!db) throw new Error(`${SCRIPT_NAME} requires a connected database`);
  const entities = await db.collection(RESEARCH_ENTITIES).find({}).toArray();
  const researchers = await db.collection(RESEARCHERS).find({}).toArray();
  const entityRows = planInvisibleFormatCharacterRepair(
    RESEARCH_ENTITIES,
    entities as Array<Record<string, unknown>>,
  );
  const researcherRows = planInvisibleFormatCharacterRepair(
    RESEARCHERS,
    researchers as Array<Record<string, unknown>>,
  );
  const rows = [...entityRows, ...researcherRows];

  const result: InvisibleFormatCharacterResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: { [RESEARCH_ENTITIES]: entities.length, [RESEARCHERS]: researchers.length },
    summary: summarizeInvisibleFormatCharacterRepair(rows),
    documentsUpdated: 0,
    entitiesResynced: 0,
    rows: rows.map(({ collection, documentId, fields }) => ({ collection, documentId, fields })),
  };
  if (options.dryRun || rows.length === 0) return result;

  for (const [collection, collectionRows] of [
    [RESEARCH_ENTITIES, entityRows],
    [RESEARCHERS, researcherRows],
  ] as const) {
    if (collectionRows.length === 0) continue;
    const written = await db.collection(collection).bulkWrite(
      collectionRows.map((row) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(row.documentId) },
          update: { $set: row.set },
        },
      })),
    );
    result.documentsUpdated += written.modifiedCount ?? 0;
  }

  // The search document carries its own copy of the entity text, so without this the
  // index keeps serving the characters the corpus no longer holds.
  const resynced = await db
    .collection(RESEARCH_ENTITIES)
    .find({ _id: { $in: entityRows.map((row) => new mongoose.Types.ObjectId(row.documentId)) } })
    .toArray();
  await syncEntities('researchEntity', resynced as never[]);
  result.entitiesResynced = resynced.length;
  return result;
}

async function main(): Promise<void> {
  const options = parseInvisibleFormatCharacterArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error(`${SCRIPT_NAME} apply mode requires ${CONFIRM_FLAG}.`);
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runInvisibleFormatCharacterRepair({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), environment: guard.environment, ...result }, null, 2)}\n`,
      );
      console.log(`Saved invisible-format-character repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
