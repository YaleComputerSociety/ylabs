import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DepartmentCategory,
  DepartmentCodeSystem,
  buildDepartmentGroundTruth,
  buildResolverKeys,
  diffDepartmentRows,
  normalizeDepartmentKey,
  type DepartmentSeedRow,
} from './departmentGroundTruth';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

export interface DepartmentSeedCliOptions {
  apply: boolean;
  confirmSeedApply?: boolean;
  output?: string;
}

interface DepartmentDiffSummary {
  creates: number;
  updates: number;
  deactivates: number;
  unchanged: number;
}

interface DepartmentSeedApplyResult {
  upsertedCount: number;
  modifiedCount: number;
  staleModifiedCount: number;
}

interface UnresolvedDepartmentAuditSource {
  label: string;
  unresolvedCount: number;
  distinctValueCount: number;
  samples: string[];
  categoryCounts: Record<UnresolvedDepartmentAuditCategory, number>;
  categorySamples: Record<UnresolvedDepartmentAuditCategory, string[]>;
}

interface UnresolvedDepartmentAuditSummary {
  totalUnresolved: number;
  categoryCounts: Record<UnresolvedDepartmentAuditCategory, number>;
  sources: UnresolvedDepartmentAuditSource[];
}

export type UnresolvedDepartmentAuditCategory =
  | 'administrative_unit'
  | 'legacy_unit_coded_department'
  | 'medical_specialty_or_subdepartment'
  | 'research_center_or_program'
  | 'student_major'
  | 'unclassified';

