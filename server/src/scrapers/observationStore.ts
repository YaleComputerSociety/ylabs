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
import type { ResearchEntityType } from '../models/researchAccessTypes';
import { serializedDocumentId } from '../utils/idSerialization';
import { isUncitableHostUrl } from '../utils/urlSafety';
import {
  isRefusedObservationField,
  kindOnlyTypeAssertionKeys,
  sanitizeObservationField,
} from './observationFieldSanitizer';
import {
  fullDescriptionQuality,
  isFullDescriptionRestatementOfShortDescription,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { offTopicResearchHomeDemotionScore } from '../utils/researchHomeDescriptionSelection';
import { isCareerBiographyDescription } from '../utils/careerBiographyDescription';
import { containsHtmlTagMarkup } from '../utils/descriptionHygiene';
import type { ObservationInput } from './types';
import {
  DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS,
  OWNERSHIP_GUARDED_DESCRIPTION_FIELDS,
  OWNERSHIP_GUARDED_ENTITY_TYPE,
  ownershipGuardedCitedUrls,
  refusesDescriptionOnSharedPage,
} from './descriptionSourceOwnership';
import { normalizeEvidenceUrl } from './utils/sharedEvidenceUrls';

export const QUALITY_GUARDED_PROSE_FIELDS = new Set(['fullDescription', 'shortDescription']);

// When set, the log is kept lossless at write time: the regressive-prose drop and the
// value-less latest-wins supersession are skipped, and the materializer reads the full
// retained log and decides late (collapseLatestWins + the resolver's ranked prose
// preference). Off by default so behavior is byte-identical to today.
export function c4LosslessIngestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.C4_LOSSLESS_INGEST === 'true';
}

// Absence of the flag is not the same as knowing it is off: a destructive step that runs
// in its own process (observation retention) would otherwise read its own blank
// environment as proof that the target environment's materializer excludes superseded
// rows. Callers that need cross-process certainty require an explicit declaration.
export function c4LosslessIngestDeclared(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.C4_LOSSLESS_INGEST ?? '').trim() !== '';
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function entityKeyForProse(obs: { entityId?: string; entityKey?: string }): string {
  return obs.entityId || obs.entityKey || '';
}

/**
 * `entityType` here is the PRODUCT entity type, and the ingest path cannot supply
 * one: an observation carries its subject type under the same name, and the two
 * vocabularies are disjoint. Typed rather than `unknown` so handing over the
 * subject value is a compile error instead of a predicate that quietly answers
 * "not a lab" for every row (#210).
 */
