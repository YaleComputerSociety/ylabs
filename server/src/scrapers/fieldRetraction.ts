/**
 * Field retraction: how the engine stops asserting a field a source no longer
 * states (#2542).
 *
 * The gap this closes. Observations are append-only and supersede on fingerprint,
 * so a source can only ever change a field by asserting something new for it. When
 * a profile drops its lab-website link, the source emits nothing for `websiteUrl`,
 * the last assertion stays live and unopposed, and no re-scrape and no
 * rematerialization can withdraw it. Recency decay cannot help (there is no rival
 * group), `LATEST_WINS_FINGERPRINT_FIELDS` cannot help (it needs a NEW row to
 * supersede with), and `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` cannot help (it
 * fires only when no live observation exists, and the stale one is live). So the
 * only durable fix available before this was a script plus a permanent
 * `manuallyLockedFields` entry, which is why five locked instances in the corpus
 * already hold an empty value: a hand-rolled retraction (#2612).
 *
 * The evidence a retraction is built from. Absence of an observation is not
 * evidence. What is evidence is a COMPLETE READ that does not contain the field: a
 * run in which this source emitted, for this entity, every field it emits
 * unconditionally on a successful read (`witnessFields`). A complete read says
 * "this source fetched and parsed this entity's page in run R". If a later
 * complete read exists and carries no assertion for field F, the page stopped
 * stating F. If no later complete read exists, the source simply has not looked
 * again, and nothing is retracted. That distinction is a positive comparison of
 * run identity, never an inference from a missing row, which is what keeps this
 * from firing on silence.
 *
 * Why a per-source opt-in rather than the shape of a run. A run's field set is a
 * fact about the run, not about the page. A description-only extractor emits one
 * field legitimately; a roster lane that refuses a wrong-person enrichment drops
 * `websiteUrl` while keeping its citation (#2437), which reads identically to a
 * retraction from the log and would delete a value the guard was protecting. So a
 * source only retracts fields it declares, and a field is only declarable when
 * ingest cannot have dropped it (`assertDeclarableRetractionField`): every
 * quality-guarded prose field, every list the label sanitizer can empty, and every
 * enum-validated field is refused, because for those an ingest rejection and a
 * retraction are indistinguishable downstream.
 *
 * The three guards, all of which fail closed:
 *
 *   1. A complete read, not a run. A partial fetch, a content-hash skip, or an
 *      SSRF refusal emits no witness, so it licenses nothing.
 *   2. Two complete reads (`FIELD_RETRACTION_MIN_COMPLETE_READS`), mirroring the
 *      two-run rule in `facultyRosterDepartureReconciler` and
 *      `ysmLabDelistingReconciler`. A single anomalous parse cannot retract.
 *   3. A drop guard (`FIELD_RETRACTION_MAX_ABSENT_FRACTION`), the inverse of the
 *      0.5 fraction those two lanes already use. A broken selector stops asserting
 *      a field for everything the source reads, and it persists across runs, so it
 *      defeats guard 2; only the corpus-wide shape separates it from a handful of
 *      genuine delistings. Above the ceiling the whole (source, field) pair is
 *      frozen for the pass and reported, never applied partially.
 *
 * What a retraction writes. The stale observations are retired through
 * `retireObservations`, the same `superseded` plus `rollback.reason` write scripts
 * already make, so the retraction is durable and survives the next pass without
 * needing new state on the row. The stored value is cleared only when the
 * retraction removed the LAST live observation for that field and the stored value
 * is still the retracted one: with rival evidence surviving, the resolver decides
 * on the next materialization and clearing here would blank a field the corpus can
 * still support. That condition is also why this cannot be replaced by adding the
 * field to `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`: clear-on-empty reads an
 * absence, so it would also unset a value whose backing observation was merely
 * pruned, while this reads a positive retirement it performed itself in the same
 * pass.
 *
 * Locks are untouched, whatever their reason. `isRevisitableFieldLock` is
 * deliberately not consulted: it returns true only on a positive
 * `engine_gap_workaround` record and every lock in the corpus currently reads
 * `unknown`, so branching on it here would either do nothing or, if widened,
 * silently unfreeze 79 unclassified instances - 8 of them status-cache pins whose
 * removal flips rows from suppressed to student-visible (#2612). Re-opening a lock
 * is its own reviewed operation.
 *
 * A cleared field is re-gated. A row can be visible because of the field being
 * removed, so every row whose stored value this clears goes back through
 * `planStudentVisibilityGate`/`applyStudentVisibilityGatePlans` rather than
 * keeping a tier decided about evidence it no longer has.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { normalizeWebsiteUrlIdentityKey } from '../scripts/researchEntityPiDedupeCore';
import { INGEST_REJECTABLE_RESEARCH_ENTITY_FIELDS } from './observationFieldSanitizer';
import {
  ENUM_VALIDATED_OBSERVATION_FIELDS,
  LATEST_WINS_FINGERPRINT_FIELDS,
  QUALITY_GUARDED_PROSE_FIELDS,
  retireObservations,
} from './observationStore';

export const FIELD_RETRACTION_MIN_COMPLETE_READS = 2;
export const FIELD_RETRACTION_MAX_ABSENT_FRACTION = 0.5;
export const FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION = 20;

export const FIELD_RETRACTION_ROLLBACK_REASON =
  'field retraction: the source completely re-read this entity and no longer asserts this field (#2542)';

export interface SourceFieldRetractionContract {
  /**
   * Fields the source emits on EVERY successful read of an entity. Their joint
   * presence in one run is what makes that run a complete read; a run missing any
   * of them is treated as a partial or failed read and licenses no retraction.
   */
  witnessFields: readonly string[];
  retractableFields: readonly string[];
  notes: string;
}

