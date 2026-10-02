import { execFileSync } from 'child_process';
import mongoose from 'mongoose';
import { EngineBenchmark, EngineBenchmarkRow } from '../models/engineBenchmark';
import { ResearchEntity } from '../models/researchEntity';
import { listResearchEntityMergedInRowsBySurvivor } from '../services/researchEntityCanonicalTombstone';
import { Observation } from '../models/observation';
import { materializationReadScopeFilter, materializeEntity } from '../scrapers/entityMaterializer';
import { FrozenMaterializationInput } from '../scrapers/frozenMaterializationInput';
import { loadResearchEntityNameIdentityAuthority } from '../scrapers/entityMaterializer';
import { invalidatedScrapeRunIds } from '../scrapers/invalidatedScrapeRuns';
import { loadResearchAreaEvidenceBackedRowIds } from '../scrapers/researchAreaEvidence';
import {
  planStudentVisibilityGate,
  type ResearchEntityGateRowInput,
} from '../services/studentVisibilityGateService';
import { computeResearchEntityStudentVisibility } from '../services/studentVisibilityTier';
import {
  loadKnownPersonSurnameRoster,
  loadResearchEntityLeadPersonIds,
} from '../utils/researchHomeNameIdentityRoster';
import { labelsFromCapturedRows, type ReplayedRow } from './engineBenchmarkCore';

export const ENGINE_BENCHMARK_ENTITY_TYPE = 'researchEntity';
export const ENGINE_BENCHMARK_STAGE = 'resolve-and-gate';

/**
 * Wider than the other arms on purpose. About 11% of this population moved under the regression
 * this arm exists to witness, so a sample of 20 expects two movers and can easily contain none.
 * Sixty expects about seven.
 */
export const UNBACKED_TOPIC_ARM_ROWS = 60;

export function currentCodeSha(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The scope #3589 asks for: rows that exercised a known engine defect, never a first-N
 * sample. Each predicate names the arm it holds still, and each is a predicate rather
 * than a slug list so the capture describes what it froze without naming a person
 * (docs/person-identifier-convention.md).
 */
export interface EngineBenchmarkScopeArm {
  scope: string;
  /** A filter over `research_entities`, or a resolver for an arm that needs a join. */
  filter?: Record<string, unknown>;
  resolveFilter?: () => Promise<Record<string, unknown>>;
  /**
   * Rows to take from this arm, when the default per-scope limit is too few to contain a defect.
   *
   * The unbacked-topics arm needs this: only about 11% of its population changed under the
   * regression #3871 was opened for, so 20 rows would be expected to contain two movers and
   * contained none. A wider sample is what makes the arm able to witness the defect at all.
   */
  limit?: number;
}

/**
 * An arm per population a known defect class acts on, which is the rule this list is kept to.
 *
 * Learned the hard way: replaying #3868 against this benchmark moved the fingerprint attributably
 * and reported one row GAINING three topics, while the regression it caused stripped 138 chips from
 * 79 rows. None of the first five arms selects the population that derivation acts on, so the
 * benchmark contained almost none of the rows where it removed rather than added (#3871).
 */
export const ENGINE_BENCHMARK_SCOPE_PREDICATES: ReadonlyArray<EngineBenchmarkScopeArm> = [
  {
    scope: 'merged-survivor',
    filter: { archived: { $ne: true }, canonicalGroupId: { $ne: null } },
  },
  {
    scope: 'field-value-refused',
    filter: { archived: { $ne: true }, fieldValueRefusals: { $exists: true, $ne: {} } },
  },
  {
    scope: 'manually-locked-field',
    filter: { archived: { $ne: true }, 'manuallyLockedFields.0': { $exists: true } },
  },
  {
    scope: 'held-by-gate',
    filter: {
      archived: { $ne: true },
      studentVisibilityTier: { $ne: 'student_ready' },
      'studentVisibilityReasons.0': { $exists: true },
    },
  },
  {
    scope: 'served',
    filter: { archived: { $ne: true }, studentVisibilityTier: 'student_ready' },
  },
  {
    /**
     * Stored topics no live observation states: the population a re-derivation strips, and the one
     * whose absence let #3868 through. Not expressible as an entity filter, because "no live
     * observation states this" is a join, so this arm resolves its own id set.
     *
     * Both identity forms are read. A `researchAreas` observation is keyed by `entityKey` far more
     * often than by `entityId` in this corpus, so an id-only join would have called almost every
     * row unbacked and filled the arm with rows that are perfectly well evidenced.
     */
    scope: 'unbacked-topics',
    resolveFilter: async () => ({ _id: { $in: await rowsWithUnbackedStoredTopics() } }),
    limit: UNBACKED_TOPIC_ARM_ROWS,
  },
];

const UNBACKED_TOPIC_FIELD = 'researchAreas';

/**
 * Rows whose stored topics no live observation states, answered by the SHARED helper rather than
 * by a predicate of this file's own.
 *
 * The first version of this restated the query, and was wrong in the permissive direction: it
 * counted any live observation carrying a matching `entityId` or `entityKey` as evidence, so it
 * found 126 unbacked rows where the shared helper finds 711. `loadResearchAreaEvidenceBackedRowIds`
 * does two things the restatement did not: it walks the merged-in rows so a survivor's losers'
 * keys count toward its identity, and it applies a per-row ADMISSION test, so an observation whose
 * areas are all rejected for this row is not evidence for it.
 *
 * That is the fourth time in this work that restating a query instead of calling the function gave
 * a wrong number, so this arm calls the function (#3871).
 */
export async function rowsWithUnbackedStoredTopics(): Promise<mongoose.Types.ObjectId[]> {
  const candidates = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
    [`${UNBACKED_TOPIC_FIELD}.0`]: { $exists: true },
  })
    .select('_id slug departments manuallyLockedFields')
    .sort({ _id: 1 })
    .lean()) as Array<{ _id: mongoose.Types.ObjectId }>;
  if (candidates.length === 0) return [];
  const backed = await loadResearchAreaEvidenceBackedRowIds(candidates);
  return candidates.filter((row) => !backed.has(String(row._id))).map((row) => row._id);
}

