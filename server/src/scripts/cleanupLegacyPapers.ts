import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import {
  findAmbiguousExternalIdentityUserIds,
} from './backfillScholarlyLinksCore';
import {
  buildLegacyPaperCleanupReadiness,
  LegacyPaperCleanupState,
  parseCleanupLegacyPapersArgs,
} from './cleanupLegacyPapersCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type MongoDb = NonNullable<typeof mongoose.connection.db>;
type LegacyPaperCollectionName = 'papers' | 'paper_authors' | 'paper_entity_links';

const LEGACY_PAPER_COLLECTIONS: LegacyPaperCollectionName[] = [
  'papers',
  'paper_authors',
  'paper_entity_links',
];

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

async function countCollection(db: MongoDb, name: string): Promise<number> {
  return (await collectionExists(db, name)) ? db.collection(name).countDocuments() : 0;
}

async function countDocuments(
  db: MongoDb,
  name: string,
  filter: Record<string, unknown>,
): Promise<number> {
  return (await collectionExists(db, name)) ? db.collection(name).countDocuments(filter) : 0;
}

function normalizeId(value: unknown): string {
  return String(value || '').trim();
}

function addIds(target: Set<string>, values: unknown[]): void {
  for (const value of values) {
    const normalized = normalizeId(value);
    if (normalized) target.add(normalized);
  }
}

async function distinctIds(
  db: MongoDb,
  collectionName: string,
  fieldName: string,
  filter: Record<string, unknown>,
): Promise<string[]> {
  if (!(await collectionExists(db, collectionName))) return [];
  const values = await db.collection(collectionName).distinct(fieldName, filter);
  return values.map(normalizeId).filter(Boolean);
}

function missingCount(legacyIds: Set<string>, compactIds: Set<string>): number {
  let missing = 0;
  for (const id of legacyIds) {
    if (!compactIds.has(id)) missing++;
  }
  return missing;
}

async function collectLegacyUserAnchors(db: MongoDb): Promise<Set<string>> {
  const ids = new Set<string>();
  addIds(
    ids,
    await distinctIds(db, 'paper_authors', 'userId', {
      userId: { $exists: true, $ne: null },
    }),
  );
  addIds(
    ids,
    await distinctIds(db, 'papers', 'yaleAuthorIds', {
      archived: { $ne: true },
      yaleAuthorIds: { $exists: true, $ne: [] },
    }),
  );
  return ids;
}

async function collectLegacyResearchEntityAnchors(db: MongoDb): Promise<Set<string>> {
  const ids = new Set<string>();
  addIds(
    ids,
    await distinctIds(db, 'paper_entity_links', 'researchEntityId', {
      archived: { $ne: true },
      researchEntityId: { $exists: true, $ne: null },
    }),
  );
  addIds(
    ids,
    await distinctIds(db, 'papers', 'researchEntityIds', {
      archived: { $ne: true },
      researchEntityIds: { $exists: true, $ne: [] },
    }),
  );
  return ids;
}

async function collectCompactUserAnchors(db: MongoDb): Promise<Set<string>> {
  return new Set(
    await distinctIds(db, 'research_scholarly_links', 'userId', {
      archived: { $ne: true },
      userId: { $exists: true, $ne: null },
    }),
  );
}

async function collectCompactResearchEntityAnchors(db: MongoDb): Promise<Set<string>> {
  return new Set(
    await distinctIds(db, 'research_scholarly_links', 'researchEntityId', {
      archived: { $ne: true },
      researchEntityId: { $exists: true, $ne: null },
    }),
  );
}

async function collectAmbiguousExternalIdentityUserIds(db: MongoDb): Promise<Set<string>> {
  if (!(await collectionExists(db, 'users'))) return new Set();
  const users = await db
    .collection('users')
    .find(
      {},
      { projection: { _id: 1, orcid: 1, openAlexId: 1 } },
    )
    .toArray();
  return findAmbiguousExternalIdentityUserIds(users as any[]);
}