export function parseDepartmentSeedArgs(argv: string[]): DepartmentSeedCliOptions {
  const options: DepartmentSeedCliOptions = { apply: false };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--live') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-seed-apply') {
      options.confirmSeedApply = true;
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown department seed argument: ${arg}`);
  }

  return options;
}

export function assertDepartmentSeedApplyAllowed(args: {
  apply: boolean;
  confirmSeedApply?: boolean;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  if (args.apply && !args.confirmSeedApply) {
    throw new Error('--confirm-seed-apply is required when --apply is set for department seed');
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'department ground-truth seed',
    mongoUrl: args.mongoUrl,
    env: args.env,
  });
}

export function buildDepartmentSeedOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options: DepartmentSeedCliOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options: DepartmentSeedCliOptions;
} {
  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
    ...result,
  };
}

function writeDepartmentSeedOutput(result: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

export function classifyUnresolvedDepartmentString(
  sourceLabel: string,
  value: string,
): UnresolvedDepartmentAuditCategory {
  const normalized = normalizeDepartmentKey(value);
  const raw = value.toLowerCase();

  if (sourceLabel === 'users.major') {
    return 'student_major';
  }

  if (
    /\b(center|institute|inst|program|programs|studies|trial|cancer|society|consortium|initiative|papers of|study of|foundations of data science|sustainable food|biotechnology|keck)\b/.test(raw) ||
    /^(macagr|macipe|macprg|macsea|prvait|ressci|ycoycp|medkec)\b/.test(raw)
  ) {
    return 'research_center_or_program';
  }

  if (
    /\b(school|office|administration|administrative|admin|affairs|library|athletics|gym|teaching|teach|education|educational|secretary|health|divinity|divnity|drama|environment|engineering|fellowship|president|provost|dean|faculty|business|finance|central|unit|other|university|college|rotc|agency staff|quantitative reasoning)\b/.test(raw) ||
    /^(ath|eei|sls|yhp|envacc|medcen|uugage|ycortc)\b/.test(raw) ||
    /^[a-z]{3,}(adm|fin|fac|aca|cen|oth)\b/.test(normalized.replace(/\s+/g, ''))
  ) {
    return 'administrative_unit';
  }

  if (/^(eas|fas|div)\s*[a-z]{2,}/i.test(raw) || /^(eas|fas|div)[a-z]{3,}\b/.test(raw)) {
    return 'legacy_unit_coded_department';
  }

  if (
    /\b(medicine|surgery|disease|diseases|biochemistry|anatomy|pathology|cardiovascular|digestive|clinical|infection|immunity|immun|immunology|virology|genomics|urology|radiology|oncology|therapeutics|pulmonary|endocrinology|hematology|transplant|nephrology|rheumatology|allergy|obstetrics|gynecology|orthopedics|physiology|neurosciences?|microbiology|pediatrics|veterinary|specialty services|behavioral sciences|care centers?)\b/.test(raw) ||
    /\/cell biology/.test(raw) ||
    /\/immun\/virology/.test(raw) ||
    /^medccc\b/.test(raw)
  ) {
    return 'medical_specialty_or_subdepartment';
  }

  return 'unclassified';
}

function emptyCategoryCounts(): Record<UnresolvedDepartmentAuditCategory, number> {
  return {
    administrative_unit: 0,
    legacy_unit_coded_department: 0,
    medical_specialty_or_subdepartment: 0,
    research_center_or_program: 0,
    student_major: 0,
    unclassified: 0,
  };
}

function emptyCategorySamples(): Record<UnresolvedDepartmentAuditCategory, string[]> {
  return {
    administrative_unit: [],
    legacy_unit_coded_department: [],
    medical_specialty_or_subdepartment: [],
    research_center_or_program: [],
    student_major: [],
    unclassified: [],
  };
}

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

const Department = mongoose.model<any>('Department', departmentSchema, 'departments');

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

async function auditUnresolvedDepartmentStrings(
  targetRows: DepartmentSeedRow[],
): Promise<UnresolvedDepartmentAuditSummary> {
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
  const totalCategoryCounts = emptyCategoryCounts();
  const summaries: UnresolvedDepartmentAuditSource[] = [];

  for (const source of sources) {
    const values = await distinctStrings(source.collection, source.field);
    const unresolved = values.filter((value) => !resolverKeys.has(normalizeDepartmentKey(value)));
    totalUnresolved += unresolved.length;
    const categoryCounts = emptyCategoryCounts();
    const categorySamples = emptyCategorySamples();
    for (const value of unresolved) {
      const category = classifyUnresolvedDepartmentString(source.label, value);
      categoryCounts[category] += 1;
      totalCategoryCounts[category] += 1;
      if (categorySamples[category].length < 10) {
        categorySamples[category].push(value);
      }
    }
    summaries.push({
      label: source.label,
      unresolvedCount: unresolved.length,
      distinctValueCount: values.length,
      samples: unresolved.slice(0, 15),
      categoryCounts,
      categorySamples,
    });
    console.log(`${source.label}: ${unresolved.length} unresolved of ${values.length} distinct value(s)`);
    for (const value of unresolved.slice(0, 15)) {
      console.log(`  - ${value}`);
    }
    if (unresolved.length > 15) console.log(`  ... ${unresolved.length - 15} more`);
  }

  if (totalUnresolved === 0) {
    console.log('All audited department strings resolve to an active name, displayName, abbreviation, or alias.');
  }

  return { totalUnresolved, categoryCounts: totalCategoryCounts, sources: summaries };
}

async function applyDepartmentRows(
  targetRows: DepartmentSeedRow[],
  staleRows: any[],
): Promise<DepartmentSeedApplyResult> {
  const bulkOps = targetRows.map((dept) => ({
    updateOne: {
      filter: { abbreviation: dept.abbreviation },
      update: { $set: dept },
      upsert: true,
    },
  }));

  let upsertedCount = 0;
  let modifiedCount = 0;
  if (bulkOps.length > 0) {
    const result = await Department.bulkWrite(bulkOps);
    upsertedCount = result.upsertedCount;
    modifiedCount = result.modifiedCount;
    console.log(`Applied upserts: ${result.upsertedCount} inserted, ${result.modifiedCount} modified`);
  }

  let staleModifiedCount = 0;
  if (staleRows.length > 0) {
    const staleAbbreviations = staleRows.map((row) => row.abbreviation).filter(Boolean);
    const result = await Department.updateMany(
      { abbreviation: { $in: staleAbbreviations } },
      { $set: { isActive: false } },
    );
    staleModifiedCount = result.modifiedCount;
    console.log(`Marked stale departments inactive: ${result.modifiedCount}`);
  }

  return { upsertedCount, modifiedCount, staleModifiedCount };
}

async function main(): Promise<void> {
  const options = parseDepartmentSeedArgs(process.argv.slice(2));
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }
  const guard = assertDepartmentSeedApplyAllowed({
    apply: options.apply,
    confirmSeedApply: options.confirmSeedApply,
    mongoUrl: url,
  });

  console.log('\n=== Department Ground Truth Seed ===');
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);
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
  const diffSummary: DepartmentDiffSummary = {
    creates: diff.creates.length,
    updates: diff.updates.length,
    deactivates: diff.deactivates.length,
    unchanged: diff.unchanged.length,
  };

  console.log('\n=== Mongo Diff ===');
  showRows('Creates', diff.creates, (row) => row.displayName);
  showRows('Updates', diff.updates, (row) => `${row.before.displayName || row.before.abbreviation} -> ${row.after.displayName}`);
  showRows('Stale active rows to mark inactive', diff.deactivates, (row) => row.displayName || row.abbreviation);
  console.log(`Unchanged: ${diff.unchanged.length}`);

  let applyResult: DepartmentSeedApplyResult | undefined;
  if (options.apply) {
    applyResult = await applyDepartmentRows(groundTruth.departments, diff.deactivates);
  } else {
    console.log('\nDry run only. Re-run with --apply to write upserts and mark stale rows inactive.');
  }

  const unresolvedDepartmentAudit = await auditUnresolvedDepartmentStrings(groundTruth.departments);
  const output = buildDepartmentSeedOutput(
    {
      mode: options.apply ? 'apply' : 'dry-run',
      sourceCounts: groundTruth.sourceCounts,
      curatedActiveDepartments: groundTruth.departments.length,
      localOnlyRows: groundTruth.localOnlyRows.map((row) => ({
        abbreviation: row.abbreviation,
        displayName: row.displayName,
      })),
      diffSummary,
      diffSamples: {
        creates: diff.creates.slice(0, 20).map((row) => ({
          abbreviation: row.abbreviation,
          displayName: row.displayName,
        })),
        updates: diff.updates.slice(0, 20).map((row) => ({
          abbreviation: row.after.abbreviation,
          before: row.before.displayName || row.before.abbreviation,
          after: row.after.displayName,
        })),
        deactivates: diff.deactivates.slice(0, 20).map((row) => ({
          abbreviation: row.abbreviation,
          displayName: row.displayName,
        })),
      },
      ...(applyResult ? { applyResult } : {}),
      unresolvedDepartmentAudit,
    },
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
    },
  );
  writeDepartmentSeedOutput(output, options.output);
  await mongoose.disconnect();
  console.log('\n=== Department Ground Truth Seed Complete ===\n');
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  main().catch(async (err) => {
    console.error('Fatal error:', err);
    await mongoose.disconnect();
    process.exit(1);
  });
}
