import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import {
  buildScholarlyLinkBackfillPlan,
  findAmbiguousExternalIdentityUserIds,
  parseBackfillScholarlyLinksArgs,
  summarizeScholarlyLinkBackfill,
  type LegacyPaperBackfillRef,
} from './backfillScholarlyLinksCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type MongoDb = NonNullable<typeof mongoose.connection.db>;

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

async function findLegacyPapers(db: MongoDb, limit: number): Promise<Record<string, any>[]> {
  if (!(await collectionExists(db, 'papers'))) return [];
  return db
    .collection('papers')
    .find({ archived: { $ne: true } })
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();
}

function normalizeId(value: unknown): string {
  return String(value || '').trim();
}

async function findLegacyRefs(
  db: MongoDb,
  collectionName: 'paper_authors' | 'paper_entity_links',
  paperIds: unknown[],
): Promise<LegacyPaperBackfillRef[]> {
  if (paperIds.length === 0 || !(await collectionExists(db, collectionName))) return [];
  const targetField = collectionName === 'paper_authors' ? 'userId' : 'researchEntityId';
  const rows = await db
    .collection(collectionName)
    .find(
      {
        archived: { $ne: true },
        paperId: { $in: paperIds },
        [targetField]: { $exists: true, $ne: null },
      },
      { projection: { paperId: 1, [targetField]: 1 } },
    )
    .toArray();

  return rows.map((row) => ({
    paperId: row.paperId,
    [targetField]: row[targetField],
  }));
}

async function findAmbiguousUserIds(db: MongoDb): Promise<Set<string>> {
  if (!(await collectionExists(db, 'users'))) return new Set();
  const users = await db
    .collection('users')
    .find({}, { projection: { _id: 1, orcid: 1, openAlexId: 1 } })
    .toArray();
  return findAmbiguousExternalIdentityUserIds(users as any[]);
}

async function findExistingCompactLinks(db: MongoDb): Promise<Record<string, any>[]> {
  if (!(await collectionExists(db, 'research_scholarly_links'))) return [];
  return db
    .collection('research_scholarly_links')
    .find(
      {
        archived: { $ne: true },
        $or: [
          { userId: { $exists: true, $ne: null } },
          { researchEntityId: { $exists: true, $ne: null } },
        ],
      },
      { projection: { _id: 1, userId: 1, researchEntityId: 1, url: 1 } },
    )
    .toArray();
}

async function main() {
  const options = parseBackfillScholarlyLinksArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'scholarly-links:backfill',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized.');

  const papers = await findLegacyPapers(db, options.limit);
  const paperIds = papers.map((paper) => paper._id).filter((id) => id !== undefined && id !== null);
  const paperIdLookupValues = Array.from(
    new Set(paperIds.flatMap((id) => [id, normalizeId(id)]).filter(Boolean)),
  );
  const [paperAuthors, paperEntityLinks, ambiguousUserIds, existingLinks] = await Promise.all([
    findLegacyRefs(db, 'paper_authors', paperIdLookupValues),
    findLegacyRefs(db, 'paper_entity_links', paperIdLookupValues),
    findAmbiguousUserIds(db),
    findExistingCompactLinks(db),
  ]);

  const { ops, summary } = buildScholarlyLinkBackfillPlan({
    options,
    papers,
    paperAuthors,
    paperEntityLinks,
    ambiguousUserIds,
    existingLinks,
  });

  if (options.apply && ops.length > 0) {
    await ResearchScholarlyLink.bulkWrite(ops, { ordered: false });
  }

  console.log(
    JSON.stringify(
      {
        ...summarizeScholarlyLinkBackfill({
          ...summary,
          apply: options.apply,
          scope: options.scope,
          totalEligible: papers.length,
        }),
        scannedLegacyPaperIds: papers.slice(0, 10).map((paper) => normalizeId(paper._id)),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to backfill scholarly links:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
