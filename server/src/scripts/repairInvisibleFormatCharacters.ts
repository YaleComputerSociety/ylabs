import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { Fellowship } from '../models/fellowship';
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

// Taken from the models rather than spelled out, so a collection this repair claims
// to cover cannot drift from the one the product actually serves.
const RESEARCH_ENTITIES = ResearchEntity.collection.collectionName;
const RESEARCHERS = Researcher.collection.collectionName;
const FELLOWSHIPS = Fellowship.collection.collectionName;

// Every served collection a materializer projects observed text into. `fellowship`
// is a first-class observed entity type whose `title`/`summary`/`description`/
// `eligibility` are student-visible, so leaving it out made a post-run zero a zero
// for only two of the three collections (#2874).
const REPAIRED_COLLECTIONS = [RESEARCH_ENTITIES, RESEARCHERS, FELLOWSHIPS] as const;

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
  entitiesAwaitingResync: number;
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
  const scanned: Record<string, number> = {};
  const rowsByCollection = new Map<string, InvisibleFormatCharacterRepairRow[]>();
  for (const collection of REPAIRED_COLLECTIONS) {
    const documents = await db.collection(collection).find({}).toArray();
    scanned[collection] = documents.length;
    rowsByCollection.set(
      collection,
      planInvisibleFormatCharacterRepair(collection, documents as Array<Record<string, unknown>>),
    );
  }
  const rows = REPAIRED_COLLECTIONS.flatMap((collection) => rowsByCollection.get(collection) ?? []);

  const result: InvisibleFormatCharacterResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned,
    summary: summarizeInvisibleFormatCharacterRepair(rows),
    documentsUpdated: 0,
    entitiesResynced: 0,
    entitiesAwaitingResync: 0,
    rows: rows.map(({ collection, documentId, fields }) => ({ collection, documentId, fields })),
  };
  if (options.dryRun || rows.length === 0) return result;

  for (const collection of REPAIRED_COLLECTIONS) {
    const collectionRows = rowsByCollection.get(collection) ?? [];
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
  // index keeps serving the characters the corpus no longer holds. `syncEntities`
  // swallows a Meilisearch failure, so the count has to come from what it reports
  // submitting rather than from how many documents were handed to it.
  const entityRows = rowsByCollection.get(RESEARCH_ENTITIES) ?? [];
  const resynced = await db
    .collection(RESEARCH_ENTITIES)
    .find({ _id: { $in: entityRows.map((row) => new mongoose.Types.ObjectId(row.documentId)) } })
    .toArray();
  result.entitiesResynced = await syncEntities('researchEntity', resynced as never[]);
  result.entitiesAwaitingResync = resynced.length - result.entitiesResynced;
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
    if (result.entitiesAwaitingResync > 0) {
      throw new Error(
        `${SCRIPT_NAME} repaired the corpus but ${result.entitiesAwaitingResync} search document(s) were not resynced; the index still serves the old text.`,
      );
    }
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
