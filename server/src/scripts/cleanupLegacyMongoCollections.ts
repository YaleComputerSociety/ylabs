import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  RETIRED_POPULATED_COLLECTIONS,
  assertRetiredCollectionsAreUnmodelled,
  countBsonDocuments,
  evaluateRetiredCollectionBackup,
  type RetiredCollectionBackupCheck,
} from './retiredCollectionDropCore';
import '../models';

dotenv.config();

type MongoDb = NonNullable<typeof mongoose.connection.db>;
type Mode = 'dry-run' | 'apply' | 'verify' | 'drop-legacy' | 'drop-retired-populated';

export interface LegacyCleanupArgs {
  mode: Mode;
  confirmDropLegacy?: boolean;
  confirmDropRetiredPopulated?: boolean;
  backup?: string;
  output?: string;
}

const APPLICATIONS_SOURCE = 'applications';
const STUDENT_APPLICATIONS_TARGET = 'student_applications';
const LEGACY_CLEANUP_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const EMPTY_LEGACY_COLLECTIONS = [
  'research_groups',
  'research_group_members',
  'research_group_stats',
  'paper_group_links',
  // Retired models whose collections outlived them. `papers`/`paper_authors`
  // and the two `research_scholarly_*` collections are owned by
  // retire:bibliographic-mirror, and `student_applications` is the applications
  // migration target above, so none of those are listed here.
  'faculty_members',
  'listings',
  'listingclaimrequests',
  'student_engagement_events',
  'student_outreaches',
  'student_profiles',
  'student_trackings',
  'saved_searches',
  'grants',
  'posted_opportunities',
  'admin_access_review_projections',
  'admin_access_review_projection_state',
  // The frozen evidence claim-graph, retired once it had held zero rows in
  // every environment since it was introduced. `student_applications` is the
  // target of the applications migration above, whose source collection no
  // longer exists in any environment, so the migration can never run again.
  'evidence_claims',
  'review_decisions',
  'source_documents',
  'student_applications',
];

// Indexes left behind by retired schema fields. Mongoose never drops an index
// it has stopped declaring, so removing the field alone leaves the physical
// index maintained on every write and used by nothing.
const RETIRED_INDEXES = [
  {
    collection: 'taxonomy_terms',
    name: 'parentTermId_1_kind_1_status_1_archived_1',
    key: { parentTermId: 1, kind: 1, status: 1, archived: 1 },
    retiredField: 'parentTermId',
  },
  {
    collection: 'research_entities',
    name: 'archived_1_hasDocumentedWayIn_1',
    key: { archived: 1, hasDocumentedWayIn: 1 },
    retiredField: 'hasDocumentedWayIn',
  },
] as const;

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

export function parseRequiredBackupPath(value: string | undefined): string {
  const backup = value?.trim();
  if (!backup || backup.startsWith('--')) {
    throw new Error('--backup requires a directory holding the mongodump .bson files');
  }
  return path.resolve(backup);
}

