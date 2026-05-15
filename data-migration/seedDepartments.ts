import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import {
  DepartmentCategory,
  DepartmentCodeSystem,
  buildDepartmentGroundTruth,
  buildResolverKeys,
  diffDepartmentRows,
  normalizeDepartmentKey,
  type DepartmentSeedRow,
} from './departmentGroundTruth';

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const APPLY = process.argv.includes('--apply') || process.argv.includes('--live');

const sourceRecordSchema = new mongoose.Schema(
  {
    sourceKey: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
    matchedName: { type: String, required: true, trim: true },
    matchedCode: { type: String, trim: true },
    codeSystem: {
      type: String,
      required: true,
      enum: Object.values(DepartmentCodeSystem),
    },
  },
  { _id: false },
);

const departmentSchema = new mongoose.Schema(
  {
    abbreviation: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    categories: { type: [String], required: true, enum: Object.values(DepartmentCategory) },
    primaryCategory: { type: String, required: true, enum: Object.values(DepartmentCategory) },
    colorKey: { type: Number, required: true },
    aliases: { type: [String], default: [] },
    sourceRecords: { type: [sourceRecordSchema], default: [] },
    codeSystem: {
      type: String,
      enum: Object.values(DepartmentCodeSystem),
      default: DepartmentCodeSystem.APP_LOCAL,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

departmentSchema.index({ name: 'text', abbreviation: 'text', aliases: 'text' });
departmentSchema.index({ primaryCategory: 1 });
departmentSchema.index({ aliases: 1 });

const Department = mongoose.model('Department', departmentSchema, 'departments');

function showRows(label: string, rows: Array<DepartmentSeedRow | any>, formatter: (row: any) => string): void {
  console.log(`${label}: ${rows.length}`);
  for (const row of rows.slice(0, 20)) {
    console.log(`  - ${formatter(row)}`);
  }
  if (rows.length > 20) console.log(`  ... ${rows.length - 20} more`);
}

async function distinctStrings(collectionName: string, field: string): Promise<string[]> {
  const db = mongoose.connection.db;
  if (!db) return [];

  try {
    const values = await db.collection(collectionName).distinct(field);
    return values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
  } catch (error: any) {
    if (error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

async function auditUnresolvedDepartmentStrings(targetRows: DepartmentSeedRow[]): Promise<void> {
  const resolverKeys = buildResolverKeys(targetRows);
  const sources: Array<{ label: string; collection: string; field: string }> = [
    { label: 'research_entities.departments', collection: 'research_entities', field: 'departments' },
    { label: 'listings.departments', collection: 'listings', field: 'departments' },
    { label: 'listings.ownerPrimaryDepartment', collection: 'listings', field: 'ownerPrimaryDepartment' },
    { label: 'users.primaryDepartment', collection: 'users', field: 'primaryDepartment' },
    { label: 'users.secondaryDepartments', collection: 'users', field: 'secondaryDepartments' },
    { label: 'users.departments', collection: 'users', field: 'departments' },
    { label: 'users.major', collection: 'users', field: 'major' },
    { label: 'users.primary_department (legacy)', collection: 'users', field: 'primary_department' },
    { label: 'users.secondary_departments (legacy)', collection: 'users', field: 'secondary_departments' },
  ];

  console.log('\n=== Department String Audit ===');
  let totalUnresolved = 0;

  for (const source of sources) {
    const values = await distinctStrings(source.collection, source.field);
    const unresolved = values.filter((value) => !resolverKeys.has(normalizeDepartmentKey(value)));
    totalUnresolved += unresolved.length;
    console.log(`${source.label}: ${unresolved.length} unresolved of ${values.length} distinct value(s)`);
    for (const value of unresolved.slice(0, 15)) {
      console.log(`  - ${value}`);
    }
    if (unresolved.length > 15) console.log(`  ... ${unresolved.length - 15} more`);
  }

  if (totalUnresolved === 0) {
    console.log('All audited department strings resolve to an active name, displayName, abbreviation, or alias.');
  }
}

async function applyDepartmentRows(targetRows: DepartmentSeedRow[], staleRows: any[]): Promise<void> {
  const bulkOps = targetRows.map((dept) => ({
    updateOne: {
      filter: { abbreviation: dept.abbreviation },
      update: { $set: dept },
      upsert: true,
    },
  }));

  if (bulkOps.length > 0) {
    const result = await Department.bulkWrite(bulkOps);
    console.log(`Applied upserts: ${result.upsertedCount} inserted, ${result.modifiedCount} modified`);
  }

  if (staleRows.length > 0) {
    const staleAbbreviations = staleRows.map((row) => row.abbreviation).filter(Boolean);
    const result = await Department.updateMany(
      { abbreviation: { $in: staleAbbreviations } },
      { $set: { isActive: false } },
    );
    console.log(`Marked stale departments inactive: ${result.modifiedCount}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }

  console.log('\n=== Department Ground Truth Seed ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('Fetching official Yale department sources...\n');

  const groundTruth = await buildDepartmentGroundTruth();
  console.log('Source rows parsed:');
  console.log(`  YCPS subjects: ${groundTruth.sourceCounts.ycpsSubjects}`);
  console.log(`  YSM department labels: ${groundTruth.sourceCounts.ysmDepartments}`);
  console.log(`  YSM acronyms: ${groundTruth.sourceCounts.ysmAcronyms}`);
  console.log(`Curated active departments: ${groundTruth.departments.length}`);

  if (groundTruth.localOnlyRows.length > 0) {
    console.log('\nLocal-only curated rows requiring future source review:');
    for (const row of groundTruth.localOnlyRows) {
      console.log(`  - ${row.displayName}`);
    }
  }

  await mongoose.connect(url);
  const existing = await Department.find({}).lean<any[]>();
  const diff = diffDepartmentRows(existing, groundTruth.departments);

  console.log('\n=== Mongo Diff ===');
  showRows('Creates', diff.creates, (row) => row.displayName);
  showRows('Updates', diff.updates, (row) => `${row.before.displayName || row.before.abbreviation} -> ${row.after.displayName}`);
  showRows('Stale active rows to mark inactive', diff.deactivates, (row) => row.displayName || row.abbreviation);
  console.log(`Unchanged: ${diff.unchanged.length}`);

  if (APPLY) {
    await applyDepartmentRows(groundTruth.departments, diff.deactivates);
  } else {
    console.log('\nDry run only. Re-run with --apply to write upserts and mark stale rows inactive.');
  }

  await auditUnresolvedDepartmentStrings(groundTruth.departments);
  await mongoose.disconnect();
  console.log('\n=== Department Ground Truth Seed Complete ===\n');
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await mongoose.disconnect();
  process.exit(1);
});