export async function collectLegacyPaperCleanupState(
  db: MongoDb,
): Promise<LegacyPaperCleanupState> {
  const [
    papersCount,
    paperAuthorsCount,
    paperEntityLinksCount,
    scholarlyLinkTotal,
    scholarlyLinkUserCount,
    scholarlyLinkEntityCount,
    legacyUserIds,
    compactUserIds,
    legacyResearchEntityIds,
    compactResearchEntityIds,
    ambiguousUserIds,
  ] = await Promise.all([
    countCollection(db, 'papers'),
    countCollection(db, 'paper_authors'),
    countCollection(db, 'paper_entity_links'),
    countCollection(db, 'research_scholarly_links'),
    countDocuments(db, 'research_scholarly_links', {
      archived: { $ne: true },
      userId: { $exists: true, $ne: null },
    }),
    countDocuments(db, 'research_scholarly_links', {
      archived: { $ne: true },
      researchEntityId: { $exists: true, $ne: null },
    }),
    collectLegacyUserAnchors(db),
    collectCompactUserAnchors(db),
    collectLegacyResearchEntityAnchors(db),
    collectCompactResearchEntityAnchors(db),
    collectAmbiguousExternalIdentityUserIds(db),
  ]);

  const nonAmbiguousLegacyUserIds = new Set(
    [...legacyUserIds].filter((id) => !ambiguousUserIds.has(id)),
  );

  return {
    legacyCollections: {
      papers: { exists: await collectionExists(db, 'papers'), count: papersCount },
      paper_authors: { exists: await collectionExists(db, 'paper_authors'), count: paperAuthorsCount },
      paper_entity_links: {
        exists: await collectionExists(db, 'paper_entity_links'),
        count: paperEntityLinksCount,
      },
    },
    scholarlyLinks: {
      total: scholarlyLinkTotal,
      userLinked: scholarlyLinkUserCount,
      entityLinked: scholarlyLinkEntityCount,
    },
    legacyAnchors: {
      usersWithLegacyPaperEvidence: legacyUserIds.size,
      ambiguousUsersSkipped: legacyUserIds.size - nonAmbiguousLegacyUserIds.size,
      usersMissingScholarlyLinks: missingCount(nonAmbiguousLegacyUserIds, compactUserIds),
      researchEntitiesWithLegacyPaperEvidence: legacyResearchEntityIds.size,
      researchEntitiesMissingScholarlyLinks: missingCount(
        legacyResearchEntityIds,
        compactResearchEntityIds,
      ),
    },
  };
}

async function dropLegacyPaperCollections(db: MongoDb) {
  const dropped: Array<{ name: LegacyPaperCollectionName; dropped: boolean; reason?: string }> = [];

  for (const name of LEGACY_PAPER_COLLECTIONS) {
    if (!(await collectionExists(db, name))) {
      dropped.push({ name, dropped: false, reason: 'absent' });
      continue;
    }
    dropped.push({ name, dropped: await db.collection(name).drop() });
  }

  return dropped;
}

function assertApplyAllowed(args: ReturnType<typeof parseCleanupLegacyPapersArgs>): void {
  if (!args.apply) return;
  if (!args.confirmDropLegacyPapers) {
    throw new Error(
      'Legacy paper cleanup requires --confirm-drop-legacy-papers with --apply.',
    );
  }
  if (process.env.SCRAPER_ENV === 'production' && process.env.CONFIRM_PROD_SCRAPE !== 'true') {
    throw new Error(
      'Production legacy paper cleanup requires CONFIRM_PROD_SCRAPE=true in the environment.',
    );
  }
}

async function main() {
  const args = parseCleanupLegacyPapersArgs(process.argv.slice(2));
  assertApplyAllowed(args);

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const before = await collectLegacyPaperCleanupState(db);
  const beforeReadiness = buildLegacyPaperCleanupReadiness(before);

  if (args.apply && !beforeReadiness.ready) {
    throw new Error(`Refusing legacy paper cleanup: ${beforeReadiness.blockers.join(' ')}`);
  }

  const dropped = args.apply ? await dropLegacyPaperCollections(db) : undefined;
  const after = args.apply ? await collectLegacyPaperCleanupState(db) : undefined;
  const afterReadiness = after ? buildLegacyPaperCleanupReadiness(after) : undefined;

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: args.apply ? 'apply' : 'dry-run',
        before,
        beforeReadiness,
        dropped,
        after,
        afterReadiness,
        nextStep: beforeReadiness.ready
          ? 'If this is the intended database and backups are captured, rerun with --apply --confirm-drop-legacy-papers.'
          : 'Compact scholarly links are incomplete; repair research_scholarly_links directly before dropping legacy paper collections.',
      },
      null,
      2,
    ),
  );
}

const executedPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : '';
if (executedPath === fileURLToPath(import.meta.url)) {
  main()
    .catch((error) => {
      console.error('Failed to clean up legacy papers:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