/**
 * Only sources whose emit path has been read end to end belong here.
 *
 * `ysm-faculty-directory` qualifies: `facultyToResearchEntityObservations` emits
 * `slug`, `name`, `kind`, `entityType`, `school`, `sourceUrls`, and
 * `inferredPiUserKey` for every profile it accepts, and emits `websiteUrl` only
 * when `classifyProfileLabWebsite` finds the profile links the person's OWN
 * research home. Its refusals are exactly the cases #2542 asks to retract: a lab
 * slot emptied, and a lab slot now holding an affiliated organization.
 *
 * `dept-faculty-roster` deliberately does NOT qualify even though its emit has
 * the same shape. On a `profileBelongsToRosterPerson` mismatch it keeps the
 * citation and drops only the enrichment, `labUrl` included, so a wrong-person
 * refusal is indistinguishable from a delisting; and #2385 records that dropping
 * that edge strands the real lab, which `observations:retarget-foreign-lab-websites`
 * exists to repair rather than retract.
 *
 * `ysm-atoz-index` does not qualify either, for the opposite reason: a delisted
 * lab vanishes from the index entirely, so it emits no witness and no partial
 * read ever occurs. That cohort is `ysmLabDelistingReconciler`'s.
 */
export const fieldRetractionContracts: Readonly<Record<string, SourceFieldRetractionContract>> = {
  'ysm-faculty-directory': {
    witnessFields: ['slug', 'sourceUrls'],
    retractableFields: ['websiteUrl'],
    notes:
      'Reads one official profile per entity and emits slug plus sourceUrls unconditionally. A missing websiteUrl means the profile no longer links a research home this person owns.',
  },
};

/**
 * A witness field must be as undroppable as a retractable one: a rejected witness
 * would silently downgrade a complete read to a partial one and make the lane
 * inert, which is the dormancy shape #2410 spent three causes on.
 */
export function isIngestDroppableObservationField(field: string): boolean {
  return (
    INGEST_REJECTABLE_RESEARCH_ENTITY_FIELDS.has(field) ||
    QUALITY_GUARDED_PROSE_FIELDS.has(field) ||
    ENUM_VALIDATED_OBSERVATION_FIELDS.has(field)
  );
}

export function assertDeclarableRetractionField(field: string, role: 'witness' | 'retractable') {
  if (!field.trim()) throw new Error(`A ${role} field name cannot be blank.`);
  if (isIngestDroppableObservationField(field)) {
    throw new Error(
      `Cannot declare ${role} field ${JSON.stringify(field)}: ingest can drop this field's value, so its absence from a run is not evidence about the page.`,
    );
  }
}

/**
 * A latest-wins witness would be a false witness. Its fingerprint omits `value`,
 * so every run's row supersedes the previous one and the log keeps a single
 * active copy; counting complete reads still works because this lane reads runs
 * rather than live rows, but a witness whose value drifts run to run cannot be
 * distinguished from one re-emitted unchanged, so the declaration stays on
 * value-fingerprinted fields where a run's row is its own record.
 */
