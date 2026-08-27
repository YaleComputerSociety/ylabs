/**
 * Append-only writer for Observations.
 *
 * Scrapers call append() with batches of ObservationInput. The store fills in source/run
 * metadata, applies the source's default weight when no override is given, and inserts.
 * Never updates existing rows (appends only — supersession is handled by the resolver).
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import type { ObservedEntityType } from '../models/observation';
import { Source } from '../models/source';
import { researchGroupKinds, researchEntityTypes } from '../models/researchAccessTypes';
import { serializedDocumentId } from '../utils/idSerialization';
import { isSelfReferentialUrl } from '../utils/urlSafety';
import { sanitizeObservationField } from './observationFieldSanitizer';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import type { ObservationInput } from './types';

const QUALITY_GUARDED_PROSE_FIELDS = new Set(['fullDescription', 'shortDescription']);

// When set, the log is kept lossless at write time: the regressive-prose drop and the
// value-less latest-wins supersession are skipped, and the materializer reads the full
// retained log and decides late (collapseLatestWins + the resolver's ranked prose
// preference). Off by default so behavior is byte-identical to today.
export function c4LosslessIngestEnabled(): boolean {
  return process.env.C4_LOSSLESS_INGEST === 'true';
}

function entityKeyForProse(obs: { entityId?: string; entityKey?: string }): string {
  return obs.entityId || obs.entityKey || '';
}

interface ProseQualityContext {
  fullContext?: string;
  researchAreas?: unknown;
  entityType?: unknown;
}

function proseValueIsUseful(
  field: string,
  value: unknown,
  context: ProseQualityContext = {},
): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  return field === 'shortDescription'
    ? shortDescriptionQuality(value, context.fullContext ?? '', context.researchAreas, {
        entityType: context.entityType,
      }).isUseful
    : fullDescriptionQuality(value, context.researchAreas, context.entityType).isUseful;
}

export function isRegressiveProseRefresh(input: {
  field: string;
  incomingValue: unknown;
  existingValue: unknown;
  incomingContext?: ProseQualityContext;
  existingContext?: ProseQualityContext;
}): boolean {
  if (!QUALITY_GUARDED_PROSE_FIELDS.has(input.field)) return false;
  if (typeof input.existingValue !== 'string') return false;
  if (!proseValueIsUseful(input.field, input.existingValue, input.existingContext)) {
    return false;
  }
  return !proseValueIsUseful(input.field, input.incomingValue, input.incomingContext);
}

export type ActiveProseLoader = (query: {
  entityType: ObservedEntityType;
  sourceName: string;
  entityId?: string;
  entityKey?: string;
  field: string;
}) => Promise<string | undefined>;

const loadActiveProseValue: ActiveProseLoader = async (query) => {
  // Fail open when no DB connection is available (e.g. unit tests that mock
  // insertMany): the guard must never hang or block a write, only prevent a
  // proven regression.
  if (mongoose.connection.readyState !== 1) return undefined;
  if (!query.entityId && !query.entityKey) return undefined;
  const filter: Record<string, unknown> = {
    entityType: query.entityType,
    sourceName: query.sourceName,
    field: query.field,
    superseded: false,
  };
  if (query.entityId) filter.entityId = query.entityId;
  else filter.entityKey = query.entityKey;
  const row = await Observation.findOne(filter).select('value').lean();
  const value = (row as { value?: unknown } | null)?.value;
  return typeof value === 'string' ? value : undefined;
};

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
  opts: { loadActiveProse?: ActiveProseLoader } = {},
): Promise<{ inserted: number; skipped: number; superseded: number }> {
  if (inputs.length === 0) return { inserted: 0, skipped: 0, superseded: 0 };
  const loadActiveProse = opts.loadActiveProse ?? loadActiveProseValue;

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
  const incomingFullByEntity = new Map<string, string>();
  const incomingResearchAreasByEntity = new Map<string, unknown>();
  for (const obs of acceptedInputs) {
    if (obs.field === 'fullDescription' && typeof obs.value === 'string') {
      incomingFullByEntity.set(entityKeyForProse(obs), obs.value);
    }
    if (obs.field === 'researchAreas') {
      incomingResearchAreasByEntity.set(entityKeyForProse(obs), obs.value);
    }
  }

  const losslessIngest = c4LosslessIngestEnabled();
  const keptInputs: ObservationInput[] = [];
  let regressiveProseGuarded = 0;
  for (const obs of acceptedInputs) {
    if (!losslessIngest && QUALITY_GUARDED_PROSE_FIELDS.has(obs.field)) {
      const entityKey = entityKeyForProse(obs);
      const incomingResearchAreas = incomingResearchAreasByEntity.get(entityKey);
      const incomingContext: ProseQualityContext = {
        researchAreas: incomingResearchAreas,
        entityType: obs.entityType,
      };
      if (obs.field === 'shortDescription') {
        incomingContext.fullContext = incomingFullByEntity.get(entityKey);
      }
      if (!proseValueIsUseful(obs.field, obs.value, incomingContext)) {
        const existingValue = await loadActiveProse({
          entityType: obs.entityType,
          sourceName: ctx.sourceName,
          entityId: obs.entityId || undefined,
          entityKey: obs.entityKey || undefined,
          field: obs.field,
        });
        const existingContext: ProseQualityContext = {};
        if (obs.field === 'shortDescription') {
          const existingFullContext = await loadActiveProse({
            entityType: obs.entityType,
            sourceName: ctx.sourceName,
            entityId: obs.entityId || undefined,
            entityKey: obs.entityKey || undefined,
            field: 'fullDescription',
          });
          existingContext.fullContext = existingFullContext;
          if (!incomingContext.fullContext) {
            incomingContext.fullContext = existingFullContext;
          }
        }
        if (
          isRegressiveProseRefresh({
            field: obs.field,
            incomingValue: obs.value,
            existingValue,
            incomingContext,
            existingContext,
          })
        ) {
          regressiveProseGuarded += 1;
          continue;
        }
      }
    }
    keptInputs.push(obs);
  }

  const skippedCount =
    rejectedSelfReferential.length +
    rejectedFurniture +
    rejectedInvalidEnum.length +
    regressiveProseGuarded;
  if (keptInputs.length === 0) {
    return { inserted: 0, skipped: skippedCount, superseded: 0 };
  }

  const docs = keptInputs.map((obs) => {
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

  const supersedeOps = Array.from(latestByFingerprint.entries())
    .filter(([, { input }]) => !(losslessIngest && usesLatestWinsFingerprint(input)))
    .map(([fingerprint, { id: latestId, input }]) => ({
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
    }));

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

export function usesLatestWinsFingerprint(input: { entityType: string; field: string }): boolean {
  return input.entityType === 'fellowship' || LATEST_WINS_FINGERPRINT_FIELDS.has(input.field);
}

function latestWinsObservedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// Read-time equivalent of the value-less latest-wins fingerprint: for a latest-wins field,
// keep only the newest observation per (sourceName, field); every other field keeps all rows.
// On an active-only read this is a no-op (write-time supersession already left one active row
// per key), so it is safe to land before a full-log read replaces that supersession.
export function collapseLatestWins<
  T extends { field: string; sourceName: string; observedAt?: unknown },
>(observations: T[], entityType: string): T[] {
  const newestIndexByKey = new Map<string, number>();
  observations.forEach((observation, index) => {
    if (!usesLatestWinsFingerprint({ entityType, field: observation.field })) return;
    const key = JSON.stringify([observation.sourceName, observation.field]);
    const currentIndex = newestIndexByKey.get(key);
    if (
      currentIndex === undefined ||
      latestWinsObservedTime(observation.observedAt) >
        latestWinsObservedTime(observations[currentIndex].observedAt)
    ) {
      newestIndexByKey.set(key, index);
    }
  });
  return observations.filter((observation, index) => {
    if (!usesLatestWinsFingerprint({ entityType, field: observation.field })) return true;
    const key = JSON.stringify([observation.sourceName, observation.field]);
    return newestIndexByKey.get(key) === index;
  });
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
