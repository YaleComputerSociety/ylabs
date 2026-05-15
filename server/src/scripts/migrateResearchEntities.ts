import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';

dotenv.config();

type MongoDb = NonNullable<typeof mongoose.connection.db>;

type Mode = 'dry-run' | 'apply' | 'verify' | 'rollback-plan';

interface ReferenceCheck {
  collection: string;
  field: string;
  label: string;
  array?: boolean;
}

const SOURCE_COLLECTION = 'research_groups';
const TARGET_COLLECTION = 'research_entities';

const REFERENCE_CHECKS: ReferenceCheck[] = [
  { collection: 'entry_pathways', field: 'researchEntityId', label: 'EntryPathway host entity' },
  { collection: 'access_signals', field: 'researchEntityId', label: 'AccessSignal host entity' },
  { collection: 'contact_routes', field: 'researchEntityId', label: 'ContactRoute host entity' },
  { collection: 'posted_opportunities', field: 'researchEntityId', label: 'PostedOpportunity host entity' },
  { collection: 'listings', field: 'researchEntityId', label: 'Listing host entity' },
  { collection: 'research_entity_members', field: 'researchEntityId', label: 'Member host entity' },
  { collection: 'research_entity_stats', field: 'researchEntityId', label: 'Stats host entity' },
  { collection: 'paper_entity_links', field: 'researchEntityId', label: 'Paper link host entity' },
  { collection: 'research_group_members', field: 'researchEntityId', label: 'Member host entity' },
  { collection: 'research_group_stats', field: 'researchEntityId', label: 'Stats host entity' },
  { collection: 'paper_group_links', field: 'researchEntityId', label: 'Paper link host entity' },
  { collection: 'papers', field: 'researchEntityIds', label: 'Paper linked entities', array: true },
  { collection: 'grants', field: 'researchEntityIds', label: 'Grant linked entities', array: true },
  { collection: 'student_trackings', field: 'researchEntityId', label: 'Student tracking entity' },
  { collection: 'student_outreaches', field: 'researchEntityId', label: 'Student outreach entity' },
  {
    collection: 'student_engagement_events',
    field: 'researchEntityId',
    label: 'Student event entity',
  },
  { collection: 'observations', field: 'entityId', label: 'ResearchEntity observations' },
];

const BACKFILL_FIELD_PAIRS = [
  { collection: 'listings', legacy: 'researchGroupId', next: 'researchEntityId' },
  { collection: 'research_group_members', legacy: 'researchGroupId', next: 'researchEntityId' },
  { collection: 'research_group_stats', legacy: 'researchGroupId', next: 'researchEntityId' },
  { collection: 'paper_group_links', legacy: 'researchGroupId', next: 'researchEntityId' },
  { collection: 'student_trackings', legacy: 'researchGroupId', next: 'researchEntityId' },
  { collection: 'student_outreaches', legacy: 'researchGroupId', next: 'researchEntityId' },
  { collection: 'student_engagement_events', legacy: 'researchGroupId', next: 'researchEntityId' },
] as const;

const BACKFILL_ARRAY_FIELD_PAIRS = [
  { collection: 'papers', legacy: 'researchGroupIds', next: 'researchEntityIds' },
  { collection: 'grants', legacy: 'researchGroupIds', next: 'researchEntityIds' },
] as const;

function parseMode(argv: string[]): Mode {
  if (argv.includes('--rollback-plan')) return 'rollback-plan';
  if (argv.includes('--verify')) return 'verify';
  if (argv.includes('--apply')) return 'apply';
  return 'dry-run';
}

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

function normalizeArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(Boolean).map((item) => item)));
}

function normalizeResearchEntityDoc(doc: Record<string, any>): Record<string, any> {
  const name = String(doc.name || doc.displayName || '').trim();
  const slug = String(doc.slug || '').trim();
  if (!name || !slug) {
    throw new Error(`Malformed research entity ${doc._id}: missing name or slug`);
  }

  return {
    ...doc,
    slug,
    name,
    displayName: doc.displayName || name,
    entityType: doc.entityType || mapResearchGroupKindToEntityType(doc.kind),
    description: doc.description || doc.fullDescription || doc.shortDescription || '',
    websiteUrl: doc.websiteUrl || doc.website || '',
    departments: normalizeArray(doc.departments),
    researchAreas: normalizeArray(doc.researchAreas),
    sourceUrls: normalizeArray(doc.sourceUrls),
  };
}

async function countCollection(db: MongoDb, name: string): Promise<number> {
  if (!(await collectionExists(db, name))) return 0;
  return db.collection(name).countDocuments();
}