export function assertFieldRetractionContractsAreDeclarable(
  contracts: Readonly<Record<string, SourceFieldRetractionContract>> = fieldRetractionContracts,
): void {
  for (const [sourceName, contract] of Object.entries(contracts)) {
    if (contract.witnessFields.length === 0) {
      throw new Error(`${sourceName} declares no witness field, so no read can be complete.`);
    }
    if (contract.retractableFields.length === 0) {
      throw new Error(`${sourceName} declares no retractable field.`);
    }
    for (const field of contract.witnessFields) {
      assertDeclarableRetractionField(field, 'witness');
      if (LATEST_WINS_FINGERPRINT_FIELDS.has(field)) {
        throw new Error(
          `${sourceName} cannot use latest-wins field ${JSON.stringify(field)} as a read witness.`,
        );
      }
    }
    for (const field of contract.retractableFields) {
      assertDeclarableRetractionField(field, 'retractable');
    }
  }
}

assertFieldRetractionContractsAreDeclarable();

export function fieldRetractionContractFor(
  sourceName: string,
): SourceFieldRetractionContract | undefined {
  return Object.prototype.hasOwnProperty.call(fieldRetractionContracts, sourceName)
    ? fieldRetractionContracts[sourceName]
    : undefined;
}

export function fieldRetractionEnabled(): boolean {
  return process.env.SCRAPER_FIELD_RETRACTION === 'true';
}

export interface FieldRetractionCompleteRead {
  entityKey: string;
  scrapeRunId: string;
  observedAt: Date;
}

export interface FieldRetractionCandidateObservation {
  observationId: string;
  entityKey: string;
  field: string;
  value: unknown;
  scrapeRunId: string;
  observedAt: Date;
}

export interface FieldRetractionEntityState {
  entityId: string;
  entityKey: string;
  manuallyLockedFields: string[];
  storedValues: Record<string, unknown>;
  liveObservationCountByField: Record<string, number>;
}

export type FieldRetractionVerdict =
  | 'source-has-not-reread'
  | 'awaiting-second-complete-read'
  | 'retract';

/**
 * A read only counts when it is BOTH a different run and strictly later than the
 * observation. Run inequality alone would let a concurrently-written sibling run
 * retract; timestamp alone would let the observation's own run retract it.
 */
export function completeReadsSupportingRetraction(
  observation: { scrapeRunId: string; observedAt: Date },
  completeReads: readonly FieldRetractionCompleteRead[],
): string[] {
  const runIds = new Set<string>();
  for (const read of completeReads) {
    if (read.scrapeRunId === observation.scrapeRunId) continue;
    if (!(read.observedAt.getTime() > observation.observedAt.getTime())) continue;
    runIds.add(read.scrapeRunId);
  }
  return Array.from(runIds);
}

export function classifyFieldRetraction(params: {
  observation: { scrapeRunId: string; observedAt: Date };
  completeReads: readonly FieldRetractionCompleteRead[];
  minCompleteReads?: number;
}): FieldRetractionVerdict {
  const supporting = completeReadsSupportingRetraction(params.observation, params.completeReads);
  if (supporting.length === 0) return 'source-has-not-reread';
  const min = params.minCompleteReads ?? FIELD_RETRACTION_MIN_COMPLETE_READS;
  return supporting.length >= min ? 'retract' : 'awaiting-second-complete-read';
}

/**
 * The fraction ceiling only applies once the population is large enough for a
 * fraction to say anything. Three of five holders dropping a lab link is an
 * ordinary month at that scale, so a ceiling there would freeze the lane
 * permanently on small sources while protecting nothing; above the floor a broken
 * selector is unmistakable because it stops asserting for every holder at once.
 * Below the floor the two-complete-read rule and the operator's `--max-apply`
 * ceiling are what bound the damage.
 */
export function passesFieldRetractionDropGuard(
  absentEntityCount: number,
  assertingEntityCount: number,
  maxFraction: number = FIELD_RETRACTION_MAX_ABSENT_FRACTION,
  minPopulation: number = FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION,
): boolean {
  if (assertingEntityCount <= 0) return false;
  if (assertingEntityCount < minPopulation) return true;
  return absentEntityCount <= maxFraction * assertingEntityCount;
}

