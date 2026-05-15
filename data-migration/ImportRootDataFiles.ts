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
import { Department } from '../server/src/models/department';
import { FacultyMember } from '../server/src/models/facultyMember';
import { ResearchGroup } from '../server/src/models/researchGroup';
import { Source } from '../server/src/models/source';

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const APPLY = process.argv.includes('--apply') || process.argv.includes('--live');
const DELETE_SOURCE_FILES = process.argv.includes('--delete-source-files');
const ROOT = path.resolve(__dirname, '..');
const OBSERVED_AT = new Date();
const SOURCE_FILES = [
  'faculty_data.json',
  'yale_physics_people.json',
  'yale_physics_faculty_10.json',
  'yale_physics_people_10.json',
  'yale_history_faculty.json',
  'yale_medicine_labs.json',
  'yale_physics_people.csv',
];

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

interface FacultyInput {
  name?: string | null;
  profile_link?: string | null;
  profile_url?: string | null;
  title?: string | null;
  office?: string | null;
  email?: string | null;
  phones?: string[];
  website?: string | null;
  research_website?: string | null;
  image_url?: string | null;
  image?: string | null;
  field_of_study?: string | null;
  profile_bio?: string | null;
  bio?: string | null;
  website_text?: string | null;
  department?: string | null;
  fields_of_interest?: string | null;
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
  physicsFaculty: number;
  historyFaculty: number;
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

function parseLimit(): number | undefined {
  const eq = process.argv.find((arg) => arg.startsWith('--limit='));
  const raw = eq ? eq.split('=')[1] : process.argv[process.argv.indexOf('--limit') + 1];
  if (!raw || raw.startsWith('--')) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

function normalizeEmail(value: unknown): string {
  const email = norm(value);
  return email.includes('@') ? email : '';
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

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
  };
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

function sourceSpecs(): Record<'physics' | 'history' | 'medicine', ImportSource> {
  return {
    physics: {
      name: 'root-yale-physics-faculty-json',
      displayName: 'Root import: Yale Physics faculty JSON',
      description: 'One-time import from root-level Yale Physics faculty/person JSON files.',
      baseUrl: 'https://physics.yale.edu/people',
      defaultWeight: 0.82,
      coverage: {
        priority: 35,
        tier: 'DERIVED_OFFICIAL',
        artifactTypes: ['Observation'],
        evidenceCategories: ['ENTITY_IDENTITY', 'OFFICIAL_PROFILE', 'TOPICS', 'METHODS', 'LAB_WEBSITE'],
        defaultConfidence: 'MEDIUM',
        notes: 'Faculty identity/profile enrichment only; not undergraduate access evidence.',
      },
    },
    history: {
      name: 'root-yale-history-faculty-json',
      displayName: 'Root import: Yale History faculty JSON',
      description: 'One-time import from root-level Yale History faculty JSON.',
      baseUrl: 'https://history.yale.edu/people',
      defaultWeight: 0.82,
      coverage: {
        priority: 35,
        tier: 'DERIVED_OFFICIAL',
        artifactTypes: ['Observation'],
        evidenceCategories: ['ENTITY_IDENTITY', 'OFFICIAL_PROFILE', 'TOPICS', 'METHODS'],
        defaultConfidence: 'MEDIUM',
        notes: 'Faculty identity/profile enrichment only; not undergraduate access evidence.',
      },
    },
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

function mergePhysicsRows(): FacultyInput[] {
  const fallbackRows = readJsonArray<FacultyInput>('yale_physics_people.json');
  const enrichedRows = readJsonArray<FacultyInput>('faculty_data.json');
  const byKey = new Map<string, FacultyInput>();
  for (const row of fallbackRows) {
    const key = norm(row.profile_link) || norm(row.email) || norm(row.name);
    if (key) byKey.set(key, row);
  }
  for (const row of enrichedRows) {
    const key = norm(row.profile_link) || norm(row.email) || norm(row.name);
    if (!key) continue;
    const fallback = byKey.get(key) || {};
    byKey.set(key, { ...fallback, ...row });
  }
  return Array.from(byKey.values());
}

function interestsFromFaculty(row: FacultyInput, department: 'Physics' | 'History'): string[] {
  if (department === 'History') {
    return uniqueStrings(cleanText(row.fields_of_interest).split(';'));
  }
  return uniqueStrings([row.field_of_study]);
}

async function upsertFaculty(
  row: FacultyInput,
  options: {
    source: ImportSource;
    departmentName: 'Physics' | 'History';
    departmentsByName: Map<string, mongoose.Types.ObjectId>;
  },
): Promise<'created' | 'updated' | 'skipped'> {
  const name = cleanText(row.name);
  if (!name) return 'skipped';

  const email = normalizeEmail(row.email);
  const sourceUrl = cleanText(row.profile_link || row.profile_url || row.website || row.research_website);
  const sourceSlug = slugify(`${options.departmentName}-${name}`);
  const sourceProfileKey = options.departmentName === 'Physics' ? 'physicsProfile' : 'historyProfile';
  const profileUrl = cleanText(row.profile_link || row.profile_url);
  const websiteUrl = cleanText(row.website || row.research_website);
  const imageUrl = cleanText(row.image_url || row.image);
  const bio = cleanText(row.profile_bio || row.bio || row.website_text, 8000);
  const interests = interestsFromFaculty(row, options.departmentName);
  const names = splitName(name);
  const departmentIds = departmentIdsFor([options.departmentName], options.departmentsByName);

  const existing = await findExistingFaculty({ email, slug: sourceSlug, sourceProfileKey, profileUrl });
  const existingProfileUrls = asPlainObject(existing?.profileUrls);
  const existingConfidence = asPlainObject(existing?.confidenceByField);
  const existingProvenance = asPlainObject(existing?.fieldProvenance);
  const fields = uniqueStrings([
    'name',
    'firstName',
    'lastName',
    email ? 'email' : '',
    'title',
    websiteUrl ? 'websiteUrl' : '',
    imageUrl ? 'photoUrl' : '',
    bio ? 'bio' : '',
    interests.length > 0 ? 'researchInterests' : '',
    'profileUrls',
    departmentIds.departmentIds.length > 0 ? 'departmentIds' : '',
  ]);

  const profileUrls = {
    ...existingProfileUrls,
    rootImportSource: options.source.name,
    rootImportDepartment: options.departmentName,
    ...(profileUrl ? { sourceProfile: profileUrl, [sourceProfileKey]: profileUrl } : {}),
    ...(websiteUrl ? { researchWebsite: websiteUrl } : {}),
  };

  const set: Record<string, unknown> = {
    name,
    firstName: names.firstName,
    lastName: names.lastName,
    title: cleanText(row.title),
    websiteUrl,
    photoUrl: imageUrl,
    bio,
    primarySchool: options.departmentName === 'History' || options.departmentName === 'Physics'
      ? 'Yale Faculty of Arts and Sciences'
      : '',
    schools: ['Yale Faculty of Arts and Sciences'],
    researchInterests: interests,
    topics: interests,
    profileUrls,
    activeAtYaleCache: true,
    yaleStatus: 'unknown',
    lastObservedAt: OBSERVED_AT,
    archived: false,
    confidenceByField: {
      ...existingConfidence,
      ...confidenceFor(fields, options.source),
    },
    fieldProvenance: {
      ...existingProvenance,
      ...provenanceFor(fields, options.source, sourceUrl),
    },
  };
  if (email) set.email = email;
  if (departmentIds.primaryDepartmentId) set.primaryDepartmentId = departmentIds.primaryDepartmentId;
  if (departmentIds.departmentIds.length > 0) set.departmentIds = departmentIds.departmentIds;

  const filter = existing?._id ? { _id: existing._id } : email ? { email } : { slug: sourceSlug };
  if (!APPLY) return existing ? 'updated' : 'created';

  await FacultyMember.updateOne(
    filter,
    {
      $set: set,
      $setOnInsert: {
        slug: sourceSlug,
      },
    },
    { upsert: true },
  );
  return existing ? 'updated' : 'created';
}

async function findExistingFaculty(input: {
  email: string;
  slug: string;
  sourceProfileKey: string;
  profileUrl: string;
}): Promise<any | null> {
  if (input.email) {
    const byEmail = await FacultyMember.findOne({ email: input.email }).lean<any>();
    if (byEmail) return byEmail;
  }
  if (input.profileUrl) {
    const byProfile = await FacultyMember.findOne({
      [`profileUrls.${input.sourceProfileKey}`]: input.profileUrl,
    }).lean<any>();
    if (byProfile) return byProfile;
  }
  return FacultyMember.findOne({ slug: input.slug }).lean<any>();
}

async function importFacultyRows(
  rows: FacultyInput[],
  options: {
    source: ImportSource;
    departmentName: 'Physics' | 'History';
    departmentsByName: Map<string, mongoose.Types.ObjectId>;
    limit?: number;
  },
): Promise<Stats> {
  const stats = emptyStats();
  const limitedRows = options.limit ? rows.slice(0, options.limit) : rows;
  for (const row of limitedRows) {
    const key = cleanText(row.email || row.profile_link || row.profile_url || row.name);
    try {
      const result = await upsertFaculty(row, options);
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
      stats.errors.push({ key: key || 'unknown-faculty', error: err?.message || String(err) });
    }
  }
  return stats;
}

async function findExistingResearchGroup(input: {
  slug: string;
  labUrl: string;
}): Promise<any | null> {
  const filters: any[] = [{ slug: input.slug }];
  if (input.labUrl) {
    filters.push({ websiteUrl: input.labUrl }, { website: input.labUrl });
  }
  return ResearchGroup.findOne({ $or: filters }).lean<any>();
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

  await ResearchGroup.updateOne(
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

function countCsvRows(fileName: string): number {
  const fullPath = filePath(fileName);
  if (!fs.existsSync(fullPath)) return 0;
  const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  return Math.max(0, lines.length - 1);
}

async function verifyImport(expected: {
  physicsFaculty: number;
  historyFaculty: number;
  medicineLabs: number;
}): Promise<VerificationResult> {
  const [physicsFaculty, historyFaculty, medicineLabs] = await Promise.all([
    FacultyMember.countDocuments({ 'profileUrls.rootImportSource': 'root-yale-physics-faculty-json' }),
    FacultyMember.countDocuments({ 'profileUrls.rootImportSource': 'root-yale-history-faculty-json' }),
    ResearchGroup.countDocuments({
      'fieldProvenance.name.sourceName': 'root-yale-medicine-labs-json',
    }),
  ]);
  return {
    physicsFaculty,
    historyFaculty,
    medicineLabs,
    passed:
      physicsFaculty >= expected.physicsFaculty &&
      historyFaculty >= expected.historyFaculty &&
      medicineLabs >= expected.medicineLabs,
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

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }

  const limit = parseLimit();
  console.log('\n=== Import root JSON/CSV data files ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Delete source files: ${DELETE_SOURCE_FILES ? 'yes' : 'no'}`);
  console.log(`Limit: ${limit ?? 'none'}\n`);

  await mongoose.connect(url);

  const specs = sourceSpecs();
  const [physicsSource, historySource, medicineSource] = await Promise.all([
    ensureSource(specs.physics),
    ensureSource(specs.history),
    ensureSource(specs.medicine),
  ]);
  const departmentsByName = await buildDepartmentMap();

  const physicsRows = mergePhysicsRows();
  const historyRows = readJsonArray<FacultyInput>('yale_history_faculty.json');
  const medicineRows = readJsonArray<MedicineLabInput>('yale_medicine_labs.json');
  const csvRows = countCsvRows('yale_physics_people.csv');

  console.log('Loaded source data');
  console.log(`  Physics faculty/person rows: ${physicsRows.length}`);
  console.log(`  History faculty rows:        ${historyRows.length}`);
  console.log(`  Medicine lab rows:           ${medicineRows.length}`);
  console.log(`  Physics CSV data rows:       ${csvRows} ${csvRows === 0 ? '(header-only; skipped)' : ''}`);
  console.log('  Physics _10 files:           sample subsets; skipped');

  const physicsStats = await importFacultyRows(physicsRows, {
    source: physicsSource,
    departmentName: 'Physics',
    departmentsByName,
    limit,
  });
  const historyStats = await importFacultyRows(historyRows, {
    source: historySource,
    departmentName: 'History',
    departmentsByName,
    limit,
  });
  const medicineStats = await importMedicineLabs(medicineRows, {
    source: medicineSource,
    departmentsByName,
    limit,
  });

  printStats('Physics faculty import', physicsStats);
  printStats('History faculty import', historyStats);
  printStats('Medicine labs import', medicineStats);

  const errorCount =
    physicsStats.errors.length + historyStats.errors.length + medicineStats.errors.length;
  const expected = {
    physicsFaculty: limit ? Math.min(limit, physicsRows.length) : physicsRows.length,
    historyFaculty: limit ? Math.min(limit, historyRows.length) : historyRows.length,
    medicineLabs: limit ? Math.min(limit, medicineRows.length) : medicineRows.length,
  };
  const verification = await verifyImport(expected);

  console.log('\nVerification counts');
  console.log(`  Physics FacultyMember rows tagged: ${verification.physicsFaculty}`);
  console.log(`  History FacultyMember rows tagged: ${verification.historyFaculty}`);
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

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
