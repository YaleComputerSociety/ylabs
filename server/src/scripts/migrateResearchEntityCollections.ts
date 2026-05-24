import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';
import { resolveScraperEnvironment } from '../scrapers/scraperEnvironment';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

type MongoDb = NonNullable<typeof mongoose.connection.db>;
type Mode = 'dry-run' | 'apply' | 'verify' | 'drop-legacy';
type MigrationDocument = Record<string, unknown> & {
  _id: unknown;
  researchEntityId: unknown;
};

interface CollectionMigration {
  source: string;
  target: string;
  label: string;
  indexes: Array<{
    keys: Record<string, 1 | -1>;
    options?: Record<string, unknown>;
  }>;
}

const RESEARCH_ENTITY_COLLECTION = 'research_entities';

const COLLECTION_MIGRATIONS: CollectionMigration[] = [
  {
    source: 'research_group_members',
    target: 'research_entity_members',
    label: 'ResearchEntity members',
    indexes: [
      { keys: { researchEntityId: 1, userId: 1 } },
      { keys: { researchEntityId: 1, role: 1 } },
      { keys: { userId: 1 } },
    ],
  },
];

function parseMode(argv: string[]): Mode {
  if (argv.includes('--drop-legacy')) return 'drop-legacy';
  if (argv.includes('--verify')) return 'verify';
  if (argv.includes('--apply')) return 'apply';
  return 'dry-run';
}

function assertModeAllowed(mode: Mode, argv: string[], env: NodeJS.ProcessEnv = process.env): void {
  if (mode !== 'drop-legacy') return;

  if (!argv.includes('--confirm-drop-legacy')) {
    throw new Error('ResearchEntity collection drop requires --confirm-drop-legacy with --drop-legacy.');
  }

  if (resolveScraperEnvironment(env) === 'production' && env.CONFIRM_PROD_SCRAPE !== 'true') {
    throw new Error(
      'Production ResearchEntity collection drop requires CONFIRM_PROD_SCRAPE=true in the environment.',
    );
  }
}

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function countCollection(db: MongoDb, name: string): Promise<number> {
  if (!(await collectionExists(db, name))) return 0;
  return db.collection(name).countDocuments();
}

async function countMissingEntityIds(db: MongoDb, collectionName: string): Promise<number> {
  if (!(await collectionExists(db, collectionName))) return 0;
  return db.collection(collectionName).countDocuments({
    $or: [{ researchEntityId: { $exists: false } }, { researchEntityId: null }],
  });
}

async function countSourceRowsWithoutEntityId(
  db: MongoDb,
  collectionName: string,
): Promise<number> {
  if (!(await collectionExists(db, collectionName))) return 0;
  return db.collection(collectionName).countDocuments({
    $and: [
      { $or: [{ researchEntityId: { $exists: false } }, { researchEntityId: null }] },
      { $or: [{ researchGroupId: { $exists: false } }, { researchGroupId: null }] },
    ],
  });
}

async function countDanglingEntityReferences(
  db: MongoDb,
  collectionName: string,
): Promise<number> {
  if (!(await collectionExists(db, collectionName))) return 0;
  const rows = await db
    .collection(collectionName)
    .aggregate([
      { $match: { researchEntityId: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: RESEARCH_ENTITY_COLLECTION,
          localField: 'researchEntityId',
          foreignField: '_id',
          as: 'matchedResearchEntity',
        },
      },
      { $match: { matchedResearchEntity: { $eq: [] } } },
      { $count: 'count' },
    ])
    .toArray();
  return Number(rows[0]?.count || 0);
}

async function countDanglingSourceEntityReferences(
  db: MongoDb,
  collectionName: string,
): Promise<number> {
  if (!(await collectionExists(db, collectionName))) return 0;
  const rows = await db
    .collection(collectionName)
    .aggregate([
      {
        $addFields: {
          _migrationResearchEntityId: { $ifNull: ['$researchEntityId', '$researchGroupId'] },
        },
      },
      { $match: { _migrationResearchEntityId: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: RESEARCH_ENTITY_COLLECTION,
          localField: '_migrationResearchEntityId',
          foreignField: '_id',
          as: 'matchedResearchEntity',
        },
      },
      { $match: { matchedResearchEntity: { $eq: [] } } },
      { $count: 'count' },
    ])
    .toArray();
  return Number(rows[0]?.count || 0);
}

