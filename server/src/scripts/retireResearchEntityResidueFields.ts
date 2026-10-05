import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS,
  assertResidueFieldsFullyUnset,
  retiredResidueFieldPresenceFilter,
  snapshotResidueRow,
  type ResidueSnapshotRow,
} from './retireResearchEntityResidueFieldsCore';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'retire:research-entity-residue-fields';
const COLLECTION = 'research_entities';
const CONFIRM_FLAG = '--confirm-retire-research-entity-residue-fields';

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetireResearchEntityResidueFieldsArgs {
  apply: boolean;
  confirmRetireResearchEntityResidueFields: boolean;
  snapshot?: string;
  output?: string;
}

export function parseRetireResearchEntityResidueFieldsArgs(
  argv: string[],
): RetireResearchEntityResidueFieldsArgs {
  const args: RetireResearchEntityResidueFieldsArgs = {
    apply: false,
    confirmRetireResearchEntityResidueFields: false,
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
      args.confirmRetireResearchEntityResidueFields = true;
      continue;
    }
    if (arg.startsWith(`${CONFIRM_FLAG}=`)) {
      throw new Error(`${CONFIRM_FLAG} does not accept a value`);
    }
    if (arg.startsWith('--snapshot=')) {
      args.snapshot = resolveSafeJsonReportOutputPath(
        arg.slice('--snapshot='.length),
        '--snapshot',
      );
      continue;
    }
    if (arg === '--snapshot') {
      args.snapshot = resolveSafeJsonReportOutputPath(argv[index + 1], '--snapshot');
      index += 1;
      continue;
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

export function assertRetireResearchEntityResidueFieldsApplyAllowed(
  args: Pick<
    RetireResearchEntityResidueFieldsArgs,
    'apply' | 'confirmRetireResearchEntityResidueFields' | 'snapshot'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.apply && !args.confirmRetireResearchEntityResidueFields) {
    throw new Error(`${CONFIRM_FLAG} is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (args.apply && !args.snapshot) {
    throw new Error(`--snapshot is required when --apply is set for ${SCRIPT_NAME}`);
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
    env,
  });
}

async function countPresenceByField(db: MongoDb): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const field of RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS) {
    counts[field] = await db.collection(COLLECTION).countDocuments({ [field]: { $exists: true } });
  }
  return counts;
}

async function readSnapshot(db: MongoDb): Promise<ResidueSnapshotRow[]> {
  const projection = Object.fromEntries(
    RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS.map((field) => [field, 1]),
  );
  const rows = await db
    .collection(COLLECTION)
    .find(retiredResidueFieldPresenceFilter(), { projection })
    .toArray();
  return rows.map((row) => snapshotResidueRow(row as Record<string, unknown>));
}

function writeJson(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

export interface RetireResearchEntityResidueFieldsResult {
  mode: 'dry-run' | 'apply';
  fields: readonly string[];
  presentBefore: Record<string, number>;
  presentAfter: Record<string, number>;
  rowsCarryingResidue: number;
  snapshotRows: number;
  matched: number;
}

export async function retireResearchEntityResidueFields(options: {
  apply: boolean;
  snapshot?: string;
  db?: MongoDb;
}): Promise<RetireResearchEntityResidueFieldsResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  if (options.apply && !options.snapshot) {
    throw new Error(`--snapshot is required when --apply is set for ${SCRIPT_NAME}`);
  }

  const presentBefore = await countPresenceByField(db);
  const rowsCarryingResidue = await db
    .collection(COLLECTION)
    .countDocuments(retiredResidueFieldPresenceFilter());
  let snapshotRows = 0;
  let matched = 0;

  if (options.apply && rowsCarryingResidue > 0 && options.snapshot) {
    const snapshot = await readSnapshot(db);
    writeJson(options.snapshot, {
      collection: COLLECTION,
      takenAt: new Date().toISOString(),
      fields: RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS,
      rows: snapshot,
    });
    snapshotRows = snapshot.length;
    const unset = Object.fromEntries(
      RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS.map((field) => [field, '']),
    );
    const result = await db
      .collection(COLLECTION)
      .updateMany(retiredResidueFieldPresenceFilter(), { $unset: unset });
    matched = result.matchedCount || 0;
  }

  const presentAfter = await countPresenceByField(db);
  if (options.apply) assertResidueFieldsFullyUnset(presentAfter);

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    fields: RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS,
    presentBefore,
    presentAfter,
    rowsCarryingResidue,
    snapshotRows,
    matched,
  };
}

async function main() {
  const args = parseRetireResearchEntityResidueFieldsArgs(process.argv.slice(2));
  const guard = assertRetireResearchEntityResidueFieldsApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const result = await retireResearchEntityResidueFields({
    apply: args.apply,
    snapshot: args.snapshot,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    databaseName: db.databaseName,
    options: args,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  if (args.output) writeJson(resolveSafeJsonReportOutputPath(args.output), report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(
        'Failed to retire the research-entity residue fields:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
