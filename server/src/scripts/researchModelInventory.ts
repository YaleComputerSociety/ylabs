/**
 * Research-model refactor Phase 0 inventory (read-only).
 *
 * Produces the collection census, retirement-field prevalence, and
 * reference-integrity picture that Phase 0 of `docs/research-model-refactor.md`
 * requires before any target collection is written or any legacy storage is
 * dropped. Writes nothing to the database.
 *
 * Usage:
 *   yarn --cwd server model-refactor:inventory --environment beta
 *   yarn --cwd server model-refactor:inventory --environment beta --output /tmp/inventory.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, type Db } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
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

const COLLECTION_SCAN_CONCURRENCY = 4;

interface InventoryMongoClient {
  connect(): Promise<unknown>;
  db(): Db;
  close(): Promise<void>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

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
    .aggregate<{
      _id: unknown;
      count: number;
    }>([{ $group: { _id: '$schemaVersion', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
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
  total: number,
): Promise<FieldPresenceFact> {
  if (!present) {
    return { collection, field, present: 0, total: 0 };
  }
  const coll = db.collection(collection);
  const withField = await coll.countDocuments({ [field]: { $exists: true } });
  return { collection, field, present: withField, total };
}

/**
 * Type-agnostic orphan check: build the set of target ids as strings, then scan
 * the referencing collection. This stays correct whether references are stored
 * as ObjectId or string, unlike a `$lookup` keyed on `_id`.
 */
export async function checkReferenceEdge(
  db: Db,
  edge: (typeof REFERENCE_EDGES)[number],
  presentCollections: Set<string>,
  sampleLimit: number,
): Promise<ReferenceIntegrityFact> {
  const base: ReferenceIntegrityFact = {
    name: edge.name,
    fromCollection: edge.fromCollection,
    toCollection: edge.toCollection,
    status: 'checked',
    checked: 0,
    orphaned: 0,
    sampleOrphanIds: [],
  };
  if (!presentCollections.has(edge.fromCollection)) {
    return { ...base, status: 'source-missing' };
  }

  const targetIds = new Set<string>();
  const targetPresent = presentCollections.has(edge.toCollection);
  if (targetPresent) {
    const targetCursor = db.collection(edge.toCollection).find({}, { projection: { _id: 1 } });
    for await (const doc of targetCursor) {
      targetIds.add(String(doc._id));
    }
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

  return {
    ...base,
    status: targetPresent ? 'checked' : 'target-missing',
    checked,
    orphaned,
    sampleOrphanIds,
  };
}

export async function gatherInventoryFacts(
  db: Db,
  args: ResearchModelInventoryArgs,
): Promise<InventoryFacts> {
  const liveCollections = await listLiveCollections(db);
  const liveSet = new Set(liveCollections);

  const census = await mapWithConcurrency(
    INVENTORY_COLLECTIONS,
    COLLECTION_SCAN_CONCURRENCY,
    (spec) => censusCollection(db, spec.collection, liveSet.has(spec.collection)),
  );

  const censusByCollection = new Map(census.map((fact) => [fact.collection, fact]));
  const probesByCollection = new Map<string, typeof RETIREMENT_FIELD_PROBES>();
  for (const probe of RETIREMENT_FIELD_PROBES) {
    const probes = probesByCollection.get(probe.collection) ?? [];
    probes.push(probe);
    probesByCollection.set(probe.collection, probes);
  }

  const fieldPresenceGroups = await mapWithConcurrency(
    [...probesByCollection.entries()],
    COLLECTION_SCAN_CONCURRENCY,
    async ([collection, probes]) => {
      const collectionPresent = liveSet.has(collection);
      const censusFact = censusByCollection.get(collection);
      const total =
        censusFact?.documentCount ??
        (collectionPresent ? await db.collection(collection).countDocuments({}) : 0);
      const facts: FieldPresenceFact[] = [];
      for (const probe of probes) {
        facts.push(
          await probeFieldPresence(db, probe.collection, probe.field, collectionPresent, total),
        );
      }
      return facts;
    },
  );
  const fieldPresence = fieldPresenceGroups.flat();

  const referenceIntegrity: ReferenceIntegrityFact[] = [];
  for (const edge of REFERENCE_EDGES) {
    referenceIntegrity.push(await checkReferenceEdge(db, edge, liveSet, args.sampleLimit));
  }

  return { liveCollections, census, fieldPresence, referenceIntegrity };
}

export async function runResearchModelInventory(
  args: ResearchModelInventoryArgs,
  mongoUrl: string,
  client: InventoryMongoClient = new MongoClient(mongoUrl),
): Promise<ReturnType<typeof buildResearchModelInventoryOutput>> {
  try {
    await client.connect();
    const db = client.db();
    const facts = await gatherInventoryFacts(db, args);
    const report = buildResearchModelInventoryReport(facts);
    return buildResearchModelInventoryOutput(report, {
      environment: args.environment,
      db: db.databaseName,
      target: summarizeMongoUrl(mongoUrl),
      options: args,
    });
  } finally {
    await client.close();
  }
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

  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    throw new Error('MONGODBURL is required');
  }

  const output = await runResearchModelInventory(args, mongoUrl);
  console.log(JSON.stringify(output, null, 2));
  writeResearchModelInventoryOutput(output, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
