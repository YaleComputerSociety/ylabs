/**
 * One reference-edge auditor shared by the Beta launch scorecard and the
 * canonical reference-integrity audit (#2294).
 *
 * The two audits used to carry near-identical orphan counters plus a hand-passed
 * `isArray` flag, and the flag drifted: the scorecard declared
 * `signals.source.evidenceIds` scalar, so a `$lookup` on the schema-default
 * empty array returned nothing and every signal with no evidence at all was
 * counted as a broken reference. Counting per unwound reference is correct for a
 * scalar field too (`$unwind` treats a non-array value as a single element), so
 * there is no flag left to get wrong.
 */
import type { Collection, Db, Document } from 'mongodb';
import {
  buildMissingRequiredRefSamplePipeline,
  buildRefOrphanMatchPipeline,
  buildRefOrphanSamplePipeline,
  type ReferenceAuditInput,
  type ReferenceAuditSample,
} from './betaDataQualityCore';

export interface ReferenceEdge {
  name: string;
  collectionName: string;
  localField: string;
  targetCollectionName: string;
  required: boolean;
  ownerFilter?: Readonly<Record<string, unknown>>;
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

export async function countReferenceOrphans(
  collection: Collection<Document>,
  localField: string,
  targetCollectionName: string,
  ownerFilter: Record<string, unknown> = {},
): Promise<number> {
  return countFromAggregate(
    collection,
    buildRefOrphanMatchPipeline(localField, targetCollectionName, ownerFilter),
  );
}

function stringifyId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

async function collectReferenceEdgeSamples(
  collection: Collection<Document>,
  edge: ReferenceEdge,
  sampleLimit: number,
): Promise<ReferenceAuditSample[]> {
  if (sampleLimit <= 0) return [];
  const ownerFilter = { ...(edge.ownerFilter ?? {}) };
  const samples: ReferenceAuditSample[] = [];

  if (edge.required) {
    const missingRows = await collection
      .aggregate<{
        id?: unknown;
        value?: unknown;
      }>(buildMissingRequiredRefSamplePipeline(edge.localField, sampleLimit, ownerFilter))
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

  const orphanRows = await collection
    .aggregate<{
      id?: unknown;
      value?: unknown;
    }>(buildRefOrphanSamplePipeline(edge.localField, edge.targetCollectionName, remaining, ownerFilter))
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

export async function auditReferenceEdge(
  db: Db,
  edge: ReferenceEdge,
  options: { includeSamples?: boolean; sampleLimit?: number } = {},
): Promise<ReferenceAuditInput> {
  const collection = db.collection(edge.collectionName);
  const ownerFilter = { ...(edge.ownerFilter ?? {}) };
  const sampleLimit = options.sampleLimit ?? 10;

  const missingRequired = edge.required
    ? await collection.countDocuments({
        ...ownerFilter,
        $or: [{ [edge.localField]: { $exists: false } }, { [edge.localField]: null }],
      })
    : 0;

  const orphanedPresentRefs = await countReferenceOrphans(
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
    ...(options.includeSamples
      ? { samples: await collectReferenceEdgeSamples(collection, edge, sampleLimit) }
      : {}),
  };
}
