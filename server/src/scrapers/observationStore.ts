/**
 * Append-only writer for Observations.
 *
 * Scrapers call append() with batches of ObservationInput. The store fills in source/run
 * metadata, applies the source's default weight when no override is given, and inserts.
 * Never updates existing rows (appends only — supersession is handled by the resolver).
 */
import { Observation } from '../models/observation';
import { Source } from '../models/source';
import { researchGroupKinds, researchEntityTypes } from '../models/researchAccessTypes';
import { serializedDocumentId } from '../utils/idSerialization';
import { isSelfReferentialUrl } from '../utils/urlSafety';
import { sanitizeObservationField } from './observationFieldSanitizer';
import type { ObservationInput } from './types';

const ENUM_FIELD_VALIDATORS: Record<string, ReadonlySet<string>> = {
  kind: new Set(researchGroupKinds),
  entityType: new Set(researchEntityTypes),
};

function normalizeObservationValue(field: string, value: unknown): unknown {
  if (field === 'sourceUrls') {
    if (Array.isArray(value)) return value;
    return typeof value === 'string' && value.trim() ? [value] : [];
  }
  return value;
}

function isObservationValueRejected(field: string, value: unknown): boolean {
  const allowed = ENUM_FIELD_VALIDATORS[field];
  return !!allowed && (typeof value !== 'string' || !allowed.has(value));
}

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

  const rejectedSelfReferential = inputs.filter((obs) => isSelfReferentialUrl(obs.sourceUrl));
  const candidateInputs = inputs.filter((obs) => !isSelfReferentialUrl(obs.sourceUrl));
  const sanitizedInputs: ObservationInput[] = [];
  let rejectedFurniture = 0;
  for (const obs of candidateInputs) {
    const sanitized = sanitizeObservationField(obs.entityType, obs.field, obs.value);
    if (sanitized.rejected) {
      rejectedFurniture += 1;
      continue;
    }
    sanitizedInputs.push(sanitized.value === obs.value ? obs : { ...obs, value: sanitized.value });
  }
  const rejectedInvalidEnum = sanitizedInputs.filter((obs) =>
    isObservationValueRejected(obs.field, obs.value),
  );
  const acceptedInputs = sanitizedInputs.filter(
    (obs) => !isObservationValueRejected(obs.field, obs.value),
  );
  const skippedCount =
    rejectedSelfReferential.length + rejectedFurniture + rejectedInvalidEnum.length;
  if (acceptedInputs.length === 0) {
    return { inserted: 0, skipped: skippedCount, superseded: 0 };
  }

  const docs = acceptedInputs.map((obs) => {
    const value = normalizeObservationValue(obs.field, obs.value);
    return {
      entityType: obs.entityType,
      entityId: obs.entityId || undefined,
      entityKey: obs.entityKey || undefined,
      field: obs.field,
      value,
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
        value,
      }),
    };
  });

  if (ctx.dryRun) {
    return { inserted: 0, skipped: docs.length + skippedCount, superseded: 0 };
  }

  const result = await Observation.insertMany(docs, { ordered: false });
  const latestByFingerprint = new Map<string, { id: any; input: (typeof docs)[number] }>();
  for (const [index, doc] of (result as any[]).entries()) {
    if (!doc.observationFingerprint) continue;
    latestByFingerprint.set(doc.observationFingerprint, { id: doc._id, input: docs[index] });
  }

  const supersedeOps = Array.from(latestByFingerprint.entries()).map(
    ([fingerprint, { id: latestId, input }]) => ({
      updateMany: {
        filter: {
          ...(usesLatestWinsFingerprint(input)
            ? {
                sourceName: input.sourceName,
                entityType: input.entityType,
                ...(input.entityId ? { entityId: input.entityId } : { entityKey: input.entityKey }),
                field: input.field,
              }
            : { observationFingerprint: fingerprint }),
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
    }),
  );

  const superseded =
    supersedeOps.length > 0
      ? (await Observation.bulkWrite(supersedeOps, { ordered: false })).modifiedCount || 0
      : 0;

  return { inserted: result.length, skipped: skippedCount, superseded };
}

export interface RetireObservationsResult {
  retired: number;
}

export async function retireObservations(
  filter: Record<string, unknown>,
  reason: string,
): Promise<RetireObservationsResult> {
  const result = await Observation.updateMany(
    { ...filter, superseded: { $ne: true } },
    { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason } } },
  );
  const modifiedCount = (result as { modifiedCount?: number }).modifiedCount;
  return { retired: typeof modifiedCount === 'number' ? modifiedCount : 0 };
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
 * Fellowship observations are also source-owned snapshots. The sole fellowship producer emits
 * exactly one value per (entity, field) per run, so all fellowship fields use latest-wins
 * fingerprints rather than retaining stale competing values after each catalog refresh.
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
  'recentGrants',
  'recentGrantCount',
  'fundingAgencies',
  'rosterEnrichment',
  'currentUndergradCount',
  'undergradEvidenceQuote',
  'undergraduateLogisticsStudentLevel',
  'undergraduateLogisticsCompensation',
  'undergraduateLogisticsTimeCommitment',
  'undergraduateLogisticsModality',
  'undergraduateLogisticsCurrentAvailability',
  'applicationInformation',
  'applicationMaterials',
  'researchFocused',
  'sourceContentHash',
]);

function usesLatestWinsFingerprint(input: { entityType: string; field: string }): boolean {
  return input.entityType === 'fellowship' || LATEST_WINS_FINGERPRINT_FIELDS.has(input.field);
}

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
  if (!usesLatestWinsFingerprint(input)) {
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