async function duplicateSlugRows(db: MongoDb, collection: string) {
  if (!(await collectionExists(db, collection))) return [];
  return db
    .collection(collection)
    .aggregate([
      { $match: { slug: { $exists: true, $ne: '' } } },
      { $group: { _id: '$slug', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();
}

async function malformedSourceRows(db: MongoDb): Promise<number> {
  if (!(await collectionExists(db, SOURCE_COLLECTION))) return 0;
  return db.collection(SOURCE_COLLECTION).countDocuments({
    $or: [
      { slug: { $exists: false } },
      { slug: '' },
      { name: { $exists: false } },
      { name: '' },
    ],
  });
}

async function malformedTargetRows(db: MongoDb): Promise<number> {
  if (!(await collectionExists(db, TARGET_COLLECTION))) return 0;
  return db.collection(TARGET_COLLECTION).countDocuments({
    $or: [
      { slug: { $exists: false } },
      { slug: '' },
      { name: { $exists: false } },
      { name: '' },
      { entityType: { $exists: false } },
      { entityType: '' },
    ],
  });
}

async function countMissingTargetIds(db: MongoDb): Promise<number> {
  if (!(await collectionExists(db, SOURCE_COLLECTION))) return 0;
  const rows = await db
    .collection(SOURCE_COLLECTION)
    .aggregate([
      {
        $lookup: {
          from: TARGET_COLLECTION,
          localField: '_id',
          foreignField: '_id',
          as: 'target',
        },
      },
      { $match: { target: { $eq: [] } } },
      { $count: 'count' },
    ])
    .toArray();
  return Number(rows[0]?.count || 0);
}

async function preflight(db: MongoDb): Promise<void> {
  const sourceExists = await collectionExists(db, SOURCE_COLLECTION);
  if (!sourceExists) throw new Error(`${SOURCE_COLLECTION} collection does not exist`);

  const [sourceDuplicateSlugs, targetDuplicateSlugs, malformed] = await Promise.all([
    duplicateSlugRows(db, SOURCE_COLLECTION),
    duplicateSlugRows(db, TARGET_COLLECTION),
    malformedSourceRows(db),
  ]);

  if (sourceDuplicateSlugs.length > 0) {
    throw new Error(`Duplicate source slugs found: ${JSON.stringify(sourceDuplicateSlugs)}`);
  }
  if (targetDuplicateSlugs.length > 0) {
    throw new Error(`Duplicate target slugs found: ${JSON.stringify(targetDuplicateSlugs)}`);
  }
  if (malformed > 0) {
    throw new Error(`${malformed} source research group rows are missing required name/slug`);
  }
}

async function copyResearchEntities(db: MongoDb, apply: boolean) {
  const source = db.collection(SOURCE_COLLECTION);
  const target = db.collection(TARGET_COLLECTION);
  const cursor = source.find({}).sort({ _id: 1 });
  let scanned = 0;
  let upserts = 0;

  for await (const raw of cursor) {
    scanned++;
    const doc = normalizeResearchEntityDoc(raw);
    if (apply) {
      const result = await target.updateOne(
        { _id: doc._id },
        { $set: doc },
        { upsert: true },
      );
      if (result.upsertedCount || result.modifiedCount || result.matchedCount) upserts++;
    }
  }

  if (apply) {
    await target.createIndex({ slug: 1 }, { unique: true });
    await target.createIndex({ entityType: 1 });
    await target.createIndex({ archived: 1 });
    await target.createIndex({ lastObservedAt: 1 });
  }

  return { scanned, upserts: apply ? upserts : 0 };
}

async function backfillReferences(db: MongoDb, apply: boolean) {
  const scalarResults = [];
  for (const pair of BACKFILL_FIELD_PAIRS) {
    const collection = db.collection(pair.collection);
    const filter = {
      [pair.legacy]: { $exists: true, $ne: null },
      $or: [{ [pair.next]: { $exists: false } }, { [pair.next]: null }],
    };
    const matched = await collection.countDocuments(filter);
    if (apply && matched > 0) {
      await collection.updateMany(filter, [{ $set: { [pair.next]: `$${pair.legacy}` } }]);
    }
    scalarResults.push({ ...pair, matched, updated: apply ? matched : 0 });
  }

  const arrayResults = [];
  for (const pair of BACKFILL_ARRAY_FIELD_PAIRS) {
    const collection = db.collection(pair.collection);
    const filter = {
      [pair.legacy]: { $exists: true, $type: 'array', $ne: [] },
      $or: [{ [pair.next]: { $exists: false } }, { [pair.next]: { $size: 0 } }],
    };
    const matched = await collection.countDocuments(filter);
    if (apply && matched > 0) {
      await collection.updateMany(filter, [{ $set: { [pair.next]: `$${pair.legacy}` } }]);
    }
    arrayResults.push({ ...pair, matched, updated: apply ? matched : 0 });
  }

  const researchGroupObservations = await db.collection('observations').countDocuments({
    entityType: 'researchGroup',
  });
  if (apply && researchGroupObservations > 0) {
    await db.collection('observations').updateMany(
      { entityType: 'researchGroup' },
      { $set: { entityType: 'researchEntity' } },
    );
  }

  return {
    scalarResults,
    arrayResults,
    observationsUpdated: apply ? researchGroupObservations : 0,
    observationsToUpdate: researchGroupObservations,
  };
}

async function countDanglingReferences(db: MongoDb, check: ReferenceCheck) {
  if (!(await collectionExists(db, check.collection))) {
    return { ...check, collectionExists: false, sourceDocuments: 0, danglingReferences: 0 };
  }

  const baseMatch = {
    ...(check.collection === 'observations' ? { entityType: 'researchEntity' } : {}),
    [check.field]: check.array
      ? { $exists: true, $type: 'array', $ne: [] }
      : { $exists: true, $ne: null },
  };

  const rows = await db
    .collection(check.collection)
    .aggregate([
      { $match: baseMatch },
      ...(check.array ? [{ $unwind: `$${check.field}` }] : []),
      {
        $lookup: {
          from: TARGET_COLLECTION,
          localField: check.field,
          foreignField: '_id',
          as: 'matchedResearchEntity',
        },
      },
      { $match: { matchedResearchEntity: { $eq: [] } } },
      { $count: 'count' },
    ])
    .toArray();

  return {
    ...check,
    collectionExists: true,
    sourceDocuments: await db.collection(check.collection).countDocuments(baseMatch),
    danglingReferences: Number(rows[0]?.count || 0),
  };
}

async function verify(db: MongoDb) {
  const sourceCollectionExists = await collectionExists(db, SOURCE_COLLECTION);
  const [
    sourceCount,
    targetCount,
    missingTargetIds,
    targetDuplicateSlugs,
    malformedTarget,
    references,
  ] = await Promise.all([
    countCollection(db, SOURCE_COLLECTION),
    countCollection(db, TARGET_COLLECTION),
    countMissingTargetIds(db),
    duplicateSlugRows(db, TARGET_COLLECTION),
    malformedTargetRows(db),
    Promise.all(REFERENCE_CHECKS.map((check) => countDanglingReferences(db, check))),
  ]);

  const failed = sourceCollectionExists
    ? sourceCount !== targetCount ||
      missingTargetIds > 0 ||
      targetDuplicateSlugs.length > 0 ||
      malformedTarget > 0 ||
      references.some((ref) => ref.danglingReferences > 0)
    : targetCount === 0 ||
      targetDuplicateSlugs.length > 0 ||
      malformedTarget > 0 ||
      references.some((ref) => ref.danglingReferences > 0);

  return {
    ok: !failed,
    sourceCollectionExists,
    sourceCount,
    targetCount,
    missingTargetIds,
    targetDuplicateSlugs,
    malformedTarget,
    references,
  };
}

function rollbackPlan() {
  return {
    warning:
      'Rollback should pause app writes first. If research_groups has been dropped without an export, rollback depends on Mongo backup/restore.',
    steps: [
      'Set app runtime back to the previous commit if a rollback is needed.',
      'Use research_groups as the preserved source collection if it still exists.',
      'If research_groups has been dropped, restore it from a database backup before reverting runtime code.',
      'Drop research_entities only after exporting or snapshotting it if any post-migration writes may need inspection.',
      'Unset researchEntityId fields only if the previous runtime cannot tolerate extra fields.',
      'Restore observations entityType from backup if downstream tooling requires researchGroup observations.',
    ],
  };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === 'rollback-plan') {
    console.log(JSON.stringify({ mode, ...rollbackPlan() }, null, 2));
    return;
  }

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  if (mode !== 'verify') {
    await preflight(db);
  }
  const apply = mode === 'apply';
  const copy = mode === 'verify' ? undefined : await copyResearchEntities(db, apply);
  const backfill = mode === 'verify' ? undefined : await backfillReferences(db, apply);
  const verification = await verify(db);

  if (mode === 'apply' && !verification.ok) {
    throw new Error(`ResearchEntity migration verification failed: ${JSON.stringify(verification)}`);
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        canonicalCollection: TARGET_COLLECTION,
        legacySourceCollection: SOURCE_COLLECTION,
        sourceCollectionPreservedForRollback: verification.sourceCollectionExists
          ? SOURCE_COLLECTION
          : null,
        copy,
        backfill,
        verification,
        rollbackPlan: rollbackPlan(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to migrate ResearchEntity collection:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