async function countMissingTargetIds(db: MongoDb, migration: CollectionMigration) {
  if (!(await collectionExists(db, migration.source))) return 0;
  const rows = await db
    .collection(migration.source)
    .aggregate([
      {
        $lookup: {
          from: migration.target,
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

async function countExtraTargetIds(db: MongoDb, migration: CollectionMigration) {
  if (
    !(await collectionExists(db, migration.source)) ||
    !(await collectionExists(db, migration.target))
  ) {
    return 0;
  }
  const rows = await db
    .collection(migration.target)
    .aggregate([
      {
        $lookup: {
          from: migration.source,
          localField: '_id',
          foreignField: '_id',
          as: 'source',
        },
      },
      { $match: { source: { $eq: [] } } },
      { $count: 'count' },
    ])
    .toArray();
  return Number(rows[0]?.count || 0);
}

async function createIndexes(db: MongoDb, migration: CollectionMigration) {
  const collection = db.collection(migration.target);
  for (const index of migration.indexes) {
    await collection.createIndex(index.keys, index.options);
  }
}

function normalizeDocument(raw: Record<string, unknown>): MigrationDocument {
  if (!('_id' in raw)) {
    throw new Error('Source document is missing _id');
  }
  const researchEntityId = raw.researchEntityId || raw.researchGroupId;
  if (!researchEntityId) {
    throw new Error(`Document ${String(raw._id)} is missing researchEntityId`);
  }
  return {
    ...raw,
    researchEntityId,
  } as MigrationDocument;
}

async function copyCollection(db: MongoDb, migration: CollectionMigration, apply: boolean) {
  if (!(await collectionExists(db, migration.source))) {
    return { ...migration, sourceExists: false, scanned: 0, upserts: 0 };
  }

  const missingSourceEntityIds = await countSourceRowsWithoutEntityId(db, migration.source);
  if (missingSourceEntityIds > 0) {
    throw new Error(
      `${migration.source} has ${missingSourceEntityIds} rows missing researchEntityId/researchGroupId`,
    );
  }

  const danglingSourceEntityReferences = await countDanglingSourceEntityReferences(
    db,
    migration.source,
  );
  if (danglingSourceEntityReferences > 0) {
    throw new Error(
      `${migration.source} has ${danglingSourceEntityReferences} dangling ResearchEntity references`,
    );
  }

  const source = db.collection(migration.source);
  const target = db.collection(migration.target);
  const cursor = source.find({}).sort({ _id: 1 });
  let scanned = 0;
  let upserts = 0;

  for await (const raw of cursor) {
    scanned++;
    const doc = normalizeDocument(raw as Record<string, unknown>);
    if (apply) {
      const result = await target.updateOne(
        { _id: doc._id as any },
        { $set: doc },
        { upsert: true },
      );
      if (result.upsertedCount || result.modifiedCount || result.matchedCount) upserts++;
    }
  }

  if (apply) {
    await createIndexes(db, migration);
  }

  return { ...migration, sourceExists: true, scanned, upserts: apply ? upserts : 0 };
}

async function verifyCollection(db: MongoDb, migration: CollectionMigration) {
  const [
    sourceExists,
    targetExists,
    sourceCount,
    targetCount,
    missingTargetIds,
    extraTargetIds,
    missingEntityIds,
    danglingReferences,
  ] = await Promise.all([
    collectionExists(db, migration.source),
    collectionExists(db, migration.target),
    countCollection(db, migration.source),
    countCollection(db, migration.target),
    countMissingTargetIds(db, migration),
    countExtraTargetIds(db, migration),
    countMissingEntityIds(db, migration.target),
    countDanglingEntityReferences(db, migration.target),
  ]);

  const ok = sourceExists
    ? targetExists &&
      sourceCount === targetCount &&
      missingTargetIds === 0 &&
      extraTargetIds === 0 &&
      missingEntityIds === 0 &&
      danglingReferences === 0
    : targetExists && targetCount > 0 && missingEntityIds === 0 && danglingReferences === 0;

  return {
    ...migration,
    ok,
    sourceExists,
    targetExists,
    sourceCount,
    targetCount,
    missingTargetIds,
    extraTargetIds,
    missingEntityIds,
    danglingReferences,
  };
}

async function verify(db: MongoDb) {
  const collections = await Promise.all(
    COLLECTION_MIGRATIONS.map((migration) => verifyCollection(db, migration)),
  );
  return {
    ok: collections.every((collection) => collection.ok),
    collections,
  };
}

async function dropLegacyCollections(db: MongoDb) {
  const before = await verify(db);
  if (!before.ok) {
    throw new Error(`Refusing to drop legacy collections: ${JSON.stringify(before)}`);
  }

  const dropped = [];
  for (const migration of COLLECTION_MIGRATIONS) {
    const sourceExists = await collectionExists(db, migration.source);
    if (!sourceExists) {
      dropped.push({ ...migration, dropped: false, reason: 'source-absent' });
      continue;
    }
    const result = await db.collection(migration.source).drop();
    dropped.push({ ...migration, dropped: result });
  }

  const after = await verify(db);
  if (!after.ok) {
    throw new Error(`Post-drop verification failed: ${JSON.stringify(after)}`);
  }

  return { before, dropped, after };
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = parseMode(argv);
  assertModeAllowed(mode, argv);
  assertScriptApplyAllowed({
    apply: mode === 'apply',
    scriptName: 'research-entity:cleanup-collections',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  let copy;
  let drop;
  if (mode === 'dry-run' || mode === 'apply') {
    copy = await Promise.all(
      COLLECTION_MIGRATIONS.map((migration) =>
        copyCollection(db, migration, mode === 'apply'),
      ),
    );
  } else if (mode === 'drop-legacy') {
    drop = await dropLegacyCollections(db);
  }

  const verification = mode === 'drop-legacy' ? drop?.after : await verify(db);
  if (mode === 'apply' && !verification?.ok) {
    throw new Error(
      `Dependent ResearchEntity collection migration failed: ${JSON.stringify(verification)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        migrations: COLLECTION_MIGRATIONS,
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
    console.error('Failed to migrate dependent ResearchEntity collections:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