interface ProseQualityContext {
  fullContext?: string;
  researchAreas?: unknown;
  entityType?: ResearchEntityType;
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
 * self-defeating rather than merely low quality: it adds nothing the detail page
 * does not already show, and it displaces whatever card the entity holds with a
 * duplicate of its own body. The materializer answers the same pair by keeping
 * the body and re-deriving the card (#2721), so declining to persist the scraped
 * card here leaves that re-derivation working from the richer field rather than
 * from an echo of it. `isRegressiveProseRefresh` cannot catch this because it
 * only fires when there is an existing useful value to protect, and the first
 * write of a pair has none. Dropping the card is the safe half to lose: it is
 * derivable from the full, and the full is not derivable from it.
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

const MATERIALLY_THINNER_PROSE_CHARS = 200;

const normalizedProseLength = (value: unknown): number =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().length : 0;

/**
 * DELIBERATELY KEEPS AN OLDER VALUE. Not a bug; do not "restore" newest-wins.
 *
 * `isWeakerProseRefresh` above only drops a refresh that is off-topic, and its
 * contract is that ties pass so the corpus cannot freeze on its first capture.
 * That leaves one case uncovered: the same extractor re-reads the same page and
 * returns far LESS of it. Both values are on-topic, so they tie, newest wins, and
 * the body text is gone - `collapseLatestWins` keeps one row per
 * (source, field), so the richer value never reaches the resolver at all and no
 * downstream ranking can recover it.
 *
 * Measured on Development: 22 served rows had a same-source value a median 444
 * chars richer than the one being served, all from
 * `lab-microsite-description-llm` (#2423).
 *
 * Owner decision, 2026-09-05: prefer the richer value, accepting that a lab which
 * genuinely shortened its page will keep serving the longer earlier copy. This
 * NARROWS the "ties pass" contract rather than removing it - a refresh within
 * 200 chars of the incumbent still wins on recency, so an ordinary re-scrape and
 * a genuine rewrite both behave as before, and only a materially thinner capture
 * is held off.
 *
 * The retained value must itself be servable, because "richer but worse" is the
 * real failure mode. `scoreResearchHomeDescriptionCandidate` cannot be used here
 * for the reason given on `prosePreferenceScore` above - the observation does not
 * carry the product kind, so its person-centric term would charge legitimate
 * person-voiced faculty research prose -100 - so this uses the kind-free
 * `offTopicResearchHomeDemotionScore` plus the biography and markup rejections.
 */
export function isMateriallyThinnerProseRefresh(input: {
  field: string;
  incomingValue: unknown;
  existingValue: unknown;
  incomingContext?: ProseQualityContext;
  existingContext?: ProseQualityContext;
}): boolean {
  if (!QUALITY_GUARDED_PROSE_FIELDS.has(input.field)) return false;
  if (typeof input.existingValue !== 'string' || !input.existingValue.trim()) return false;
  if (typeof input.incomingValue !== 'string' || !input.incomingValue.trim()) return false;
  if (
    normalizedProseLength(input.incomingValue) + MATERIALLY_THINNER_PROSE_CHARS >
    normalizedProseLength(input.existingValue)
  ) {
    return false;
  }
  if (!proseValueIsUseful(input.field, input.existingValue, input.existingContext)) return false;
  if (offTopicResearchHomeDemotionScore(input.existingValue) !== 0) return false;
  if (isCareerBiographyDescription(input.existingValue)) return false;
  if (containsHtmlTagMarkup(input.existingValue)) return false;
  return true;
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

/**
 * Fields an out-of-enum value is dropped for at ingest. Exported for the same
 * reason as `INGEST_REJECTABLE_RESEARCH_ENTITY_FIELDS`: a dropped value looks
 * from the log exactly like a value the source stopped asserting.
 */
export const ENUM_VALIDATED_OBSERVATION_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(ENUM_FIELD_VALIDATORS),
);

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

/**
 * For each cited URL in the batch that the ownership bar could apply to, the set of
 * entity keys that already hold a live description observation citing it.
 *
 * Keys rather than a count, so the caller can exclude the row being written without a
 * second read: re-asserting a page this row already cites must never look like a
 * foreign citer.
 */
async function loadForeignDescriptionCiters(
  inputs: readonly ObservationInput[],
): Promise<Map<string, Set<string>>> {
  const urls = ownershipGuardedCitedUrls(inputs);
  const byUrl = new Map<string, Set<string>>();
  if (urls.length === 0) return byUrl;

  // Filtered by HOST and normalized in JS, never matched on the normalized string.
  // `normalizeEvidenceUrl` drops a query string, a trailing slash and a `www.`, so a
  // stored `.../directory-name/` never equals its own normalized form and an `$in` on
  // normalized values reads zero citers for a page twenty rows cite.
  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      continue;
    }
  }
  if (hosts.size === 0) return byUrl;
  const wanted = new Set(urls);
  const rows = await Observation.find(
    {
      entityType: OWNERSHIP_GUARDED_ENTITY_TYPE,
      field: { $in: [...OWNERSHIP_GUARDED_DESCRIPTION_FIELDS] },
      superseded: { $ne: true },
      $or: [...hosts].map((host) => ({
        sourceUrl: { $regex: `^https?://(www\\.)?${escapeRegExp(host)}(/|$|\\?)`, $options: 'i' },
      })),
    },
    { sourceUrl: 1, entityKey: 1, entityId: 1 },
  ).lean();
  for (const row of rows as any[]) {
    const url = normalizeEvidenceUrl(row.sourceUrl);
    if (!wanted.has(url)) continue;
    const key = entityKeyForProse(row);
    if (!key) continue;
    const existing = byUrl.get(url) ?? new Set<string>();
    existing.add(key);
    byUrl.set(url, existing);
  }
  return byUrl;
}

