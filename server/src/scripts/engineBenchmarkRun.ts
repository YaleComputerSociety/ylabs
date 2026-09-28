import { execFileSync } from 'child_process';
import mongoose from 'mongoose';
import { EngineBenchmark, EngineBenchmarkRow } from '../models/engineBenchmark';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { materializationReadScopeFilter, materializeEntity } from '../scrapers/entityMaterializer';
import { FrozenMaterializationInput } from '../scrapers/frozenMaterializationInput';
import { invalidatedScrapeRunIds } from '../scrapers/invalidatedScrapeRuns';
import {
  planStudentVisibilityGate,
  type ResearchEntityGateRowInput,
} from '../services/studentVisibilityGateService';
import { computeResearchEntityStudentVisibility } from '../services/studentVisibilityTier';
import { loadKnownPersonSurnameRoster } from '../utils/researchHomeNameIdentityRoster';
import { labelsFromCapturedRows, type ReplayedRow } from './engineBenchmarkCore';

export const ENGINE_BENCHMARK_ENTITY_TYPE = 'researchEntity';
export const ENGINE_BENCHMARK_STAGE = 'resolve-and-gate';

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
export const ENGINE_BENCHMARK_SCOPE_PREDICATES: ReadonlyArray<{
  scope: string;
  filter: Record<string, unknown>;
}> = [
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
];

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
  for (const { scope, filter } of ENGINE_BENCHMARK_SCOPE_PREDICATES) {
    const docs = await ResearchEntity.find(filter).sort({ _id: 1 }).limit(options.perScopeLimit);
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
      gateInput: plan?.gateInput ?? null,
      capturedTier: plan?.tier,
      capturedReasons: plan?.reasons ?? [],
    });
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
    { upsert: true, new: true },
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

  const knownPersonSurnames = new Set<string>((benchmark as any).knownPersonSurnames ?? []);
  const capturedInvalidatedRuns = [...((benchmark as any).invalidatedScrapeRunIds ?? [])].sort();
  const liveInvalidatedRuns = [...(await invalidatedScrapeRunIds())].sort();
  let cardSynthesisRequested = 0;

  const rows: ReplayedRow[] = [];
  for (const captured of capturedRows) {
    const missesBefore = frozen.recordedMisses().length;
    const result = await materializeEntity(
      String((benchmark as any).entityType) as never,
      { entityKey: captured.entityKey },
      {
        dryRun: true,
        chunkPrefetch: frozen,
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
