/**
 * Research-model refactor Phase 0 inventory (read-only).
 *
 * Produces the collection census, retirement-field prevalence, and
 * reference-integrity picture that Phase 0 of `docs/research-model-refactor.md`
 * requires before any target collection is written or any legacy storage is
 * dropped. Writes nothing to the database.
 *
 * Usage:
 *   yarn --cwd server model-refactor:inventory
 *   yarn --cwd server model-refactor:inventory --output /tmp/inventory.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import { initializeConnections } from '../db/connections';
import { resolveScraperEnvironment, summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  INVENTORY_COLLECTIONS,
  REFERENCE_EDGES,
  RETIREMENT_FIELD_PROBES,
  buildResearchModelInventoryOutput,
  buildResearchModelInventoryReport,
  parseResearchModelInventoryArgs,
  type CollectionCensusFact,
  type FieldPresenceFact,
  type InventoryFacts,
  type ReferenceIntegrityFact,
  type ResearchModelInventoryArgs,
  type SchemaVersionBucket,
} from './researchModelInventoryCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function listLiveCollections(db: Db): Promise<string[]> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return collections.map((entry) => entry.name).sort();
}

async function censusCollection(
  db: Db,
  collection: string,
  present: boolean,
): Promise<CollectionCensusFact> {
  if (!present) {
    return { collection, present: false, documentCount: 0, schemaVersions: [] };
  }
  const coll = db.collection(collection);
  const documentCount = await coll.countDocuments({});
  const grouped = await coll
    .aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: '$schemaVersion', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  const schemaVersions: SchemaVersionBucket[] = grouped.map((row) => ({
    version: row._id === null || row._id === undefined ? 'unset' : String(row._id),
    count: row.count,
  }));
  return { collection, present: true, documentCount, schemaVersions };
}

async function probeFieldPresence(
  db: Db,
  collection: string,
  field: string,
  present: boolean,
): Promise<FieldPresenceFact> {
  if (!present) {
    return { collection, field, present: 0, total: 0 };
  }
  const coll = db.collection(collection);
  const [total, withField] = await Promise.all([
    coll.countDocuments({}),
    coll.countDocuments({ [field]: { $exists: true } }),
  ]);
  return { collection, field, present: withField, total };
}

/**
 * Type-agnostic orphan check: build the set of target ids as strings, then scan
 * the referencing collection. This stays correct whether references are stored
 * as ObjectId or string, unlike a `$lookup` keyed on `_id`.
 */
async function checkReferenceEdge(
  db: Db,
  edge: (typeof REFERENCE_EDGES)[number],
  presentCollections: Set<string>,
  sampleLimit: number,
): Promise<ReferenceIntegrityFact> {
  const base: ReferenceIntegrityFact = {
    name: edge.name,
    fromCollection: edge.fromCollection,
    toCollection: edge.toCollection,
    checked: 0,
    orphaned: 0,
    sampleOrphanIds: [],
  };
  if (!presentCollections.has(edge.fromCollection) || !presentCollections.has(edge.toCollection)) {
    return base;
  }

  const targetIds = new Set<string>();
  const targetCursor = db
    .collection(edge.toCollection)
    .find({}, { projection: { _id: 1 } });
  for await (const doc of targetCursor) {
    targetIds.add(String(doc._id));
  }

  let checked = 0;
  let orphaned = 0;
  const sampleOrphanIds: string[] = [];
  const fromCursor = db
    .collection(edge.fromCollection)
    .find({ [edge.localField]: { $ne: null } }, { projection: { [edge.localField]: 1 } });
  for await (const doc of fromCursor) {
    const ref = (doc as Record<string, unknown>)[edge.localField];
    if (ref === null || ref === undefined) continue;
    checked += 1;
    if (!targetIds.has(String(ref))) {
      orphaned += 1;
      if (sampleOrphanIds.length < sampleLimit) {
        sampleOrphanIds.push(String(doc._id));
      }
    }
  }

  return { ...base, checked, orphaned, sampleOrphanIds };
}

async function gatherInventoryFacts(
  db: Db,
  args: ResearchModelInventoryArgs,
): Promise<InventoryFacts> {
  const liveCollections = await listLiveCollections(db);
  const liveSet = new Set(liveCollections);

  const census = await Promise.all(
    INVENTORY_COLLECTIONS.map((spec) =>
      censusCollection(db, spec.collection, liveSet.has(spec.collection)),
    ),
  );

  const fieldPresence = await Promise.all(
    RETIREMENT_FIELD_PROBES.map((probe) =>
      probeFieldPresence(db, probe.collection, probe.field, liveSet.has(probe.collection)),
    ),
  );

  const referenceIntegrity: ReferenceIntegrityFact[] = [];
  for (const edge of REFERENCE_EDGES) {
    referenceIntegrity.push(await checkReferenceEdge(db, edge, liveSet, args.sampleLimit));
  }

  return { liveCollections, census, fieldPresence, referenceIntegrity };
}

export function writeResearchModelInventoryOutput(
  output: object,
  target: string | undefined,
): void {
  if (!target) return;
  const safeOutput = resolveSafeJsonReportOutputPath(target);
  fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseResearchModelInventoryArgs(process.argv.slice(2));
  // Validate the output path before touching the database so a bad flag fails fast.
  if (args.output) {
    resolveSafeJsonReportOutputPath(args.output);
  }

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not available');
  }

  const facts = await gatherInventoryFacts(db, args);
  const report = buildResearchModelInventoryReport(facts);
  const output = buildResearchModelInventoryOutput(report, {
    environment: resolveScraperEnvironment(process.env),
    db: db.databaseName || mongoose.connection.name || summarizeMongoUrl(process.env.MONGODBURL),
    options: args,
  });

  console.log(JSON.stringify(output, null, 2));
  writeResearchModelInventoryOutput(output, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
