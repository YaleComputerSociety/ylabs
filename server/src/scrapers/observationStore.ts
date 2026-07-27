/**
 * Append-only writer for Observations.
 *
 * Scrapers call append() with batches of ObservationInput. The store fills in source/run
 * metadata, applies the source's default weight when no override is given, and inserts.
 * Never updates existing rows (appends only — supersession is handled by the resolver).
 */
import { Observation } from '../models/observation';
import { Source } from '../models/source';
import { serializedDocumentId } from '../utils/idSerialization';
import type { ObservationInput } from './types';

interface AppendContext {
  scrapeRunId: string;
  sourceId: string;
  sourceName: string;
  sourceWeight: number;
  dryRun: boolean;
}

export async function appendObservations(
  inputs: ObservationInput[],
  ctx: AppendContext,
): Promise<{ inserted: number; skipped: number; superseded: number }> {
  if (inputs.length === 0) return { inserted: 0, skipped: 0, superseded: 0 };

  const docs = inputs.map((obs) => ({
    entityType: obs.entityType,
    entityId: obs.entityId || undefined,
    entityKey: obs.entityKey || undefined,
    field: obs.field,
    value: obs.value,
    sourceId: ctx.sourceId,
    sourceName: ctx.sourceName,
    scrapeRunId: ctx.scrapeRunId,
    sourceUrl: obs.sourceUrl,
    observedAt: obs.observedAt || new Date(),
    confidence: obs.confidenceOverride ?? ctx.sourceWeight,
    superseded: false,
    observationFingerprint: buildObservationFingerprint({
      sourceName: ctx.sourceName,
      entityType: obs.entityType,
      entityId: obs.entityId,
      entityKey: obs.entityKey,
      field: obs.field,
      value: obs.value,
    }),
  }));

  if (ctx.dryRun) {
    return { inserted: 0, skipped: docs.length, superseded: 0 };
  }

  const result = await Observation.insertMany(docs, { ordered: false });
  const latestByFingerprint = new Map<string, any>();
  for (const doc of result as any[]) {
    if (!doc.observationFingerprint) continue;
    latestByFingerprint.set(doc.observationFingerprint, doc._id);
  }

  const supersedeOps = Array.from(latestByFingerprint.entries()).map(([fingerprint, latestId]) => ({
    updateMany: {
      filter: {
        observationFingerprint: fingerprint,
        superseded: false,
        _id: { $ne: latestId },
      },
      update: {
        $set: {
          superseded: true,
          supersededBy: latestId,
        },
      },
    },
  }));

  const superseded =
    supersedeOps.length > 0
      ? (await Observation.bulkWrite(supersedeOps, { ordered: false })).modifiedCount || 0
      : 0;

  return { inserted: result.length, skipped: 0, superseded };
}

/**
 * Fields where a source emits exactly ONE current value per (entity, field) per run.
 * Their fingerprint omits `value`, so a new observation supersedes the prior one even when
 * the text drifts run-to-run (e.g. LLM extractors paraphrase the same description each run).
 *
 * Including `value` for these caused unbounded accumulation of non-superseded observations:
 * every paraphrase produced a distinct fingerprint that never superseded its predecessor, so
 * the resolver saw hundreds of competing active values per field and flagged spurious
 * materialization conflicts (which in turn tripped sourceHealthWarnings → data-quality block).
 *
 * SAFETY: only add a field here if NO source emits it as multiple rows per (entity, field) in a
 * single run. A value-less fingerprint makes same-run rows share a fingerprint and supersede each
 * other, which would silently drop data for genuinely multi-row fields.
 */
export const LATEST_WINS_FINGERPRINT_FIELDS = new Set<string>([
  'fullDescription',
  'shortDescription',
  'researchAreas',
  'methods',
  'rosterEnrichment',
]);

export function buildObservationFingerprint(input: {
  sourceName: string;
  entityType: string;
  entityId?: unknown;
  entityKey?: string;
  field: string;
  value: unknown;
}): string | undefined {
  const entityId = stringifyIdentifier(input.entityId);
  const entityKey = stringifyIdentifier(input.entityKey);
  const entity = entityId ? `id:${entityId}` : entityKey ? `key:${entityKey}` : undefined;
  if (!entity) return undefined;

  const parts: unknown[] = [input.sourceName, input.entityType, entity, input.field];
  if (!LATEST_WINS_FINGERPRINT_FIELDS.has(input.field)) {
    parts.push(input.value);
  }
  return stableSerialize(parts);
}

function stringifyIdentifier(value: unknown): string | undefined {
  return serializedDocumentId(value);
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.trim().toLowerCase());
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).sort().join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export async function getSourceByName(name: string): Promise<{
  _id: string;
  name: string;
  defaultWeight: number;
} | null> {
  const src = await Source.findOne({ name }).lean();
  if (!src) return null;
  return {
    _id: serializedDocumentId(src._id) || '',
    name: (src as any).name,
    defaultWeight: (src as any).defaultWeight,
  };
}

export async function findObservations(
  entityType: string,
  entityIdentifier: { entityId?: string; entityKey?: string },
  field?: string,
): Promise<any[]> {
  const filter: any = {
    entityType,
    superseded: false,
  };
  if (entityIdentifier.entityId) filter.entityId = entityIdentifier.entityId;
  if (entityIdentifier.entityKey) filter.entityKey = entityIdentifier.entityKey;
  if (field) filter.field = field;

  return Observation.find(filter).sort({ observedAt: -1 }).lean();
}