export interface CaptureEngineBenchmarkOptions {
  benchmarkId: string;
  perScopeLimit: number;
}

export interface CapturedEngineBenchmark {
  benchmarkId: string;
  rowCount: number;
  observationCount: number;
  byScope: Array<{ scope: string; rows: number }>;
  labelCount: number;
}

const slugText = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Freeze one row's whole engine input: its observations, its stored document, whether
 * anything is merged into it, and the gate inputs the live gate reached its verdict on.
 *
 * The gate inputs are read off `planStudentVisibilityGate` rather than rebuilt, because
 * every one of them is corpus-wide or a join, and a benchmark that recomputed them from a
 * scoped read would be freezing its own reimplementation instead of the gate's input.
 */
export async function captureEngineBenchmark(
  options: CaptureEngineBenchmarkOptions,
): Promise<CapturedEngineBenchmark> {
  const selected = new Map<string, { doc: any; scope: string }>();
  const byScope: Array<{ scope: string; rows: number }> = [];
  for (const arm of ENGINE_BENCHMARK_SCOPE_PREDICATES) {
    const { scope } = arm;
    const filter =
      arm.filter ?? (await (arm.resolveFilter as () => Promise<Record<string, unknown>>)());
    const docs = await ResearchEntity.find(filter)
      .sort({ _id: 1 })
      .limit(arm.limit ?? options.perScopeLimit);
    let added = 0;
    for (const doc of docs) {
      const slug = slugText((doc as any).slug);
      if (!slug || selected.has(slug)) continue;
      selected.set(slug, { doc, scope });
      added += 1;
    }
    byScope.push({ scope, rows: added });
  }

  const slugs = [...selected.keys()];
  const entityIds = slugs.map((slug) => String((selected.get(slug) as any).doc._id));
  const plans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds: entityIds,
  });
  const planByRecordId = new Map(plans.map((plan) => [plan.recordId, plan]));

  // The losers merged into each survivor, so their observations can be frozen too. Routing the
  // merged-survivor candidate read through the read source (#3849) means an unfrozen loser is now
  // reported as incomplete input rather than silently read from the corpus, so the capture has to
  // cover them for a merged survivor to replay on a complete input.
  // The engine's own walk, not a reimplementation of it. A merge chain is transitive: a loser can
  // itself have been merged into, so `canonicalGroupId` pointing at a survivor finds only the
  // first hop. Capturing one hop left exactly one benchmark row reading a second-hop loser live.
  const loserRowsBySurvivorId = await listResearchEntityMergedInRowsBySurvivor(entityIds);

  const mergedInSurvivorIds = new Set(
    (
      await ResearchEntity.find({
        canonicalGroupId: { $in: entityIds.map((id) => new mongoose.Types.ObjectId(id)) },
        archived: true,
      })
        .select('canonicalGroupId')
        .lean()
    ).map((row: any) => String(row.canonicalGroupId)),
  );

  // The one prefetch answer that is neither an observation nor the row itself. Loaded with the
  // same corpus reader the chunk prefetch uses, and collapsed the same way: a row with more than
  // one distinct lead person has no sole lead, which is the absence the engine reads.
  const leadPersonIds = await loadResearchEntityLeadPersonIds(entityIds);
  const soleLeadByEntityId = new Map<string, string>();
  for (const [id, personIds] of leadPersonIds) {
    if (new Set(personIds).size <= 1) soleLeadByEntityId.set(id, personIds[0] ?? '');
  }

  const rows: Array<Record<string, unknown>> = [];
  let observationCount = 0;
  for (const slug of slugs) {
    const { doc } = selected.get(slug) as { doc: any };
    const entityId = String(doc._id);
    const observations = await Observation.find({
      entityType: ENGINE_BENCHMARK_ENTITY_TYPE,
      ...materializationReadScopeFilter(),
      $or: [{ entityKey: slug }, { entityId: doc._id }],
    }).lean();
    observationCount += observations.length;
    const plan = planByRecordId.get(entityId);
    rows.push({
      benchmarkId: options.benchmarkId,
      entityKey: slug,
      entityId,
      entityDoc: doc.toObject ? doc.toObject() : doc,
      observations,
      hasMergedInRows: mergedInSurvivorIds.has(entityId),
      soleLeadPersonId: soleLeadByEntityId.get(entityId),
      // The resolved lead name, not just the sole-lead shortcut: a row with two or more distinct
      // leads has no sole lead, so the engine falls through to a corpus read that no frozen
      // observation set can cover (#3589).
      leadPersonName: (await loadResearchEntityNameIdentityAuthority(doc._id)).leadPersonName,
      gateInput: plan?.gateInput ?? null,
      capturedTier: plan?.tier,
      capturedReasons: plan?.reasons ?? [],
    });
  }

  // One frozen entry per loser, keyed by its own slug and id, with `entityDoc` null because the
  // replay never projects a loser: it only reads the loser's observations through the survivor.
  for (const [survivorId, losers] of loserRowsBySurvivorId) {
    for (const loser of losers) {
      const loserSlug = String((loser as { slug?: unknown }).slug ?? '');
      const loserId = String((loser as { _id?: unknown })._id ?? '');
      const loserObservations = await Observation.find({
        entityType: ENGINE_BENCHMARK_ENTITY_TYPE,
        ...materializationReadScopeFilter(),
        $or: [
          ...(loserSlug ? [{ entityKey: loserSlug }] : []),
          { entityId: new mongoose.Types.ObjectId(loserId) },
        ],
      }).lean();
      observationCount += loserObservations.length;
      rows.push({
        benchmarkId: options.benchmarkId,
        entityKey: loserSlug || undefined,
        entityId: loserId,
        entityDoc: null,
        observations: loserObservations,
        hasMergedInRows: false,
        mergedIntoSurvivorId: survivorId,
      });
    }
  }

  const labels = labelsFromCapturedRows(
    rows as Array<{ entityKey?: string; entityDoc?: Record<string, unknown> | null }>,
  );
  const knownPersonSurnames = [...(await loadKnownPersonSurnameRoster())];

  await EngineBenchmarkRow.deleteMany({ benchmarkId: options.benchmarkId });
  if (rows.length > 0) await EngineBenchmarkRow.insertMany(rows);
  await EngineBenchmark.findOneAndUpdate(
    { benchmarkId: options.benchmarkId },
    {
      benchmarkId: options.benchmarkId,
      entityType: ENGINE_BENCHMARK_ENTITY_TYPE,
      scope: ENGINE_BENCHMARK_SCOPE_PREDICATES.map(({ scope }) => scope).join(','),
      capturedAt: new Date(),
      environment: process.env.NODE_ENV || 'development',
      databaseName: mongoose.connection.db?.databaseName ?? 'unknown',
      codeSha: currentCodeSha(),
      rowCount: rows.length,
      observationCount,
      knownPersonSurnames,
      invalidatedScrapeRunIds: await invalidatedScrapeRunIds(),
      labels,
    },
    { upsert: true, returnDocument: 'after' },
  );

  return {
    benchmarkId: options.benchmarkId,
    rowCount: rows.length,
    observationCount,
    byScope,
    labelCount: labels.length,
  };
}