export function parseLegacyCleanupArgs(argv: string[]): LegacyCleanupArgs {
  const args: LegacyCleanupArgs = { mode: 'dry-run' };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.mode = 'dry-run';
      continue;
    }
    if (arg === '--drop-legacy') {
      args.mode = 'drop-legacy';
      continue;
    }
    if (arg === '--confirm-drop-legacy') {
      args.confirmDropLegacy = true;
      continue;
    }
    if (arg === '--drop-retired-populated') {
      args.mode = 'drop-retired-populated';
      continue;
    }
    if (arg === '--confirm-drop-retired-populated') {
      args.confirmDropRetiredPopulated = true;
      continue;
    }
    if (arg === '--backup') {
      args.backup = parseRequiredBackupPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--backup=')) {
      args.backup = parseRequiredBackupPath(arg.slice('--backup='.length));
      continue;
    }
    if (arg === '--verify') {
      args.mode = 'verify';
      continue;
    }
    if (arg === '--apply') {
      args.mode = 'apply';
      continue;
    }
    if (arg === '--output') {
      args.output = parseRequiredOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown legacy:cleanup option: ${arg}`);
  }

  return args;
}

function legacyCleanupModeWrites(mode: Mode): boolean {
  return mode === 'apply' || mode === 'drop-legacy' || mode === 'drop-retired-populated';
}

export function assertLegacyCleanupWriteAllowed(
  args: Pick<
    LegacyCleanupArgs,
    'mode' | 'confirmDropLegacy' | 'confirmDropRetiredPopulated' | 'backup'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.mode === 'drop-legacy' && !args.confirmDropLegacy) {
    throw new Error(
      '--confirm-drop-legacy is required when --drop-legacy is set for legacy:cleanup',
    );
  }

  if (args.mode === 'drop-retired-populated') {
    if (!args.confirmDropRetiredPopulated) {
      throw new Error(
        '--confirm-drop-retired-populated is required when --drop-retired-populated is set for legacy:cleanup',
      );
    }
    if (!args.backup) {
      throw new Error(
        '--backup is required when --drop-retired-populated is set: these collections hold rows, so the drop is gated on a dump whose counts match',
      );
    }
  }

  return assertScriptApplyAllowed({
    apply: legacyCleanupModeWrites(args.mode),
    scriptName: 'legacy:cleanup',
    mongoUrl,
    env,
  });
}

export function buildLegacyCleanupOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: LegacyCleanupArgs;
  },
): T & {
  environment?: string;
  db?: string;
  options: LegacyCleanupArgs;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function writeLegacyCleanupOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function countCollection(db: MongoDb, name: string): Promise<number> {
  if (!(await collectionExists(db, name))) return 0;
  return db.collection(name).countDocuments();
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function normalizeLegacyCleanupObjectId(value: unknown): Types.ObjectId | undefined {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  return LEGACY_CLEANUP_OBJECT_ID_RE.test(raw) ? new Types.ObjectId(raw) : undefined;
}

async function findOneByObjectId(
  db: MongoDb,
  collectionName: string,
  value: unknown,
): Promise<Record<string, any> | null> {
  const id = normalizeLegacyCleanupObjectId(value);
  if (!id) return null;
  return db.collection(collectionName).findOne({ _id: id });
}

async function normalizeApplication(db: MongoDb, raw: Record<string, any>) {
  const listing = await findOneByObjectId(db, 'listings', raw.listingId);
  const listingObjectId = listing?._id;
  const postedOpportunity = listingObjectId
    ? await db.collection('posted_opportunities').findOne({ listingId: listingObjectId })
    : null;
  const studentObjectId = normalizeLegacyCleanupObjectId(raw.studentId);
  const userById = studentObjectId
    ? await db.collection('users').findOne({ _id: studentObjectId })
    : null;
  const userByNetId = raw.studentNetId
    ? await db.collection('users').findOne({ netid: raw.studentNetId })
    : null;
  const studentUser = userById || userByNetId;
  const profileById = studentObjectId
    ? await db.collection('student_profiles').findOne({ _id: studentObjectId })
    : null;
  const profileByUserId = studentUser?._id
    ? await db.collection('student_profiles').findOne({ userId: studentUser._id })
    : null;
  const studentProfile = profileById || profileByUserId;

  return {
    legacyApplicationId: toString(raw._id),
    listingId: toString(raw.listingId),
    ...(listingObjectId ? { listingObjectId } : {}),
    ...(postedOpportunity?._id ? { postedOpportunityId: postedOpportunity._id } : {}),
    ...(listing?.researchEntityId || postedOpportunity?.researchEntityId
      ? { researchEntityId: listing?.researchEntityId || postedOpportunity?.researchEntityId }
      : {}),
    studentId: toString(raw.studentId),
    ...(studentUser?._id ? { studentUserId: studentUser._id } : {}),
    ...(studentProfile?._id ? { studentProfileId: studentProfile._id } : {}),
    studentName: toString(raw.studentName),
    studentEmail: toString(raw.studentEmail),
    studentNetId: toString(raw.studentNetId),
    resumeUrl: toString(raw.resumeUrl),
    coverLetter: toString(raw.coverLetter),
    customQuestions: Array.isArray(raw.customQuestions) ? raw.customQuestions : [],
    status: toString(raw.status),
    ...(raw.appliedAt ? { appliedAt: raw.appliedAt } : {}),
    professorNotes: toString(raw.professorNotes),
    legacyPayload: raw,
    migratedAt: new Date(),
    legacySourceCollection: APPLICATIONS_SOURCE,
    ...(raw.createdAt ? { createdAt: raw.createdAt } : {}),
    ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
  };
}

async function createStudentApplicationIndexes(db: MongoDb) {
  const collection = db.collection(STUDENT_APPLICATIONS_TARGET);
  await collection.createIndex({ legacyApplicationId: 1 }, { unique: true });
  await collection.createIndex({ listingObjectId: 1 });
  await collection.createIndex({ postedOpportunityId: 1 });
  await collection.createIndex({ researchEntityId: 1 });
  await collection.createIndex({ studentUserId: 1 });
  await collection.createIndex({ studentProfileId: 1 });
  await collection.createIndex({ studentNetId: 1 });
  await collection.createIndex({ status: 1 });
  await collection.createIndex({ appliedAt: -1 });
}

async function copyApplications(db: MongoDb, apply: boolean) {
  if (!(await collectionExists(db, APPLICATIONS_SOURCE))) {
    return { sourceExists: false, scanned: 0, upserts: 0 };
  }

  const source = db.collection(APPLICATIONS_SOURCE);
  const target = db.collection(STUDENT_APPLICATIONS_TARGET);
  const cursor = source.find({}).sort({ _id: 1 });
  let scanned = 0;
  let upserts = 0;

  for await (const raw of cursor) {
    scanned++;
    const doc = await normalizeApplication(db, raw as Record<string, any>);
    if (apply) {
      const result = await target.updateOne(
        { legacyApplicationId: doc.legacyApplicationId },
        { $set: doc },
        { upsert: true },
      );
      if (result.upsertedCount || result.modifiedCount || result.matchedCount) upserts++;
    }
  }

  if (apply) {
    await createStudentApplicationIndexes(db);
  }

  return { sourceExists: true, scanned, upserts: apply ? upserts : 0 };
}

async function countMissingStudentApplications(db: MongoDb): Promise<number> {
  if (!(await collectionExists(db, APPLICATIONS_SOURCE))) return 0;
  const rows = await db
    .collection(APPLICATIONS_SOURCE)
    .aggregate([
      { $addFields: { legacyApplicationId: { $toString: '$_id' } } },
      {
        $lookup: {
          from: STUDENT_APPLICATIONS_TARGET,
          localField: 'legacyApplicationId',
          foreignField: 'legacyApplicationId',
          as: 'target',
        },
      },
      { $match: { target: { $eq: [] } } },
      { $count: 'count' },
    ])
    .toArray();
  return Number(rows[0]?.count || 0);
}

async function inspectEmptyLegacyCollections(db: MongoDb) {
  return Promise.all(
    EMPTY_LEGACY_COLLECTIONS.map(async (name) => ({
      name,
      exists: await collectionExists(db, name),
      count: await countCollection(db, name),
    })),
  );
}

async function verify(db: MongoDb) {
  const [
    applicationsSourceExists,
    applicationsSourceCount,
    studentApplicationsTargetExists,
    studentApplicationsTargetCount,
    missingStudentApplications,
    emptyLegacyCollections,
  ] = await Promise.all([
    collectionExists(db, APPLICATIONS_SOURCE),
    countCollection(db, APPLICATIONS_SOURCE),
    collectionExists(db, STUDENT_APPLICATIONS_TARGET),
    countCollection(db, STUDENT_APPLICATIONS_TARGET),
    countMissingStudentApplications(db),
    inspectEmptyLegacyCollections(db),
  ]);

  const nonEmptyLegacyCollections = emptyLegacyCollections.filter((item) => item.count > 0);
  const studentApplicationsOk = applicationsSourceExists
    ? studentApplicationsTargetExists &&
      studentApplicationsTargetCount >= applicationsSourceCount &&
      missingStudentApplications === 0
    : true;
  const emptyLegacyOk = nonEmptyLegacyCollections.length === 0;

  return {
    ok: studentApplicationsOk && emptyLegacyOk,
    applications: {
      source: APPLICATIONS_SOURCE,
      target: STUDENT_APPLICATIONS_TARGET,
      sourceExists: applicationsSourceExists,
      sourceCount: applicationsSourceCount,
      targetExists: studentApplicationsTargetExists,
      targetCount: studentApplicationsTargetCount,
      missingTargetRows: missingStudentApplications,
    },
    emptyLegacyCollections,
    nonEmptyLegacyCollections,
  };
}

export function retiredIndexKeyMatches(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, number>,
): boolean {
  if (!actual) return false;
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;
  return expectedKeys.every(
    (field, position) =>
      actualKeys[position] === field && Number(actual[field]) === expected[field],
  );
}

async function dropRetiredIndexes(db: MongoDb) {
  const results: Array<{
    collection: string;
    name: string;
    dropped: boolean;
    reason?: string;
  }> = [];

  for (const retired of RETIRED_INDEXES) {
    const { collection, name, key, retiredField } = retired;
    if (!(await collectionExists(db, collection))) {
      results.push({ collection, name, dropped: false, reason: 'collection absent' });
      continue;
    }

    const indexes = await db.collection(collection).indexes();
    const match = indexes.find((index) => index.name === name);
    if (!match) {
      results.push({ collection, name, dropped: false, reason: 'index absent' });
      continue;
    }
    if (!retiredIndexKeyMatches(match.key as Record<string, unknown>, { ...key })) {
      throw new Error(
        `Refusing to drop ${collection}.${name}: index key ${JSON.stringify(match.key)} does not match the retired declaration`,
      );
    }

    const populated = await db
      .collection(collection)
      .countDocuments({ [retiredField]: { $exists: true, $ne: null } }, { limit: 1 });
    if (populated > 0) {
      throw new Error(
        `Refusing to drop ${collection}.${name}: retired field ${retiredField} is populated, so something began writing it`,
      );
    }

    await db.collection(collection).dropIndex(name);
    results.push({ collection, name, dropped: true });
  }

  return results;
}

async function dropLegacyCollections(db: MongoDb) {
  const before = await verify(db);
  if (!before.ok) {
    throw new Error(`Refusing legacy cleanup drop: ${JSON.stringify(before)}`);
  }

  const dropped: Array<{ name: string; dropped: boolean; reason?: string }> = [];
  const candidates = [APPLICATIONS_SOURCE, ...EMPTY_LEGACY_COLLECTIONS];
  for (const name of candidates) {
    if (!(await collectionExists(db, name))) {
      dropped.push({ name, dropped: false, reason: 'absent' });
      continue;
    }
    const count = await countCollection(db, name);
    if (name !== APPLICATIONS_SOURCE && count > 0) {
      throw new Error(`Refusing to drop non-empty legacy collection ${name}`);
    }
    dropped.push({ name, dropped: await db.collection(name).drop() });
  }

  const retiredIndexes = await dropRetiredIndexes(db);

  const after = await verify(db);
  if (!after.ok) {
    throw new Error(`Post-drop legacy cleanup verification failed: ${JSON.stringify(after)}`);
  }

  return { before, dropped, retiredIndexes, after };
}

function modelledCollectionNames(): string[] {
  return mongoose.modelNames().map((name) => mongoose.model(name).collection.collectionName);
}

function readBackupCounts(backupDir: string): Record<string, number | undefined> {
  const counts: Record<string, number | undefined> = {};
  for (const collection of RETIRED_POPULATED_COLLECTIONS) {
    const dump = path.join(backupDir, `${collection}.bson`);
    if (!fs.existsSync(dump)) continue;
    counts[collection] = countBsonDocuments(fs.readFileSync(dump));
  }
  return counts;
}

interface RetiredPopulatedReport {
  liveCounts: Record<string, number>;
  backup?: { dir: string; checks: RetiredCollectionBackupCheck[] };
  dropped?: Array<{ name: string; rows: number; dropped: boolean; reason?: string }>;
}

async function countRetiredPopulatedCollections(db: MongoDb): Promise<Record<string, number>> {
  const liveCounts: Record<string, number> = {};
  for (const collection of RETIRED_POPULATED_COLLECTIONS) {
    liveCounts[collection] = await countCollection(db, collection);
  }
  return liveCounts;
}

async function planRetiredPopulatedDrop(
  db: MongoDb,
  backupDir?: string,
): Promise<RetiredPopulatedReport> {
  const liveCounts = await countRetiredPopulatedCollections(db);
  if (!backupDir) return { liveCounts };
  return {
    liveCounts,
    backup: {
      dir: backupDir,
      checks: evaluateRetiredCollectionBackup({
        liveCounts,
        backupCounts: readBackupCounts(backupDir),
      }).checks,
    },
  };
}

async function dropRetiredPopulatedCollections(
  db: MongoDb,
  backupDir: string,
): Promise<RetiredPopulatedReport> {
  assertRetiredCollectionsAreUnmodelled({
    collections: RETIRED_POPULATED_COLLECTIONS,
    modelledCollections: modelledCollectionNames(),
  });

  const liveCounts = await countRetiredPopulatedCollections(db);

  const backup = evaluateRetiredCollectionBackup({
    liveCounts,
    backupCounts: readBackupCounts(backupDir),
  });
  if (!backup.ok) {
    const failures = backup.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.collection}: ${check.reason}`)
      .join('; ');
    throw new Error(
      `Refusing to drop retired populated collections, backup is incomplete. ${failures}`,
    );
  }

  const dropped: Array<{ name: string; rows: number; dropped: boolean; reason?: string }> = [];
  for (const collection of RETIRED_POPULATED_COLLECTIONS) {
    if (!(await collectionExists(db, collection))) {
      dropped.push({ name: collection, rows: 0, dropped: false, reason: 'absent' });
      continue;
    }
    dropped.push({
      name: collection,
      rows: liveCounts[collection],
      dropped: await db.collection(collection).drop(),
    });
  }

  const survivors: string[] = [];
  for (const collection of RETIRED_POPULATED_COLLECTIONS) {
    if (await collectionExists(db, collection)) survivors.push(collection);
  }
  if (survivors.length > 0) {
    throw new Error(`Retired collections still present after drop: ${survivors.join(', ')}`);
  }

  return { liveCounts, backup: { dir: backupDir, checks: backup.checks }, dropped };
}