export async function appendObservations(
  inputs: ObservationInput[],
  ctx: AppendContext,
  opts: { loadActiveProse?: ActiveProseLoader } = {},
): Promise<{ inserted: number; skipped: number; superseded: number }> {
  if (inputs.length === 0) return { inserted: 0, skipped: 0, superseded: 0 };
  const loadActiveProse = opts.loadActiveProse ?? loadActiveProseValue;

  // A deploy-target host names a build rather than a page, so an observation cited to
  // one records evidence at an address that stops existing on the next deploy. It is
  // refused here, the one path every scraper lane writes through, rather than in the
  // extractor that produced it: #2804 stopped the School of Art lane trusting a
  // cross-domain `<link rel="canonical">`, and 100 citations to that build host were
  // already stored by the time it landed (#2805).
  // This does NOT cover a writer that reaches `Observation` directly. Any new one must
  // repeat `isUncitableHostUrl`, as `visibilityRepairQueueService` does; the two
  // operator scripts that insert observations (`promoteFacultyResearchToLab`,
  // `labBrandedNameTypeBackfill`) still carry a stored `websiteUrl` through unchecked.
  const candidateInputs: ObservationInput[] = [];
  let rejectedUncitableHost = 0;
  for (const obs of inputs) {
    if (isUncitableHostUrl(obs.sourceUrl)) rejectedUncitableHost += 1;
    else candidateInputs.push(obs);
  }
  // A page several rows already cite as their description cannot be the description
  // of this one either. The judgement sits here for the same reason the uncitable-host
  // refusal above does: it was written into one extractor (#3162) and the lanes it did
  // not reach kept storing unowned descriptions afterwards (#3481).
  //
  // One aggregation per batch, over the distinct cited URLs the bar could apply to, so
  // widening the guard costs a single read rather than one per observation.
  const foreignCitersByUrl = await loadForeignDescriptionCiters(candidateInputs);
  const ownershipRejected: ObservationInput[] = [];
  const ownedInputs: ObservationInput[] = [];
  for (const obs of candidateInputs) {
    const url = normalizeEvidenceUrl(obs.sourceUrl);
    const citers = foreignCitersByUrl.get(url);
    const foreign = citers ? [...citers].filter((key) => key !== entityKeyForProse(obs)).length : 0;
    if (refusesDescriptionOnSharedPage(obs, foreign)) ownershipRejected.push(obs);
    else ownedInputs.push(obs);
  }
  if (ownershipRejected.length > 0) {
    console.warn(
      `[observation-store] ${ctx.sourceName} asserted ${ownershipRejected.length} description(s) citing a page at least ${DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS} other entities already cite; refused at ingest (#3481).`,
    );
  }

  const sanitizedInputs: ObservationInput[] = [];
  let rejectedFurniture = 0;
  for (const obs of ownedInputs) {
    const sanitized = sanitizeObservationField(obs.entityType, obs.field, obs.value);
    if (sanitized.rejected) {
      rejectedFurniture += 1;
      continue;
    }
    sanitizedInputs.push(sanitized.value === obs.value ? obs : { ...obs, value: sanitized.value });
  }
  // Refused before the enum check because the field is retired outright, not merely
  // carrying a bad value: nothing reads it, so storing it would recreate the residue
  // #3362 measured rather than reject one assertion (#3362).
  const rejectedRetiredField = sanitizedInputs.filter((obs) =>
    isRefusedObservationField(obs.entityType, obs.field),
  );
  const liveFieldInputs = sanitizedInputs.filter(
    (obs) => !isRefusedObservationField(obs.entityType, obs.field),
  );
  if (rejectedRetiredField.length > 0) {
    console.warn(
      `[observation-store] ${ctx.sourceName} asserted ${rejectedRetiredField.length} observation(s) on a retired field; nothing reads them, so they are refused at ingest (#3362).`,
    );
  }
  const rejectedInvalidEnum = liveFieldInputs.filter((obs) =>
    isObservationValueRejected(obs.field, obs.value),
  );
  const acceptedInputs = liveFieldInputs.filter(
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
      // Judged with the same researchAreas as the incoming value: an asymmetric
      // verdict would let an incumbent the quality bar rejects still block a
      // refresh.
      const existingContext: ProseQualityContext = {
        researchAreas: incomingResearchAreas,
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

  // Reported, never subtracted from the batch: a `kind` assertion is not invalid, it is
  // unread, so the lane that wrote it needs to know rather than the batch being shrunk.
  const kindOnlyKeys = kindOnlyTypeAssertionKeys(candidateInputs);
  if (kindOnlyKeys.length > 0) {
    console.warn(
      `[observation-store] ${ctx.sourceName} asserted kind without entityType for ${kindOnlyKeys.length} key(s); the materializer never reads an observed kind, so those assertions set nothing (#3362).`,
    );
  }

  const skippedCount =
    rejectedRetiredField.length +
    rejectedUncitableHost +
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
      // Deliberately outside the fingerprint: an absence assertion is a fact about
      // the run, not part of the value's identity, so adding one must not make an
      // otherwise-unchanged observation supersede its predecessor.
      ...(obs.assertsNoValueFor && obs.assertsNoValueFor.length > 0
        ? { assertsNoValueFor: [...new Set(obs.assertsNoValueFor)] }
        : {}),
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
  'applicationInformation',
  'applicationMaterials',
  'researchFocused',
  'sourceContentHash',
  'inferredDirectorName',
  'inferredDirectorUserName',
  'inferredDirectorTitle',
  'inferredDirectorRole',
  'inferredDirectorProfileUrl',
  'leadVerification',
  'courseCreditRoute',
  // A roster-health snapshot is a source-owned statement about one department at
  // one moment, and the roster lane collapses its several configs to one row per
  // department, so it satisfies the one-row-per-(entity, field)-per-run rule above.
  // With `value` in the fingerprint a department whose roster was byte-identical to
  // the stored one wrote nothing, so a page read minutes ago kept an `observedAt`
  // from the previous run: measured on Development, 7 of 113 departments carried a
  // live snapshot up to 11 days older than the run that had just re-read them, and
  // 176 live snapshots spanned 113 departments because a changed roster took a new
  // fingerprint instead of superseding its predecessor (#3251).
  'departmentRosterHealth',
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
/**
 * Latest-wins list fields whose items ACCUMULATE, so a same-source group is unioned
 * rather than collapsed to its freshest row (#3221).
 *
 * The rule is the one the repo already settled for retraction: omission is not
 * absence (#2647). A fresher grant read that lists one award is not a statement that
 * the awards it does not mention never happened, so taking the freshest list drops
 * them. Measured on Development, 4 live rows store more awards than the next pass
 * would write and 14 items were one re-materialize away from being deleted.
 *
 * `researchAreas` and `methods` are deliberately NOT here even though they are
 * latest-wins lists. Those describe a home's CURRENT research, so a fresher read that
 * drops a topic is usually a correction, and unioning them would hoard every topic a
 * source ever guessed. An accumulating field is one whose items are dated events, not
 * a description of the present.
 */
const ADDITIVE_LATEST_WINS_LIST_FIELDS = new Set(['recentGrants']);

/**
 * Identity for unioning an accumulating list. A grant carries its own award id, which
 * is the only stable handle: the same award arrives with a different dollar amount or
 * end date as it is amended, and keying on the whole object would keep both copies.
 */
function additiveListItemKey(item: unknown): string {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) return `id:${id.trim().toLowerCase()}`;
  }
  if (typeof item === 'string') return `s:${item.trim().toLowerCase()}`;
  return `j:${JSON.stringify(item)}`;
}

/**
 * The union of every list in a same-source group, freshest row's items first so an
 * amended copy of an award wins over the older one carrying the same id.
 */
export function unionAdditiveListValues(
  values: readonly unknown[],
  orderedNewestFirst: readonly number[],
): unknown[] {
  const seen = new Map<string, unknown>();
  for (const index of orderedNewestFirst) {
    const value = values[index];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const itemKey = additiveListItemKey(item);
      if (!seen.has(itemKey)) seen.set(itemKey, item);
    }
  }
  return [...seen.values()];
}

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
      //
      // The chain has to match the write path's chain, not a subset of it.
      // `isWeakerProseRefresh` requires BOTH values to clear the quality bar, so
      // it is blind to a newer value that fails the bar outright, and
      // `isMateriallyThinnerProseRefresh` only sees a value at least 200 chars
      // shorter. A longer newer value that fails the bar - a recruitment notice
      // displacing grounded research prose - fell through both and won on
      // recency, which is the half of #2232 that never fired (#2302).
      const refreshComparison = {
        field: candidate.field,
        incomingValue: candidate.value,
        existingValue: incumbent.value,
        incomingContext: {},
        existingContext: {},
      };
      if (
        isRegressiveProseRefresh(refreshComparison) ||
        isWeakerProseRefresh(refreshComparison) ||
        isMateriallyThinnerProseRefresh(refreshComparison)
      ) {
        continue;
      }
      winningIndex = index;
    }
    winningIndexByKey.set(key, winningIndex);
  }

  return observations
    .filter((observation, index) => {
      if (!usesLatestWinsFingerprint({ entityType, field: observation.field })) return true;
      const key = JSON.stringify([observation.sourceName, observation.field]);
      return winningIndexByKey.get(key) === index;
    })
    .map((observation, _position, kept) => {
      void kept;
      if (!ADDITIVE_LATEST_WINS_LIST_FIELDS.has(observation.field)) return observation;
      const key = JSON.stringify([observation.sourceName, observation.field]);
      const group = indicesByKey.get(key);
      if (!group || group.length < 2) return observation;
      const newestFirst = [...group].sort(
        (left, right) =>
          latestWinsObservedTime(observations[right].observedAt) -
            latestWinsObservedTime(observations[left].observedAt) || left - right,
      );
      const union = unionAdditiveListValues(
        observations.map((entry) => entry.value),
        newestFirst,
      );
      return { ...observation, value: union };
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
  enabled?: boolean;
  coverage?: { tier?: string };
} | null> {
  const src = await Source.findOne({ name }).lean();
  if (!src) return null;
  return {
    _id: serializedDocumentId(src._id) || '',
    name: (src as any).name,
    defaultWeight: (src as any).defaultWeight,
    enabled: (src as any).enabled,
    coverage: (src as any).coverage,
  };
}