function normalizedComparableValue(value: unknown): string {
  if (typeof value === 'string') {
    const urlKey = normalizeWebsiteUrlIdentityKey(value);
    return urlKey || value.trim().toLowerCase();
  }
  if (Array.isArray(value)) {
    return `[${value.map(normalizedComparableValue).sort().join(',')}]`;
  }
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

export function storedValueIsRetractedValue(storedValue: unknown, retractedValues: unknown[]) {
  const stored = normalizedComparableValue(storedValue);
  if (!stored) return false;
  return retractedValues.some((value) => normalizedComparableValue(value) === stored);
}

export interface PlannedFieldRetraction {
  entityId: string;
  entityKey: string;
  field: string;
  observationIds: string[];
  clearsStoredValue: boolean;
}

export interface FrozenFieldRetraction {
  sourceName: string;
  field: string;
  absentEntities: number;
  /**
   * Entities this source read that hold a live assertion for the field. The
   * denominator is scoped to holders rather than to everything read, because a
   * broken selector shows up as "every holder stopped asserting" and a real
   * delisting cohort as a handful of them; diluting it with entities that never
   * had the field would let a total selector failure pass the guard.
   */
  assertingEntities: number;
}

export interface FieldRetractionCounts {
  /** Entities holding a live assertion for a retractable field that this source read. */
  candidateEntities: number;
  candidateObservations: number;
  sourceHasNotReread: number;
  awaitingSecondCompleteRead: number;
  lockedSkipped: number;
  unmatchedEntities: number;
  retractedObservations: number;
  storedValuesCleared: number;
  /** Retired, but rival live evidence survives, so the resolver decides next pass. */
  deferredToResolver: number;
  /** Retired, but the stored value is no longer the retracted one, so nothing is cleared. */
  storedValueDiverged: number;
}

export interface FieldRetractionPlan {
  retractions: PlannedFieldRetraction[];
  frozenFields: FrozenFieldRetraction[];
  counts: FieldRetractionCounts;
}

export function planFieldRetractions(input: {
  sourceName: string;
  contract: SourceFieldRetractionContract;
  completeReads: readonly FieldRetractionCompleteRead[];
  activeObservations: readonly FieldRetractionCandidateObservation[];
  entities: readonly FieldRetractionEntityState[];
  minCompleteReads?: number;
  maxAbsentFraction?: number;
  dropGuardMinPopulation?: number;
}): FieldRetractionPlan {
  const retractableFields = new Set(input.contract.retractableFields);
  const readsByEntity = new Map<string, FieldRetractionCompleteRead[]>();
  for (const read of input.completeReads) {
    const group = readsByEntity.get(read.entityKey);
    if (group) group.push(read);
    else readsByEntity.set(read.entityKey, [read]);
  }
  const entityStates = new Map(input.entities.map((entity) => [entity.entityKey, entity]));

  const assertingEntitiesByField = new Map<string, Set<string>>();
  const counts: FieldRetractionCounts = {
    candidateEntities: 0,
    candidateObservations: 0,
    sourceHasNotReread: 0,
    awaitingSecondCompleteRead: 0,
    lockedSkipped: 0,
    unmatchedEntities: 0,
    retractedObservations: 0,
    storedValuesCleared: 0,
    deferredToResolver: 0,
    storedValueDiverged: 0,
  };

  const retractedByKey = new Map<
    string,
    { entityKey: string; field: string; observationIds: string[]; values: unknown[] }
  >();
  for (const observation of input.activeObservations) {
    if (!retractableFields.has(observation.field)) continue;
    const completeReads = readsByEntity.get(observation.entityKey);
    if (!completeReads) continue;
    counts.candidateObservations += 1;
    const asserting = assertingEntitiesByField.get(observation.field) ?? new Set<string>();
    asserting.add(observation.entityKey);
    assertingEntitiesByField.set(observation.field, asserting);
    const verdict = classifyFieldRetraction({
      observation,
      completeReads,
      minCompleteReads: input.minCompleteReads,
    });
    if (verdict === 'source-has-not-reread') {
      counts.sourceHasNotReread += 1;
      continue;
    }
    if (verdict === 'awaiting-second-complete-read') {
      counts.awaitingSecondCompleteRead += 1;
      continue;
    }
    const key = `${observation.entityKey}\u0000${observation.field}`;
    const group = retractedByKey.get(key);
    if (group) {
      group.observationIds.push(observation.observationId);
      group.values.push(observation.value);
    } else {
      retractedByKey.set(key, {
        entityKey: observation.entityKey,
        field: observation.field,
        observationIds: [observation.observationId],
        values: [observation.value],
      });
    }
  }

  counts.candidateEntities = new Set(
    Array.from(assertingEntitiesByField.values()).flatMap((entities) => Array.from(entities)),
  ).size;

  const frozenFields: FrozenFieldRetraction[] = [];
  const frozen = new Set<string>();
  for (const field of retractableFields) {
    const absentEntities = new Set(
      Array.from(retractedByKey.values())
        .filter((group) => group.field === field)
        .map((group) => group.entityKey),
    );
    if (absentEntities.size === 0) continue;
    const assertingEntities = assertingEntitiesByField.get(field)?.size ?? 0;
    if (
      !passesFieldRetractionDropGuard(
        absentEntities.size,
        assertingEntities,
        input.maxAbsentFraction,
        input.dropGuardMinPopulation,
      )
    ) {
      frozen.add(field);
      frozenFields.push({
        sourceName: input.sourceName,
        field,
        absentEntities: absentEntities.size,
        assertingEntities,
      });
    }
  }

  const retractions: PlannedFieldRetraction[] = [];
  for (const group of retractedByKey.values()) {
    if (frozen.has(group.field)) continue;
    const entity = entityStates.get(group.entityKey);
    if (!entity) {
      counts.unmatchedEntities += 1;
      continue;
    }
    if (entity.manuallyLockedFields.includes(group.field)) {
      counts.lockedSkipped += 1;
      continue;
    }
    const liveCount = entity.liveObservationCountByField[group.field] ?? 0;
    const rivalEvidenceSurvives = liveCount > group.observationIds.length;
    const clearsStoredValue =
      !rivalEvidenceSurvives &&
      storedValueIsRetractedValue(entity.storedValues[group.field], group.values);
    counts.retractedObservations += group.observationIds.length;
    if (clearsStoredValue) counts.storedValuesCleared += 1;
    else if (rivalEvidenceSurvives) counts.deferredToResolver += 1;
    else if (normalizedComparableValue(entity.storedValues[group.field])) {
      counts.storedValueDiverged += 1;
    }
    retractions.push({
      entityId: entity.entityId,
      entityKey: group.entityKey,
      field: group.field,
      observationIds: group.observationIds,
      clearsStoredValue,
    });
  }

  return { retractions, frozenFields, counts };
}

/**
 * Named causes rather than a bare zero, for the reason #2410 gives: an operator
 * who switched this on has to be able to tell an uneventful pass from a lane that
 * never executed.
 */
export type FieldRetractionOutcome =
  | 'disabled'
  | 'invalid-run-id'
  | 'unknown-run'
  | 'source-not-retraction-capable'
  | 'no-complete-reads'
  | 'planned'
  | 'reconciled';

export interface FieldRetractionResult {
  outcome: FieldRetractionOutcome;
  sourceName?: string;
  dryRun: boolean;
  counts: FieldRetractionCounts;
  frozenFields: FrozenFieldRetraction[];
  regatedEntities: number;
  retractions: PlannedFieldRetraction[];
}

const emptyCounts = (): FieldRetractionCounts => ({
  candidateEntities: 0,
  candidateObservations: 0,
  sourceHasNotReread: 0,
  awaitingSecondCompleteRead: 0,
  lockedSkipped: 0,
  unmatchedEntities: 0,
  retractedObservations: 0,
  storedValuesCleared: 0,
  deferredToResolver: 0,
  storedValueDiverged: 0,
});

const emptyResult = (outcome: FieldRetractionOutcome, dryRun: boolean): FieldRetractionResult => ({
  outcome,
  dryRun,
  counts: emptyCounts(),
  frozenFields: [],
  regatedEntities: 0,
  retractions: [],
});

const observationEntityKey = (observation: { entityKey?: unknown; entityId?: unknown }): string => {
  const key = typeof observation.entityKey === 'string' ? observation.entityKey.trim() : '';
  return key || serializedDocumentId(observation.entityId) || '';
};

/**
 * One complete read per (entity, run) in which every witness field was observed.
 *
 * Superseded witness rows are deliberately included: a witness is a record that a
 * run happened, and the newest run's row supersedes the previous one on an
 * unchanged value, so reading live rows only would collapse every historical read
 * into one and make the two-read rule unsatisfiable. Retention still bounds this -
 * `pruneDeadObservations` keeps the last 3 runs per source - and losing older
 * witnesses only ever makes this lane more conservative.
 *
 * Scoped to the entities that actually hold a live assertion for a retractable
 * field, so the aggregation is proportional to the candidate population rather
 * than to every entity the source has ever read.
 */
export async function loadCompleteReads(
  sourceName: string,
  witnessFields: readonly string[],
  entityKeys: readonly string[],
): Promise<FieldRetractionCompleteRead[]> {
  if (entityKeys.length === 0) return [];
  const groups = (await Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        sourceName,
        entityKey: { $in: [...entityKeys] },
        field: { $in: [...witnessFields] },
        scrapeRunId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: { entityKey: '$entityKey', entityId: '$entityId', scrapeRunId: '$scrapeRunId' },
        fields: { $addToSet: '$field' },
        observedAt: { $max: '$observedAt' },
      },
    },
  ])) as Array<{
    _id: { entityKey?: unknown; entityId?: unknown; scrapeRunId: unknown };
    fields: string[];
    observedAt: Date;
  }>;

  const reads: FieldRetractionCompleteRead[] = [];
  for (const group of groups) {
    const observed = new Set(group.fields);
    if (!witnessFields.every((field) => observed.has(field))) continue;
    const entityKey = observationEntityKey(group._id);
    const scrapeRunId = serializedDocumentId(group._id.scrapeRunId) || '';
    if (!entityKey || !scrapeRunId || !(group.observedAt instanceof Date)) continue;
    reads.push({ entityKey, scrapeRunId, observedAt: group.observedAt });
  }
  return reads;
}

