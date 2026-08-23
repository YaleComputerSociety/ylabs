/**
 * Read-only canonical reference-integrity audit (#210 Phase 6, #727).
 *
 * Counts dangling and missing-required ObjectId references on the canonical
 * relationship edges declared in `CANONICAL_REFERENCE_EDGES` (RoleAssignment,
 * Signal, ResearchEntityRelationship, and the canonical-collection outgoing
 * refs). It never writes anything.
 *
 * Usage:
 *   yarn --cwd server model-refactor:reference-integrity --environment development \
 *     --include-samples --output /tmp/ylabs-canonical-reference-integrity-dev.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertOperatorEnvironmentMatchesDatabase } from './operatorDatabaseEnvironment';
import {
  buildArrayRefOrphanSamplePipeline,
  buildMissingRequiredRefSamplePipeline,
  buildScalarRefOrphanSamplePipeline,
  type ReferenceAuditInput,
  type ReferenceAuditSample,
} from './betaDataQualityCore';
import {
  buildCanonicalReferenceIntegrityReport,
  CANONICAL_REFERENCE_EDGES,
  parseCanonicalReferenceIntegrityArgs,
  type CanonicalReferenceEdge,
} from './canonicalReferenceIntegrityAuditCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function stringifyId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

async function countFromAggregate(
  collection: Collection<Document>,
  pipeline: Document[],
): Promise<number> {
  const rows = await collection
    .aggregate<{ count?: number }>([...pipeline, { $count: 'count' }])
    .toArray();
  return rows[0]?.count ?? 0;
}

async function countScalarRefOrphans(
  collection: Collection<Document>,
  localField: string,
  targetCollectionName: string,
  ownerFilter: Record<string, unknown>,
): Promise<number> {
  return countFromAggregate(collection, [
    { $match: { ...ownerFilter, [localField]: { $exists: true, $nin: [null, ''] } } },
    {
      $lookup: {
        from: targetCollectionName,
        localField,
        foreignField: '_id',
        as: '_refTarget',
      },
    },
    { $match: { _refTarget: { $size: 0 } } },
  ]);
}

async function countArrayRefOrphans(
  collection: Collection<Document>,
  localField: string,
  targetCollectionName: string,
  ownerFilter: Record<string, unknown>,
): Promise<number> {
  const pipeline: Document[] = [
    { $project: { ref: { $ifNull: [`$${localField}`, []] } } },
    { $unwind: '$ref' },
    { $match: { ref: { $ne: null } } },
    {
      $lookup: {
        from: targetCollectionName,
        localField: 'ref',
        foreignField: '_id',
        as: '_refTarget',
      },
    },
    { $match: { _refTarget: { $size: 0 } } },
  ];
  return countFromAggregate(
    collection,
    Object.keys(ownerFilter).length > 0 ? [{ $match: ownerFilter }, ...pipeline] : pipeline,
  );
}

async function collectSamples(
  collection: Collection<Document>,
  edge: CanonicalReferenceEdge,
  sampleLimit: number,
  ownerFilter: Record<string, unknown>,
): Promise<ReferenceAuditSample[]> {
  if (sampleLimit <= 0) return [];
  const samples: ReferenceAuditSample[] = [];

  if (edge.required) {
    const missingRows = await collection
      .aggregate<{ id?: unknown; value?: unknown }>(
        buildMissingRequiredRefSamplePipeline(edge.localField, sampleLimit, ownerFilter),
      )
      .toArray();
    for (const row of missingRows) {
      samples.push({
        collection: edge.collectionName,
        field: edge.localField,
        id: stringifyId(row.id),
        failureType: 'missing_required',
        value: stringifyId(row.value),
      });
    }
  }

  const remaining = sampleLimit - samples.length;
  if (remaining <= 0) return samples;

  const orphanPipeline = edge.isArray
    ? buildArrayRefOrphanSamplePipeline(
        edge.localField,
        edge.targetCollectionName,
        remaining,
        ownerFilter,
      )
    : buildScalarRefOrphanSamplePipeline(
        edge.localField,
        edge.targetCollectionName,
        remaining,
        ownerFilter,
      );
  const orphanRows = await collection
    .aggregate<{ id?: unknown; value?: unknown }>(orphanPipeline)
    .toArray();
  for (const row of orphanRows) {
    samples.push({
      collection: edge.collectionName,
      field: edge.localField,
      id: stringifyId(row.id),
      failureType: 'orphaned_present_ref',
      value: stringifyId(row.value),
    });
  }

  return samples;
}

async function auditEdge(
  db: Db,
  edge: CanonicalReferenceEdge,
  sampleLimit: number,
  includeSamples: boolean,
): Promise<ReferenceAuditInput> {
  const collection = db.collection(edge.collectionName);
  const ownerFilter = { ...(edge.ownerFilter ?? {}) };

  const missingRequired = edge.required
    ? await collection.countDocuments({
        ...ownerFilter,
        $or: [{ [edge.localField]: { $exists: false } }, { [edge.localField]: null }],
      })
    : 0;
  const orphanedPresentRefs = edge.isArray
    ? await countArrayRefOrphans(collection, edge.localField, edge.targetCollectionName, ownerFilter)
    : await countScalarRefOrphans(
        collection,
        edge.localField,
        edge.targetCollectionName,
        ownerFilter,
      );

  return {
    name: edge.name,
    required: edge.required,
    missingRequired,
    orphanedPresentRefs,
    ...(includeSamples
      ? { samples: await collectSamples(collection, edge, sampleLimit, ownerFilter) }
      : {}),
  };
}

async function main(): Promise<void> {
  const args = parseCanonicalReferenceIntegrityArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  if (args.output) resolveSafeJsonReportOutputPath(args.output);

  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db();
    assertOperatorEnvironmentMatchesDatabase(args.environment, db.databaseName);

    const inputs: ReferenceAuditInput[] = [];
    for (const edge of CANONICAL_REFERENCE_EDGES) {
      inputs.push(await auditEdge(db, edge, args.sampleLimit, args.includeSamples));
    }

    const report = buildCanonicalReferenceIntegrityReport({
      environment: args.environment,
      databaseName: db.databaseName,
      inputs,
    });

    console.log(JSON.stringify({ ...report, target: summarizeMongoUrl(mongoUrl) }, null, 2));
    if (args.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(args.output);
      fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await client.close();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
