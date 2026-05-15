import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';

dotenv.config();

type MongoDb = NonNullable<typeof mongoose.connection.db>;
type Mode = 'dry-run' | 'apply' | 'verify' | 'drop-legacy';

const APPLICATIONS_SOURCE = 'applications';
const STUDENT_APPLICATIONS_TARGET = 'student_applications';
const EMPTY_LEGACY_COLLECTIONS = [
  'research_groups',
  'research_group_members',
  'research_group_stats',
  'paper_group_links',
];

function parseMode(argv: string[]): Mode {
  if (argv.includes('--drop-legacy')) return 'drop-legacy';
  if (argv.includes('--verify')) return 'verify';
  if (argv.includes('--apply')) return 'apply';
  return 'dry-run';
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

function toObjectId(value: unknown): Types.ObjectId | undefined {
  const raw = toString(value);
  return Types.ObjectId.isValid(raw) ? new Types.ObjectId(raw) : undefined;
}

async function findOneByObjectId(
  db: MongoDb,
  collectionName: string,
  value: unknown,
): Promise<Record<string, any> | null> {
  const id = toObjectId(value);
  if (!id) return null;
  return db.collection(collectionName).findOne({ _id: id });
}

async function normalizeApplication(db: MongoDb, raw: Record<string, any>) {
  const listing = await findOneByObjectId(db, 'listings', raw.listingId);
  const listingObjectId = listing?._id;
  const postedOpportunity = listingObjectId
    ? await db.collection('posted_opportunities').findOne({ listingId: listingObjectId })
    : null;
  const studentObjectId = toObjectId(raw.studentId);
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

  const after = await verify(db);
  if (!after.ok) {
    throw new Error(`Post-drop legacy cleanup verification failed: ${JSON.stringify(after)}`);
  }

  return { before, dropped, after };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  let copy;
  let drop;
  if (mode === 'dry-run' || mode === 'apply') {
    copy = await copyApplications(db, mode === 'apply');
  } else if (mode === 'drop-legacy') {
    drop = await dropLegacyCollections(db);
  }

  const verification = mode === 'drop-legacy' ? drop?.after : await verify(db);
  if (mode === 'apply' && !verification?.ok) {
    throw new Error(`Legacy collection cleanup failed: ${JSON.stringify(verification)}`);
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        copy,
        drop,
        verification,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to clean legacy Mongo collections:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
