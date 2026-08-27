import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';
import { initializeConnections } from '../../db/connections';
import { ResearchEntity } from '../../models/researchEntity';
import { planStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { resolveSafeJsonReportOutputPath } from '../scriptWriteGuards';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { buildChurnMetrics, scoreAccuracy, type ScorableEntity } from './pipelineEvalMetrics';
import {
  scoreDescriptionStrategy,
  scoreDedupeStrategy,
  collectSynthesisTargets,
  synthesizeCardShort,
  type EvalEntity,
  type DescriptionObservation,
  type SynthesisCache,
} from './pipelineEvalStrategies';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

interface EvalArgs {
  scope: string;
  limit?: number;
  sample?: number;
  llm: boolean;
  gate: boolean;
  concurrency: number;
  trial: number;
  output?: string;
}

function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = { scope: 'all', llm: false, gate: false, concurrency: 6, trial: 1 };
  for (const token of argv) {
    if (token.startsWith('--scope=')) args.scope = token.slice('--scope='.length);
    else if (token.startsWith('--limit=')) args.limit = Number(token.slice('--limit='.length));
    else if (token.startsWith('--sample=')) args.sample = Number(token.slice('--sample='.length));
    else if (token === '--llm') args.llm = true;
    else if (token === '--gate') args.gate = true;
    else if (token.startsWith('--concurrency='))
      args.concurrency = Number(token.slice('--concurrency='.length));
    else if (token.startsWith('--trial=')) args.trial = Number(token.slice('--trial='.length));
    else if (token.startsWith('--output=')) args.output = token.slice('--output='.length);
  }
  return args;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

const ENTITY_FIELDS =
  'slug name entityType kind fullDescription shortDescription researchAreas sourceUrls websiteUrl studentVisibilityTier canonicalGroupId archived inferredPiUserId departments';

function scopeFilter(args: EvalArgs): Record<string, unknown> {
  if (args.scope.startsWith('school:')) {
    const school = args.scope.slice('school:'.length);
    return { $or: [{ school }, { schools: school }] };
  }
  return {};
}

function toEvalEntity(doc: Record<string, any>): EvalEntity {
  return {
    id: String(doc._id),
    slug: doc.slug,
    name: doc.name,
    entityType: doc.entityType,
    kind: doc.kind,
    fullDescription: doc.fullDescription,
    shortDescription: doc.shortDescription,
    researchAreas: doc.researchAreas,
    sourceUrls: doc.sourceUrls,
    websiteUrl: doc.websiteUrl,
    studentVisibilityTier: doc.studentVisibilityTier,
    canonicalGroupId: doc.canonicalGroupId ? String(doc.canonicalGroupId) : null,
    archived: Boolean(doc.archived),
    inferredPiUserId: doc.inferredPiUserId ? String(doc.inferredPiUserId) : null,
    departments: doc.departments,
  };
}

function scorableFromEntity(e: EvalEntity): ScorableEntity {
  return {
    slug: e.slug,
    entityType: e.entityType,
    kind: e.kind,
    fullDescription: e.fullDescription,
    shortDescription: e.shortDescription,
    researchAreas: e.researchAreas,
    sourceUrls: e.sourceUrls,
    websiteUrl: e.websiteUrl,
    studentVisibilityTier: e.studentVisibilityTier,
    canonicalGroupId: e.canonicalGroupId ?? undefined,
    archived: e.archived,
  };
}

async function loadDescriptionObservations(
  liveSlugs: Set<string>,
  liveIds: Set<string>,
): Promise<Map<string, DescriptionObservation[]>> {
  const objectIds = Array.from(liveIds)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const entityMatch: Record<string, unknown>[] = [];
  if (liveSlugs.size > 0) entityMatch.push({ entityKey: { $in: Array.from(liveSlugs) } });
  if (objectIds.length > 0) entityMatch.push({ entityId: { $in: objectIds } });
  if (entityMatch.length === 0) return new Map();

  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  const cursor = db.collection('observations').find(
    {
      entityType: 'researchEntity',
      field: { $in: ['fullDescription', 'shortDescription'] },
      $or: entityMatch,
    },
    {
      projection: {
        entityKey: 1,
        entityId: 1,
        field: 1,
        value: 1,
        sourceName: 1,
        confidence: 1,
        observedAt: 1,
        superseded: 1,
      },
    },
  );
  const byEntity = new Map<string, DescriptionObservation[]>();
  for await (const raw of cursor) {
    const key = raw.entityKey || (raw.entityId ? String(raw.entityId) : undefined);
    if (!key) continue;
    const obs: DescriptionObservation = {
      entityKey: raw.entityKey,
      entityId: raw.entityId ? String(raw.entityId) : undefined,
      field: raw.field,
      value: raw.value,
      sourceName: raw.sourceName ?? 'unknown',
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
      observedAt: raw.observedAt instanceof Date ? raw.observedAt : new Date(raw.observedAt ?? 0),
      superseded: Boolean(raw.superseded),
    };
    const arr = byEntity.get(key) ?? [];
    arr.push(obs);
    byEntity.set(key, arr);
  }
  return byEntity;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  const dbLabel = db.databaseName ?? 'unknown';
  const filter = scopeFilter(args);

  const loadStart = Date.now();
  const liveMatch = { ...filter, archived: { $ne: true } };
  let liveDocs: Record<string, any>[];
  if (args.sample && Number.isFinite(args.sample)) {
    const projection = Object.fromEntries(ENTITY_FIELDS.split(' ').map((f) => [f, 1]));
    liveDocs = (await ResearchEntity.aggregate([
      { $match: liveMatch },
      { $sample: { size: args.sample } },
      { $project: { ...projection, _id: 1 } },
    ])) as Record<string, any>[];
  } else {
    const liveQuery = ResearchEntity.find(liveMatch).select(ENTITY_FIELDS).lean();
    if (args.limit && Number.isFinite(args.limit)) liveQuery.limit(args.limit);
    liveDocs = (await liveQuery) as Record<string, any>[];
  }
  const liveEntities = liveDocs.map(toEvalEntity);

  const allDocs = (await ResearchEntity.find(filter).select(ENTITY_FIELDS).lean()) as Record<
    string,
    any
  >[];
  const allEntities = allDocs.map(toEvalEntity);

  const liveSlugs = new Set(liveEntities.map((e) => e.slug).filter(Boolean) as string[]);
  const liveIds = new Set(liveEntities.map((e) => e.id));
  const obsByEntity = await loadDescriptionObservations(liveSlugs, liveIds);
  const loadMs = Date.now() - loadStart;

  const synthCache: SynthesisCache | undefined = args.llm ? new Map() : undefined;
  let synthTargets = 0;
  let synthResolvedNonEmpty = 0;
  let synthErrors = 0;
  let synthMs = 0;
  if (args.llm && synthCache) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('--llm requires OPENAI_API_KEY');
    const targets = collectSynthesisTargets(liveEntities, obsByEntity);
    synthTargets = targets.length;
    const synthStart = Date.now();
    await runWithConcurrency(targets, args.concurrency, async (target) => {
      try {
        const short = await synthesizeCardShort(target, apiKey);
        synthCache.set(target.fullText, short);
        if (short) synthResolvedNonEmpty += 1;
      } catch {
        synthErrors += 1;
        synthCache.set(target.fullText, '');
      }
    });
    synthMs = Date.now() - synthStart;
  }

  // C0 - status quo baseline: score the stored collection as-is.
  const c0Start = Date.now();
  const c0Accuracy = scoreAccuracy(liveEntities.map(scorableFromEntity));
  const c0Ms = Date.now() - c0Start;

  // C2 - decide-late: resolve descriptions over the full retained observation set.
  const c2Start = Date.now();
  const c2 = scoreDescriptionStrategy(liveEntities, obsByEntity, synthCache);
  const c2Ms = Date.now() - c2Start;

  // C1 - prevention-first: cluster by identity keys; score dedup vs known merges.
  // basic = URL+PI+org keys (trial 1/2); rich = + name, name+dept, ORCID-via-PI (C4).
  const orcidByUserId = new Map<string, string>();
  for await (const user of db
    .collection('users')
    .find({ orcid: { $type: 'string' } }, { projection: { orcid: 1 } })) {
    const orcid = String((user as Record<string, any>).orcid).trim();
    if (orcid) orcidByUserId.set(String((user as Record<string, any>)._id), orcid);
  }
  const c1Start = Date.now();
  const c1Basic = scoreDedupeStrategy(allEntities);
  const c1 = scoreDedupeStrategy(allEntities, { rich: true, orcidByUserId });
  const survivorIdSet = new Set(c1.survivorEntityIds);
  const survivorLive = liveEntities.filter((e) => survivorIdSet.has(e.id));
  const c1Accuracy = scoreAccuracy(survivorLive.map(scorableFromEntity));
  const c1Ms = Date.now() - c1Start;

  // C3 - hybrid: C1 dedup survivors, then C2 late description resolution on survivors.
  const c3Start = Date.now();
  const c3 = scoreDescriptionStrategy(survivorLive, obsByEntity, synthCache);
  const c3Ms = Date.now() - c3Start;

  const DESCRIPTION_BLOCKERS = new Set([
    'thin_description',
    'missing_description',
    'missing_card_description',
    'profile_fallback_only',
  ]);
  const DUPLICATE_BLOCKERS = new Set(['duplicate_risk', 'exact_url_duplicate_risk']);
  const LEAD_BLOCKERS = new Set(['missing_lead', 'pi_identity_conflict', 'profile_identity_risk']);
  const HARD_BLOCKERS = new Set([
    ...DUPLICATE_BLOCKERS,
    ...LEAD_BLOCKERS,
    'content_page_risk',
    'non_research_entity',
    'research_infrastructure_only',
    'inactive_at_yale',
    'generic_directory_shell',
    'profile_biography_shell',
    'non_owner_grant_shell',
    'lab_name_org_type_mismatch',
    'missing_alternate_access_path',
  ]);

  let gate:
    | {
        scored: number;
        tierMatchRate: number;
        notReady: number;
        descriptionAddressable: number;
        duplicateBlocked: number;
        leadBlocked: number;
        otherHardBlocked: number;
      }
    | undefined;
  if (args.gate) {
    const plans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: liveEntities.map((e) => e.id),
    });
    let tierMatch = 0;
    let notReady = 0;
    let descriptionAddressable = 0;
    let duplicateBlocked = 0;
    let leadBlocked = 0;
    let otherHardBlocked = 0;
    const storedTierById = new Map(liveEntities.map((e) => [e.id, e.studentVisibilityTier]));
    for (const plan of plans) {
      if (plan.computedTier === storedTierById.get(plan.recordId)) tierMatch += 1;
      if (plan.computedTier === 'student_ready') continue;
      notReady += 1;
      const reasons = plan.reasons ?? [];
      const hasDescription = reasons.some((r) => DESCRIPTION_BLOCKERS.has(r));
      const hasHard = reasons.some((r) => HARD_BLOCKERS.has(r));
      if (hasDescription && !hasHard) descriptionAddressable += 1;
      else if (reasons.some((r) => DUPLICATE_BLOCKERS.has(r))) duplicateBlocked += 1;
      else if (reasons.some((r) => LEAD_BLOCKERS.has(r))) leadBlocked += 1;
      else otherHardBlocked += 1;
    }
    gate = {
      scored: plans.length,
      tierMatchRate: plans.length === 0 ? 0 : Number((tierMatch / plans.length).toFixed(4)),
      notReady,
      descriptionAddressable,
      duplicateBlocked,
      leadBlocked,
      otherHardBlocked,
    };
  }

  const globalChurn = {
    redirects: await db.collection('research_entity_redirects').estimatedDocumentCount(),
    releaseQueueItems: await db
      .collection('visibility_release_queue_items')
      .estimatedDocumentCount(),
    referenceRepairAudits: await db
      .collection('observation_reference_repair_audits')
      .estimatedDocumentCount(),
  };
  const fullCorpusLiveCount = allEntities.filter((e) => !e.archived).length;
  const c0Churn = buildChurnMetrics({
    liveEntityCount: fullCorpusLiveCount,
    redirects: globalChurn.redirects,
    shellsWithCanonicalGroup: allEntities.filter((e) => !e.archived && e.canonicalGroupId).length,
    archivedMerged: allEntities.filter((e) => e.archived && e.canonicalGroupId).length,
    releaseQueueItems: globalChurn.releaseQueueItems,
    referenceRepairAudits: globalChurn.referenceRepairAudits,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    trial: args.trial,
    db: dbLabel,
    scope: args.scope,
    selection: args.sample
      ? `random-sample:${args.sample}`
      : args.limit
        ? `first:${args.limit}`
        : 'all',
    llmEnabled: args.llm,
    corpus: {
      liveEntities: liveEntities.length,
      allEntitiesInclArchived: allEntities.length,
      descriptionObservationEntities: obsByEntity.size,
      loadMs,
    },
    synthesis: args.llm
      ? {
          model: 'gpt-5-mini',
          targetFullTexts: synthTargets,
          resolvedNonEmpty: synthResolvedNonEmpty,
          errors: synthErrors,
          synthMs,
          note: 'gpt-5-mini invoked only where deterministic derivation failed; actual LLM calls <= targetFullTexts.',
        }
      : undefined,
    notes: [
      args.llm
        ? 'C2/C3 synthesize a grounded short via gpt-5-mini where no useful short exists (same path as the materializer), applied to BOTH active-only and full-retained projections so the delta stays fair.'
        : 'No LLM: all strategies draw text from the retained observation log only.',
      'C2/C3 differ from C0 by resolving descriptions over the FULL retained set (active + superseded), quality-preferring; C0 is the stored materialized collection.',
      'studentReady counts reflect the STORED tier and are not recomputed for C2/C3 (tier needs gate roster/signal context); the description-axis metric is cardCompleteRate + cardRecovered.',
      'C1 dedup precision has no labeled negative set; newMergeSamePi vs newMergeDifferentPiOrUnknown is an approximate precision proxy for predicted-new merges.',
    ],
    gateBlockerBreakdown: gate,
    strategies: {
      C0: {
        label: 'status-quo baseline (stored collection)',
        efficiencyMs: c0Ms,
        entityCount: c0Accuracy.entityCount,
        cardCompleteRate: c0Accuracy.cardCompleteRate,
        studentReadyRate: c0Accuracy.studentReadyRate,
        byTier: c0Accuracy.byTier,
        churn: c0Churn,
      },
      C1: {
        label: 'prevention-first resolver (resolve-at-mint, identity clustering)',
        efficiencyMs: c1Ms,
        keyLift: {
          basic: {
            recall: c1Basic.recall,
            avoidedMints: c1Basic.avoidedMints,
            predictedNewMergePairs: c1Basic.predictedNewMergePairs,
          },
          rich: {
            recall: c1.recall,
            avoidedMints: c1.avoidedMints,
            predictedNewMergePairs: c1.predictedNewMergePairs,
          },
          recallDelta: Number((c1.recall - c1Basic.recall).toFixed(4)),
          avoidedMintsDelta: c1.avoidedMints - c1Basic.avoidedMints,
        },
        dedupe: {
          entitiesConsidered: c1.entitiesConsidered,
          groundTruthMergedPairs: c1.groundTruthMergedPairs,
          groundTruthCaught: c1.groundTruthCaught,
          recall: c1.recall,
          avoidedMints: c1.avoidedMints,
          predictedClusters: c1.predictedClusters,
          predictedNewMergePairs: c1.predictedNewMergePairs,
          newMergeSamePi: c1.newMergeSamePi,
          newMergeDifferentPiOrUnknown: c1.newMergeDifferentPiOrUnknown,
        },
        survivorEntityCount: c1Accuracy.entityCount,
        cardCompleteRate: c1Accuracy.cardCompleteRate,
        studentReadyRate: c1Accuracy.studentReadyRate,
      },
      C2: {
        label: 'decide-late projection (quality-preferring resolve over full retained log)',
        efficiencyMs: c2Ms,
        entityCount: c2.accuracy.entityCount,
        entitiesWithObservations: c2.entitiesWithObservations,
        cardCompleteRate_fullRetained: c2.accuracy.cardCompleteRate,
        cardCompleteRate_activeOnly: c2.activeOnlyCardCompleteRate,
        cardCompleteRate_storedMaterialized: c0Accuracy.cardCompleteRate,
        changedFromActiveOnly: c2.changedFromActiveOnly,
        cardRecovered: c2.cardRecovered,
        cardRegressed: c2.cardRegressed,
        cardRecoveredAmongNotReady: c2.cardRecoveredAmongNotReady,
      },
      C3: {
        label: 'hybrid (C1 dedup survivors + C2 late descriptions)',
        efficiencyMs: c1Ms + c3Ms,
        survivorEntityCount: c3.accuracy.entityCount,
        cardCompleteRate: c3.accuracy.cardCompleteRate,
        cardRecovered: c3.cardRecovered,
        cardRecoveredAmongNotReady: c3.cardRecoveredAmongNotReady,
        avoidedMints: c1.avoidedMints,
      },
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.error(`Report written to ${outputPath}`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run pipeline orchestration eval:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