async function loadActiveRetractableObservations(
  sourceName: string,
  retractableFields: readonly string[],
): Promise<FieldRetractionCandidateObservation[]> {
  const rows = (await Observation.find({
    entityType: 'researchEntity',
    sourceName,
    field: { $in: [...retractableFields] },
    superseded: { $ne: true },
    scrapeRunId: { $exists: true, $ne: null },
  })
    .select('_id entityKey entityId field value scrapeRunId observedAt')
    .lean()) as any[];

  const observations: FieldRetractionCandidateObservation[] = [];
  for (const row of rows) {
    const observationId = serializedDocumentId(row._id) || '';
    const entityKey = observationEntityKey(row);
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!observationId || !entityKey || !scrapeRunId || !(row.observedAt instanceof Date)) continue;
    observations.push({
      observationId,
      entityKey,
      field: row.field,
      value: row.value,
      scrapeRunId,
      observedAt: row.observedAt,
    });
  }
  return observations;
}

/**
 * Live evidence is counted across ALL sources, not just the retracting one:
 * whether clearing the stored value is safe turns on whether the corpus still has
 * any assertion for that field, and a rival source's assertion is exactly what
 * must stop the clear.
 */
async function loadEntityStates(
  entityKeys: string[],
  retractableFields: readonly string[],
): Promise<FieldRetractionEntityState[]> {
  if (entityKeys.length === 0) return [];
  const entities = (await ResearchEntity.find({ slug: { $in: entityKeys } })
    .select(['slug', 'manuallyLockedFields', ...retractableFields].join(' '))
    .lean()) as any[];

  const liveCounts = (await Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        entityKey: { $in: entityKeys },
        field: { $in: [...retractableFields] },
        superseded: { $ne: true },
      },
    },
    { $group: { _id: { entityKey: '$entityKey', field: '$field' }, count: { $sum: 1 } } },
  ])) as Array<{ _id: { entityKey: string; field: string }; count: number }>;

  const countsByEntity = new Map<string, Record<string, number>>();
  for (const row of liveCounts) {
    const forEntity = countsByEntity.get(row._id.entityKey) ?? {};
    forEntity[row._id.field] = row.count;
    countsByEntity.set(row._id.entityKey, forEntity);
  }

  return entities
    .map((entity) => {
      const entityId = serializedDocumentId(entity._id) || '';
      const entityKey = typeof entity.slug === 'string' ? entity.slug : '';
      const storedValues: Record<string, unknown> = {};
      for (const field of retractableFields) storedValues[field] = entity[field];
      return {
        entityId,
        entityKey,
        manuallyLockedFields: Array.isArray(entity.manuallyLockedFields)
          ? entity.manuallyLockedFields.filter((value: unknown) => typeof value === 'string')
          : [],
        storedValues,
        liveObservationCountByField: countsByEntity.get(entityKey) ?? {},
      };
    })
    .filter((entity) => entity.entityId && entity.entityKey);
}

