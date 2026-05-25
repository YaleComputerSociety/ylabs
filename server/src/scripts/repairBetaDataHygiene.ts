import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import {
  expandBetaDataHygieneRepairPlan,
  parseRepairBetaDataHygieneArgs,
  type PlannedFieldRepair,
} from './repairBetaDataHygieneCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type MongoDb = NonNullable<typeof mongoose.connection.db>;

interface RepairResult extends PlannedFieldRepair {
  matched: number;
  modified?: number;
}

async function countMatches(db: MongoDb, repair: PlannedFieldRepair): Promise<number> {
  return db.collection(repair.collection).countDocuments({ [repair.field]: repair.from });
}

async function applyRepair(db: MongoDb, repair: PlannedFieldRepair): Promise<number> {
  const collection = db.collection(repair.collection);
  if (repair.kind === 'array') {
    const update =
      repair.action === 'replace'
        ? { $set: { [`${repair.field}.$`]: repair.to } }
        : { $pull: { [repair.field]: repair.from } };
    const result = await collection.updateMany({ [repair.field]: repair.from }, update as any);
    return result.modifiedCount || 0;
  }

  const update =
    repair.action === 'replace'
      ? { $set: { [repair.field]: repair.to } }
      : { $unset: { [repair.field]: '' } };
  const result = await collection.updateMany({ [repair.field]: repair.from }, update);
  return result.modifiedCount || 0;
}

async function main(): Promise<void> {
  const args = parseRepairBetaDataHygieneArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'beta:repair-data-hygiene',
    mongoUrl,
  });

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection is not initialized');

  const repairs = expandBetaDataHygieneRepairPlan();
  const rows: RepairResult[] = [];
  for (const repair of repairs) {
    const matched = await countMatches(db, repair);
    const modified = args.apply && matched > 0 ? await applyRepair(db, repair) : 0;
    rows.push({
      ...repair,
      matched,
      ...(args.apply ? { modified } : {}),
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        matched: rows.reduce((sum, row) => sum + row.matched, 0),
        modified: args.apply ? rows.reduce((sum, row) => sum + (row.modified || 0), 0) : undefined,
        note: 'Exact-value repair for known beta gate URL/email hygiene failures only.',
        rows: rows.filter((row) => row.matched > 0 || args.apply).slice(0, 200),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
