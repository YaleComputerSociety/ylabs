/**
 * Import loose root-level Yale JSON/CSV files into MongoDB.
 *
 * Dry-run by default; pass --apply to write. Pass --delete-source-files after
 * a successful applied import to remove the loose root files.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from '../server/node_modules/mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { Department } from '../server/src/models/department';
import { ResearchEntity } from '../server/src/models/researchEntity';
import { Source } from '../server/src/models/source';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

export interface RootDataImportCliOptions {
  apply: boolean;
  confirmLegacyRootDataImport?: boolean;
  deleteSourceFiles: boolean;
  limit?: number;
  output?: string;
}

export function parseRootDataImportArgs(argv: string[]): RootDataImportCliOptions {
  const options: RootDataImportCliOptions = {
    apply: false,
    confirmLegacyRootDataImport: false,
    deleteSourceFiles: false,
  };
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
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--delete-source-files') {
      options.deleteSourceFiles = true;
      continue;
    }
    if (arg === '--confirm-legacy-root-data-import') {
      options.confirmLegacyRootDataImport = true;
      continue;
    }
    if (arg.startsWith('--confirm-legacy-root-data-import=')) {
      throw new Error('--confirm-legacy-root-data-import does not accept a value');
    }
    if (arg === '--limit') {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith('--')) {
        throw new Error('--limit requires a positive integer');
      }
      options.limit = parsePositiveInteger(raw, '--limit');
      i += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
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

    throw new Error(`Unknown legacy root data import argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function assertRootDataImportApplyAllowed(args: {
  apply: boolean;
  confirmLegacyRootDataImport?: boolean;
  limit?: number;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  if (args.apply && !Number.isFinite(args.limit)) {
    throw new Error('--limit is required when --apply is set for legacy root data import');
  }
  if (args.apply && !args.confirmLegacyRootDataImport) {
    throw new Error(
      '--confirm-legacy-root-data-import is required when --apply is set for legacy root data import',
    );
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'legacy root data import',
    mongoUrl: args.mongoUrl,
    env: args.env,
  });
}

export function buildRootDataImportOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options: RootDataImportCliOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options: RootDataImportCliOptions;
} {
  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
    ...result,
  };
}

function writeRootDataImportOutput(payload: object, outputPath?: string): void {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}

const DEFAULT_OPTIONS: RootDataImportCliOptions = {
  apply: false,
  confirmLegacyRootDataImport: false,
  deleteSourceFiles: false,
};
let APPLY = DEFAULT_OPTIONS.apply;
let DELETE_SOURCE_FILES = DEFAULT_OPTIONS.deleteSourceFiles;
const ROOT = path.resolve(__dirname, '..');
const OBSERVED_AT = new Date();
const SOURCE_FILES = ['yale_medicine_labs.json'];

interface ImportSource {
  _id?: mongoose.Types.ObjectId;
  name: string;
  displayName: string;
  description: string;
  baseUrl: string;
  defaultWeight: number;
  coverage: {
    priority: number;
    tier: 'PRIMARY_OFFICIAL' | 'DERIVED_OFFICIAL';
    artifactTypes: Array<'ResearchEntity' | 'Observation'>;
    evidenceCategories: string[];
    defaultConfidence: 'HIGH' | 'MEDIUM';
    notes: string;
  };
}

interface MedicineLabInput {
  lab_name?: string | null;
  lab_url?: string | null;
  research_bio?: string | null;
  publications_page?: string | null;
  publications?: unknown[];
}

interface Stats {
  processed: number;
  plannedCreates: number;
  plannedUpdates: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ key: string; error: string }>;
}

interface VerificationResult {
  medicineLabs: number;
  passed: boolean;
}

function emptyStats(): Stats {
  return {
    processed: 0,
    plannedCreates: 0,
    plannedUpdates: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
}

function filePath(fileName: string): string {
  return path.join(ROOT, fileName);
}

function readJsonArray<T>(fileName: string): T[] {
  const fullPath = filePath(fileName);
  if (!fs.existsSync(fullPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${fileName} must contain a JSON array`);
  }
  return parsed as T[];
}

function cleanText(value: unknown, maxLength = 8000): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function norm(value: unknown): string {
  return cleanText(value).toLowerCase();
}

function slugify(input: string): string {
  return cleanText(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019]s\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value === 'object') return { ...(value as Record<string, unknown>) };
  return {};
}

function provenanceFor(
  fields: string[],
  source: ImportSource,
  sourceUrl: string,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      {
        sourceId: source._id,
        sourceName: source.name,
        sourceUrl,
        observedAt: OBSERVED_AT,
        confidence: source.defaultWeight,
      },
    ]),
  );
}

function confidenceFor(fields: string[], source: ImportSource): Record<string, number> {
  return Object.fromEntries(fields.map((field) => [field, source.defaultWeight]));
}

async function buildDepartmentMap(): Promise<Map<string, mongoose.Types.ObjectId>> {
  const departments = await Department.find({}).lean<any[]>();
  const byName = new Map<string, mongoose.Types.ObjectId>();
  for (const department of departments) {
    for (const key of [department.name, department.displayName, department.abbreviation]) {
      const normalized = norm(key);
      if (normalized) byName.set(normalized, department._id);
    }
  }
  return byName;
}

function departmentIdsFor(
  names: string[],
  departmentsByName: Map<string, mongoose.Types.ObjectId>,
): { primaryDepartmentId?: mongoose.Types.ObjectId; departmentIds: mongoose.Types.ObjectId[] } {
  const ids = uniqueStrings(names)
    .map((name) => departmentsByName.get(norm(name)))
    .filter((id): id is mongoose.Types.ObjectId => !!id);
  const uniqueIds = Array.from(new Set(ids.map(String))).map((id) => new mongoose.Types.ObjectId(id));
  return {
    primaryDepartmentId: uniqueIds[0],
    departmentIds: uniqueIds,
  };
}

async function ensureSource(source: ImportSource): Promise<ImportSource> {
  const update = {
    displayName: source.displayName,
    description: source.description,
    baseUrl: source.baseUrl,
    defaultWeight: source.defaultWeight,
    enabled: false,
    cadence: 'one-time local import',
    notes: 'Imported from loose root-level JSON/CSV files by data-migration/ImportRootDataFiles.ts.',
    coverage: source.coverage,
  };

  if (APPLY) {
    await Source.updateOne({ name: source.name }, { $set: update }, { upsert: true });
  }

  const doc = await Source.findOne({ name: source.name }).lean<any>();
  if (doc?._id) return { ...source, _id: doc._id };
  return source;
}

function sourceSpecs(): Record<'medicine', ImportSource> {
  return {
    medicine: {
      name: 'root-yale-medicine-labs-json',
      displayName: 'Root import: Yale Medicine labs JSON',
      description: 'One-time import from root-level Yale School of Medicine lab JSON.',
      baseUrl: 'https://medicine.yale.edu/lab/',
      defaultWeight: 0.78,
      coverage: {
        priority: 40,
        tier: 'DERIVED_OFFICIAL',
        artifactTypes: ['ResearchEntity', 'Observation'],
        evidenceCategories: ['ENTITY_IDENTITY', 'LAB_WEBSITE', 'TOPICS', 'PUBLICATIONS'],
        defaultConfidence: 'MEDIUM',
        notes: 'Research entity identity import. Publication strings are not imported as Paper rows.',
      },
    },
  };
}

async function findExistingResearchGroup(input: {
  slug: string;
  labUrl: string;
}): Promise<any | null> {
  const filters: any[] = [{ slug: input.slug }];
  if (input.labUrl) {
    filters.push({ websiteUrl: input.labUrl }, { website: input.labUrl });
  }
  return ResearchEntity.findOne({ $or: filters }).lean<any>();
}

async function upsertMedicineLab(
  row: MedicineLabInput,
  options: {
    source: ImportSource;
    departmentsByName: Map<string, mongoose.Types.ObjectId>;
  },
): Promise<'created' | 'updated' | 'skipped'> {
  const name = cleanText(row.lab_name);
  if (!name) return 'skipped';
  const labUrl = cleanText(row.lab_url);
  const publicationsPage = cleanText(row.publications_page);
  const slug = slugify(`ysm-${name}`);
  const description = cleanText(row.research_bio, 10000);
  const shortDescription = description.slice(0, 320);
  const departmentIds = departmentIdsFor(['Yale School of Medicine'], options.departmentsByName);
  const existing = await findExistingResearchGroup({ slug, labUrl });
  const existingConfidence = asPlainObject(existing?.confidenceByField);
  const existingProvenance = asPlainObject(existing?.fieldProvenance);
  const existingSourceUrls = Array.isArray(existing?.sourceUrls) ? existing.sourceUrls : [];
  const sourceUrls = uniqueStrings([...existingSourceUrls, labUrl, publicationsPage]);
  const fields = uniqueStrings([
    'name',
    'displayName',
    'kind',
    'entityType',
    'shortDescription',
    'description',
    'fullDescription',
    labUrl ? 'websiteUrl' : '',
    'school',
    'schools',
    'sourceUrls',
  ]);

  const set: Record<string, unknown> = {
    name,
    displayName: name,
    kind: 'lab',
    entityType: 'LAB',
    shortDescription,
    description,
    fullDescription: description,
    website: labUrl,
    websiteUrl: labUrl,
    school: 'Yale School of Medicine',
    schools: ['Yale School of Medicine'],
    departments: ['Yale School of Medicine'],
    sourceUrls,
    activeAtYaleCache: true,
    yaleStatusCache: 'unknown',
    opennessStatusCache: existing?.opennessStatusCache || 'unknown',
    openness: existing?.openness || 'unknown',
    lastObservedAt: OBSERVED_AT,
    archived: false,
    confidenceByField: {
      ...existingConfidence,
      ...confidenceFor(fields, options.source),
    },
    fieldProvenance: {
      ...existingProvenance,
      ...provenanceFor(fields, options.source, labUrl),
    },
  };
  if (departmentIds.primaryDepartmentId) set.primaryDepartmentId = departmentIds.primaryDepartmentId;
  if (departmentIds.departmentIds.length > 0) set.departmentIds = departmentIds.departmentIds;

  const filter = existing?._id ? { _id: existing._id } : { slug };
  if (!APPLY) return existing ? 'updated' : 'created';

  await ResearchEntity.updateOne(
    filter,
    {
      $set: set,
      $setOnInsert: {
        slug,
      },
    },
    { upsert: true, setDefaultsOnInsert: false },
  );
  return existing ? 'updated' : 'created';
}

async function importMedicineLabs(
  rows: MedicineLabInput[],
  options: {
    source: ImportSource;
    departmentsByName: Map<string, mongoose.Types.ObjectId>;
    limit?: number;
  },
): Promise<Stats> {
  const stats = emptyStats();
  const limitedRows = options.limit ? rows.slice(0, options.limit) : rows;
  for (const row of limitedRows) {
    const key = cleanText(row.lab_url || row.lab_name);
    try {
      const result = await upsertMedicineLab(row, options);
      stats.processed++;
      if (result === 'created') {
        stats.plannedCreates++;
        if (APPLY) stats.created++;
      } else if (result === 'updated') {
        stats.plannedUpdates++;
        if (APPLY) stats.updated++;
      } else {
        stats.skipped++;
      }
    } catch (err: any) {
      stats.errors.push({ key: key || 'unknown-lab', error: err?.message || String(err) });
    }
  }
  return stats;
}

async function verifyImport(expected: {
  medicineLabs: number;
}): Promise<VerificationResult> {
  const medicineLabs = await ResearchEntity.countDocuments({
    'fieldProvenance.name.sourceName': 'root-yale-medicine-labs-json',
  });
  return {
    medicineLabs,
    passed: medicineLabs >= expected.medicineLabs,
  };
}

function deleteSourceFiles(): void {
  for (const fileName of SOURCE_FILES) {
    const fullPath = filePath(fileName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`Deleted ${fileName}`);
    }
  }
}

function printStats(label: string, stats: Stats): void {
  console.log(`\n${label}`);
  console.log(`  Processed:       ${stats.processed}`);
  console.log(`  Planned creates: ${stats.plannedCreates}`);
  console.log(`  Planned updates: ${stats.plannedUpdates}`);
  console.log(`  Created:         ${stats.created}${APPLY ? '' : ' (dry run)'}`);
  console.log(`  Updated:         ${stats.updated}${APPLY ? '' : ' (dry run)'}`);
  console.log(`  Skipped:         ${stats.skipped}`);
  console.log(`  Errors:          ${stats.errors.length}`);
  for (const error of stats.errors.slice(0, 10)) {
    console.log(`    ${error.key}: ${error.error}`);
  }
}

export async function importRootDataFiles(
  options: RootDataImportCliOptions = DEFAULT_OPTIONS,
): Promise<ReturnType<typeof buildRootDataImportOutput<object>>> {
  APPLY = options.apply;
  DELETE_SOURCE_FILES = options.deleteSourceFiles;
  const url = process.env.MONGODBURL;
  if (!url) {
    throw new Error('MONGODBURL not set in server/.env');
  }

  const guard = assertRootDataImportApplyAllowed({
    apply: options.apply,
    confirmLegacyRootDataImport: options.confirmLegacyRootDataImport,
    limit: options.limit,
    mongoUrl: url,
  });
  const limit = options.limit;
  console.log('\n=== Import root JSON/CSV data files ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Delete source files: ${DELETE_SOURCE_FILES ? 'yes' : 'no'}`);
  console.log(`Limit: ${limit ?? 'none'}\n`);

  await mongoose.connect(url);
  try {

  const specs = sourceSpecs();
  const medicineSource = await ensureSource(specs.medicine);
  const departmentsByName = await buildDepartmentMap();

  const medicineRows = readJsonArray<MedicineLabInput>('yale_medicine_labs.json');

  console.log('Loaded source data');
  console.log(`  Medicine lab rows:           ${medicineRows.length}`);

  const medicineStats = await importMedicineLabs(medicineRows, {
    source: medicineSource,
    departmentsByName,
    limit,
  });

  printStats('Medicine labs import', medicineStats);

  const errorCount = medicineStats.errors.length;
  const expected = {
    medicineLabs: limit ? Math.min(limit, medicineRows.length) : medicineRows.length,
  };
  const verification = await verifyImport(expected);

  console.log('\nVerification counts');
  console.log(`  Medicine ResearchGroup rows tagged: ${verification.medicineLabs}`);
  console.log(`  Passed: ${verification.passed ? 'yes' : 'no'}`);

  if (DELETE_SOURCE_FILES) {
    if (!APPLY) {
      throw new Error('--delete-source-files requires --apply');
    }
    if (!verification.passed || errorCount > 0) {
      throw new Error('Refusing to delete source files because import verification did not pass cleanly');
    }
    deleteSourceFiles();
  }

  const output = buildRootDataImportOutput(
    {
      medicineRows: medicineRows.length,
      medicineStats,
      verification,
    },
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
    },
  );
  writeRootDataImportOutput(output, options.output);
  if (options.output) console.log(`Wrote root data import report to ${options.output}`);
  return output;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  importRootDataFiles(parseRootDataImportArgs(process.argv.slice(2))).catch(async (err) => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
  });
}