async function main() {
  const args = parseLegacyCleanupArgs(process.argv.slice(2));
  const guard = assertLegacyCleanupWriteAllowed(args, process.env, process.env.MONGODBURL);
  const mode = args.mode;
  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  let copy;
  let drop;
  let retiredPopulated: RetiredPopulatedReport | undefined;
  if (mode === 'dry-run' || mode === 'apply') {
    copy = await copyApplications(db, mode === 'apply');
  } else if (mode === 'drop-legacy') {
    drop = await dropLegacyCollections(db);
  } else if (mode === 'drop-retired-populated') {
    retiredPopulated = await dropRetiredPopulatedCollections(db, args.backup as string);
  }

  if (mode === 'dry-run') {
    retiredPopulated = await planRetiredPopulatedDrop(db, args.backup);
  }

  const verification = mode === 'drop-legacy' ? drop?.after : await verify(db);
  if (mode === 'apply' && !verification?.ok) {
    throw new Error(`Legacy collection cleanup failed: ${JSON.stringify(verification)}`);
  }

  const output = buildLegacyCleanupOutput(
    {
      generatedAt: new Date().toISOString(),
      mode,
      copy,
      drop,
      retiredPopulated,
      verification,
    },
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options: args,
    },
  );
  console.log(JSON.stringify(output, null, 2));
  writeLegacyCleanupOutput(output, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to clean legacy Mongo collections:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
