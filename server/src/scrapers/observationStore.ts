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
  isFullDescriptionRestatementOfShortDescription,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { offTopicResearchHomeDemotionScore } from '../utils/researchHomeDescriptionSelection';
import type { ObservationInput } from './types';

export const QUALITY_GUARDED_PROSE_FIELDS = new Set(['fullDescription', 'shortDescription']);

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

export function proseValueIsUseful(
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

/**
 * A shortDescription that restates the fullDescription it arrives with is
 * self-defeating rather than merely low quality: the materializer answers the
 * pair by clearing the fullDescription, so persisting the card destroys the
 * richer field and leaves a detail page with no prose behind a card that still
 * looks healthy to the visibility gate. `isRegressiveProseRefresh` cannot catch
 * this because it only fires when there is an existing useful value to protect,
 * and the first write of a pair has none. Dropping the card is the safe half to
 * lose: it is derivable from the full, and the full is not derivable from it.
 */
export function selfDefeatingCardRestatesFullDescription(
  field: string,
  value: unknown,
  context: ProseQualityContext = {},
): boolean {
  if (field !== 'shortDescription') return false;
  if (typeof value !== 'string' || !value.trim()) return false;
  const full = typeof context.fullContext === 'string' ? context.fullContext : '';
  if (!full.trim()) return false;
  return isFullDescriptionRestatementOfShortDescription(full, value);
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

/**
 * How strongly a prose value reads as a statement of what this home researches.
 * Deliberately NOT the subtractive `isUseful` verdict, which cannot rank two
 * flag-free candidates against each other: every known regression in this class
 * passes `fullDescriptionQuality` with zero flags (#2232).
 *
 * `researchSubjectSpecificityScore` is not used here despite being the obvious
 * positive candidate: measured against these values it saturates at 8.00 for a
 * mission statement, a recruitment notice, a figure caption and real research
 * prose alike, because it was built to grade a short extracted SUBJECT phrase,
 * not a paragraph. Its term list also counts "hiring" and "aluminum" as
 * subject-bearing, so term count is a length proxy. The demotion scorer is the
 * only signal that separates these values today: mission -20, recruitment -30,
 * research 0.
 *
 * Only the off-topic demotions are summed. An observation carries an
 * `ObservedEntityType` (`researchEntity`, `user`), never the product entityType
 * or kind that says whether this home is a lab or a faculty research area, so
 * the person-centric term in `scoreResearchHomeDescriptionCandidate` cannot be
 * resolved here without defaulting every home to `organization` and charging
 * legitimate person-voiced faculty research prose -100, which ranks it below a
 * mission statement and inverts this comparison (#2232). The resolver still
 * applies the kind-aware score downstream, where the product kind is known.
 */
export function prosePreferenceScore(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return Number.NEGATIVE_INFINITY;
  return offTopicResearchHomeDemotionScore(value);
}

/**
 * An incoming prose value that is useful, and so invisible to
 * `isRegressiveProseRefresh`, but reads as a WORSE statement of the home's
 * research than the clean incumbent it would displace. Without this the winner
 * is decided by the confidence gap alone - 0.82 for a non-`/profile/` capture
 * against 0.55 for official-profile extraction - so a mission statement
 * displaced grounded research prose and served silently from May to August
 * (#2232).
 *
 * Ties pass. A refresh must be demonstrably worse to be dropped, never merely
 * not-better, so ordinary same-quality re-scrapes keep their existing
 * newest-wins behaviour and the corpus cannot freeze on its first capture.
 */
export function isWeakerProseRefresh(input: {
  field: string;
  incomingValue: unknown;
  existingValue: unknown;
  incomingContext?: ProseQualityContext;
  existingContext?: ProseQualityContext;
}): boolean {
  if (!QUALITY_GUARDED_PROSE_FIELDS.has(input.field)) return false;
  if (typeof input.existingValue !== 'string' || !input.existingValue.trim()) return false;
  if (!proseValueIsUseful(input.field, input.existingValue, input.existingContext)) return false;
  if (!proseValueIsUseful(input.field, input.incomingValue, input.incomingContext)) return false;
  return prosePreferenceScore(input.incomingValue) < prosePreferenceScore(input.existingValue);
}

export type ActiveProseLoader = (query: {
  entityType: ObservedEntityType;
  sourceName: string;
  entityId?: string;
  entityKey?: string;
  field: string;
}) => Promise<string | undefined>;

// Historical rows carry only `entityKey` while a run that has resolved the entity emits
// `entityId` too, so matching on whichever single form the caller happens to hold misses
// the other form's rows for the same entity. Match either form so the regression guard and
// supersession both see the entity's full active history (#2177).
export function observationEntityIdentityFilter(query: {
  entityId?: unknown;
  entityKey?: unknown;
}): Record<string, unknown> | undefined {
  const alternatives: Record<string, unknown>[] = [];
  if (query.entityKey) alternatives.push({ entityKey: query.entityKey });
  if (query.entityId) alternatives.push({ entityId: query.entityId });
  if (alternatives.length === 0) return undefined;
  return alternatives.length === 1 ? alternatives[0] : { $or: alternatives };
}

const loadActiveProseValue: ActiveProseLoader = async (query) => {
  // Fail open when no DB connection is available (e.g. unit tests that mock
  // insertMany): the guard must never hang or block a write, only prevent a
  // proven regression.
  if (mongoose.connection.readyState !== 1) return undefined;
  const identity = observationEntityIdentityFilter(query);
  if (!identity) return undefined;
  const filter: Record<string, unknown> = {
    entityType: query.entityType,
    sourceName: query.sourceName,
    field: query.field,
    superseded: false,
    ...identity,
  };
  const row = await Observation.findOne(filter).sort({ observedAt: -1 }).select('value').lean();
  const value = (row as { value?: unknown } | null)?.value;
  return typeof value === 'string' ? value : undefined;
};

type ProseIncumbentSubject = Pick<ObservationInput, 'entityType' | 'entityId' | 'entityKey'>;

// Keyed on the exact identity tuple the observation carries rather than a
// canonical entity id, because `observationEntityIdentityFilter` widens a lookup
// to whichever forms are present: a row holding only `entityKey` and a row
// holding both can legitimately resolve to different incumbents (#2177).
function proseIncumbentKey(subject: ProseIncumbentSubject, field: string): string {
  return JSON.stringify([
    subject.entityType,
    subject.entityId || '',
    subject.entityKey || '',
    field,
  ]);
}

async function loadProseIncumbents(
  inputs: ObservationInput[],
  sourceName: string,
  loadActiveProse: ActiveProseLoader,
): Promise<Map<string, string | undefined>> {
  const queries = new Map<string, { subject: ProseIncumbentSubject; field: string }>();
  const requireIncumbent = (subject: ProseIncumbentSubject, field: string) => {
    queries.set(proseIncumbentKey(subject, field), { subject, field });
  };
  for (const obs of inputs) {
    if (!QUALITY_GUARDED_PROSE_FIELDS.has(obs.field)) continue;
    requireIncumbent(obs, obs.field);
    if (obs.field === 'shortDescription') requireIncumbent(obs, 'fullDescription');
  }
  const loaded = new Map<string, string | undefined>();
  await Promise.all(
    [...queries].map(async ([key, { subject, field }]) => {
      loaded.set(
        key,
        await loadActiveProse({
          entityType: subject.entityType,
          sourceName,
          entityId: subject.entityId || undefined,
          entityKey: subject.entityKey || undefined,
          field,
        }),
      );
    }),
  );
  return loaded;
}

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
  // The incumbent must be loaded even when the incoming value IS useful: the
  // useful-but-worse case (#2232) is invisible from the incoming value alone,
  // and gating the load on `!proseValueIsUseful` made that guard unreachable on
  // exactly the path that caused the damage. Every lookup the loop can need is
  // therefore resolved once, up front and concurrently, so widening the guard
  // costs one round of parallel reads per batch rather than two serial reads per
  // prose observation.
  const proseIncumbents = losslessIngest
    ? new Map<string, string | undefined>()
    : await loadProseIncumbents(acceptedInputs, ctx.sourceName, loadActiveProse);

  const keptInputs: ObservationInput[] = [];
  let regressiveProseGuarded = 0;
  let selfDefeatingCardGuarded = 0;
  let weakerProseGuarded = 0;
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
      const incomingFailsQualityBarOnBatchContext = !proseValueIsUseful(
        obs.field,
        obs.value,
        incomingContext,
      );
      const existingValue = proseIncumbents.get(proseIncumbentKey(obs, obs.field));
      // Judged with the same entityType and researchAreas as the incoming value:
      // an asymmetric verdict would let an incumbent the quality bar rejects
      // still block a refresh.
      const existingContext: ProseQualityContext = {
        researchAreas: incomingResearchAreas,
        entityType: obs.entityType,
      };
      if (obs.field === 'shortDescription') {
        const existingFullContext = proseIncumbents.get(proseIncumbentKey(obs, 'fullDescription'));
        existingContext.fullContext = existingFullContext;
        if (!incomingContext.fullContext) {
          incomingContext.fullContext = existingFullContext;
        }
      }
      if (
        incomingFailsQualityBarOnBatchContext &&
        selfDefeatingCardRestatesFullDescription(obs.field, obs.value, incomingContext)
      ) {
        selfDefeatingCardGuarded += 1;
        continue;
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
      if (
        isWeakerProseRefresh({
          field: obs.field,
          incomingValue: obs.value,
          existingValue,
          incomingContext,
          existingContext,
        })
      ) {
        weakerProseGuarded += 1;
        continue;
      }
    }
    keptInputs.push(obs);
  }

  const skippedCount =
    rejectedSelfReferential.length +
    rejectedFurniture +
    rejectedInvalidEnum.length +
    regressiveProseGuarded +
    weakerProseGuarded +
    selfDefeatingCardGuarded;
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
                ...observationEntityIdentityFilter(input),
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
  T extends { field: string; sourceName: string; observedAt?: unknown; value?: unknown },
>(observations: T[], entityType: string): T[] {
  const indicesByKey = new Map<string, number[]>();
  observations.forEach((observation, index) => {
    if (!usesLatestWinsFingerprint({ entityType, field: observation.field })) return;
    const key = JSON.stringify([observation.sourceName, observation.field]);
    const group = indicesByKey.get(key);
    if (group) group.push(index);
    else indicesByKey.set(key, [index]);
  });

  const winningIndexByKey = new Map<string, number>();
  for (const [key, indices] of indicesByKey) {
    // Callers read the log with no sort (`Observation.find(filter).lean()`), and
    // the covering index is descending on `observedAt`, so folding in array order
    // would make the prose comparison below depend on the query plan: an
    // incumbent seen newest-first short-circuits every older row before it can be
    // compared, silently disabling the guard (#2232).
    const oldestFirst = [...indices].sort(
      (left, right) =>
        latestWinsObservedTime(observations[left].observedAt) -
          latestWinsObservedTime(observations[right].observedAt) || left - right,
    );
    let winningIndex = oldestFirst[0];
    for (const index of oldestFirst.slice(1)) {
      const candidate = observations[index];
      const incumbent = observations[winningIndex];
      if (
        latestWinsObservedTime(candidate.observedAt) <= latestWinsObservedTime(incumbent.observedAt)
      ) {
        continue;
      }
      // Under C4_LOSSLESS_INGEST the write-time guard is skipped and this collapse
      // plus the resolver decide, so a pure newest-wins here would reinstate the
      // exact regression the write path now blocks. Keep the incumbent when the
      // newer row is a strictly worse statement of the home's research (#2232).
      if (
        isWeakerProseRefresh({
          field: candidate.field,
          incomingValue: candidate.value,
          existingValue: incumbent.value,
          incomingContext: { entityType },
          existingContext: { entityType },
        })
      ) {
        continue;
      }
      winningIndex = index;
    }
    winningIndexByKey.set(key, winningIndex);
  }

  return observations.filter((observation, index) => {
    if (!usesLatestWinsFingerprint({ entityType, field: observation.field })) return true;
    const key = JSON.stringify([observation.sourceName, observation.field]);
    return winningIndexByKey.get(key) === index;
  });
}

// `entityKey` is canonical rather than `entityId` because a scraper always knows the
// slug it is emitting against while `entityId` is only present once the entity exists,
// so the same (source, entity, field) alternated between `key:` and `id:` fingerprints
// run to run. That split left both rows active and defeated supersession and
// `isRegressiveProseRefresh` (#2177). Preferring the key form also makes the identity
// resolvable without a slug lookup. Changing this order requires re-running
// `observations:normalize-fingerprints`, or historical rows stop matching new ones.
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
  const entity = entityKey ? `key:${entityKey}` : entityId ? `id:${entityId}` : undefined;
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