export interface EngineReplayResult {
  rows: ReplayedRow[];
  invalidatedRunSetChanged: boolean;
  cardSynthesisRequested: number;
}

/**
 * The projected row the gate judges: the stored document with this pass's planned writes
 * applied and its planned clears removed.
 *
 * Built here rather than read back from the database because the replay writes nothing,
 * and judged as a projection rather than as the stored row because a gate run on the
 * stored values would answer about the last apply instead of about this code.
 */
export function projectedEntityForGate(
  entityDoc: Record<string, unknown> | null,
  plannedSet: Record<string, unknown>,
  plannedUnset: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = { ...(entityDoc ?? {}), ...plannedSet };
  for (const field of Object.keys(plannedUnset)) delete projected[field];
  return projected;
}

/**
 * Replay resolve and gate over a frozen benchmark, writing nothing.
 *
 * Card synthesis is refused rather than called: it is a live model, so a replay that
 * called it would neither be reproducible nor free. The refusals are counted, so a lane
 * that starts asking for synthesis shows up as a number rather than as noise in the
 * fingerprint.
 */
export async function replayEngineBenchmark(benchmarkId: string): Promise<EngineReplayResult> {
  const benchmark = await EngineBenchmark.findOne({ benchmarkId }).lean();
  if (!benchmark) throw new Error(`No engine benchmark ${benchmarkId}`);
  const capturedRows = (await EngineBenchmarkRow.find({ benchmarkId })
    .sort({ entityKey: 1 })
    .lean()) as any[];

  const frozen = new FrozenMaterializationInput(
    String((benchmark as any).entityType),
    capturedRows.map((row) => ({
      entityKey: row.entityKey,
      entityId: row.entityId,
      entityDoc: row.entityDoc ?? null,
      observations: row.observations ?? [],
      hasMergedInRows: Boolean(row.hasMergedInRows),
      soleLeadPersonId: row.soleLeadPersonId,
    })),
  );

  // Pinned from the instant the input was captured rather than from a constant, so recency
  // decay still means what it meant when the evidence was read (#3589). With a wall clock the
  // resolver recomputes `confidenceByField` on every replay and two replays of identical code
  // disagree by construction: measured on the first capture, 67 of 90 rows differed on that
  // field alone.
  const replayNow = new Date((benchmark as any).capturedAt ?? Date.now());
  const knownPersonSurnames = new Set<string>((benchmark as any).knownPersonSurnames ?? []);
  const capturedInvalidatedRuns = [...((benchmark as any).invalidatedScrapeRunIds ?? [])].sort();
  const liveInvalidatedRuns = [...(await invalidatedScrapeRunIds())].sort();
  let cardSynthesisRequested = 0;

  const rows: ReplayedRow[] = [];
  // A loser row is frozen input for the survivor that absorbed it, not a subject: it has no
  // stored document to project and the benchmark makes no claim about it (#3849).
  const replaySubjects = capturedRows.filter((row) => !row.mergedIntoSurvivorId);
  for (const captured of replaySubjects) {
    const missesBefore = frozen.recordedMisses().length;
    const result = await materializeEntity(
      String((benchmark as any).entityType) as never,
      { entityKey: captured.entityKey },
      {
        dryRun: true,
        now: replayNow,
        chunkPrefetch: frozen,
        nameIdentityAuthority: {
          knownPersonSurnames,
          leadPersonName: String(captured.leadPersonName ?? ''),
        },
        synthesizeCardDescription: async () => {
          cardSynthesisRequested += 1;
          return '';
        },
      },
    );
    const plannedSet = ((result as any).plannedSet ?? {}) as Record<string, unknown>;
    const plannedUnset = ((result as any).plannedUnset ?? {}) as Record<string, unknown>;
    const gateInput = (captured.gateInput ?? {}) as Partial<ResearchEntityGateRowInput>;
    const verdict = computeResearchEntityStudentVisibility({
      entity: projectedEntityForGate(captured.entityDoc ?? null, plannedSet, plannedUnset),
      leadMembers: gateInput.leadMembers ?? [],
      accessSignalCount: gateInput.accessSignalCount ?? 0,
      actionablePathwayCount: gateInput.actionablePathwayCount ?? 0,
      openPostedOpportunityCount: gateInput.openPostedOpportunityCount ?? 0,
      duplicateRisk: gateInput.duplicateRisk ?? false,
      exactUrlDuplicateRisk: gateInput.exactUrlDuplicateRisk ?? false,
      citationsSharedAcrossPersonRows: gateInput.citationsSharedAcrossPersonRows ?? false,
      relatedEntityAccessPathCount: gateInput.relatedEntityAccessPathCount ?? 0,
      knownPersonSurnames,
    });
    rows.push({
      entityKey: String(captured.entityKey),
      plannedSet,
      plannedUnset,
      // The frozen stored document, so the direction of a change is read on the outcome (#3871).
      storedValues: ((captured.entityDoc ?? {}) as Record<string, unknown>) ?? {},
      tier: verdict.tier,
      computedTier: verdict.computedTier,
      reasons: verdict.reasons,
      unfrozenReads: [
        ...new Set(
          frozen
            .recordedMisses()
            .slice(missesBefore)
            .map((miss) => miss.read),
        ),
      ].sort(),
    });
  }

  return {
    rows,
    invalidatedRunSetChanged: capturedInvalidatedRuns.join(',') !== liveInvalidatedRuns.join(','),
    cardSynthesisRequested,
  };
}