/**
 * The mechanism. It carries no environment switch of its own: the sweep path
 * (`reconcileFieldRetractionsFromRun`) is gated by `SCRAPER_FIELD_RETRACTION`, and
 * the operator path by the script's own apply guard plus confirm flag, so the same
 * action never has two switches that can disagree.
 */
export async function reconcileFieldRetractions(options: {
  sourceName: string;
  dryRun?: boolean;
}): Promise<FieldRetractionResult> {
  const dryRun = options.dryRun === true;
  const contract = fieldRetractionContractFor(options.sourceName);
  if (!contract) return emptyResult('source-not-retraction-capable', dryRun);

  const activeObservations = await loadActiveRetractableObservations(
    options.sourceName,
    contract.retractableFields,
  );
  const candidateEntityKeys = Array.from(
    new Set(activeObservations.map((observation) => observation.entityKey)),
  );
  const completeReads = await loadCompleteReads(
    options.sourceName,
    contract.witnessFields,
    candidateEntityKeys,
  );
  if (completeReads.length === 0) {
    return { ...emptyResult('no-complete-reads', dryRun), sourceName: options.sourceName };
  }

  const entities = await loadEntityStates(candidateEntityKeys, contract.retractableFields);

  const plan = planFieldRetractions({
    sourceName: options.sourceName,
    contract,
    completeReads,
    activeObservations,
    entities,
  });

  for (const frozen of plan.frozenFields) {
    console.warn(
      `[field-retraction] frozen ${sanitizeLogValue(frozen.sourceName)}.${sanitizeLogValue(frozen.field)}: ${frozen.absentEntities} of ${frozen.assertingEntities} asserting entities would retract (above the drop guard)`,
    );
  }

  if (dryRun) {
    return {
      outcome: 'planned',
      sourceName: options.sourceName,
      dryRun,
      counts: plan.counts,
      frozenFields: plan.frozenFields,
      regatedEntities: 0,
      retractions: plan.retractions,
    };
  }

  const observationIds = plan.retractions.flatMap((retraction) => retraction.observationIds);
  if (observationIds.length > 0) {
    await retireObservations(
      { _id: { $in: observationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      FIELD_RETRACTION_ROLLBACK_REASON,
    );
  }

  const clearedEntityIds: string[] = [];
  for (const retraction of plan.retractions) {
    if (!retraction.clearsStoredValue) continue;
    await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(retraction.entityId) },
      {
        $unset: {
          [retraction.field]: '',
          [`fieldProvenance.${retraction.field}`]: '',
        },
      },
    );
    clearedEntityIds.push(retraction.entityId);
  }

  let regatedEntities = 0;
  const regateIds = Array.from(new Set(clearedEntityIds));
  if (regateIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: regateIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    regatedEntities = regateIds.length;
  }

  return {
    outcome: 'reconciled',
    sourceName: options.sourceName,
    dryRun,
    counts: plan.counts,
    frozenFields: plan.frozenFields,
    regatedEntities,
    retractions: plan.retractions,
  };
}

export async function reconcileFieldRetractionsFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<FieldRetractionResult> {
  const dryRun = options.dryRun === true;
  if (!fieldRetractionEnabled()) return emptyResult('disabled', dryRun);
  let runObjectId: mongoose.Types.ObjectId;
  try {
    runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  } catch {
    return emptyResult('invalid-run-id', dryRun);
  }
  const run = (await ScrapeRun.findById(runObjectId).select('sourceName').lean()) as {
    sourceName?: unknown;
  } | null;
  const sourceName = typeof run?.sourceName === 'string' ? run.sourceName : '';
  if (!sourceName) return emptyResult('unknown-run', dryRun);
  return reconcileFieldRetractions({ sourceName, dryRun });
}
