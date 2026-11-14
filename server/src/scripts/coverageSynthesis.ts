import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections, runScriptMain } from '../db/connections';
import { recordDevApplyIntent } from '../db/devWriteLease';
import { countConnectionDrops } from '../utils/mongooseConnectionWasOpened';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import {
  appendObservations,
  getSourceByName,
  retireObservations,
} from '../scrapers/observationStore';
import { contentHashObservation } from '../scrapers/contentHashGate';
import { resetDescriptionOwnershipCitersCache } from '../scrapers/descriptionOwnershipResolverScreen';
import {
  createDescriptionCardJudge,
  withServedCardForBody,
} from '../scrapers/descriptionCardRefreshGuard';
import {
  defaultMaterializerCardSynthesizer,
  materializationReadScopeFilter,
  materializeEntity,
} from '../scrapers/entityMaterializer';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import type { ServingRowContext } from '../scrapers/utils/fullDescriptionServingBar';
import { appendSynthesizedDescription } from './synthesizedDescriptionObservation';
import {
  REFUSED_REDRAFT_RETIRE_REASON_PREFIX,
  decideRefusedRedraftRetire,
  fallbackServesAfterRetire,
  refusedRedraftRetireReason,
  type RefusedRedraftRetireOutcome,
} from './refusedRedraftBodyRetire';
import {
  COVERAGE_CONFIDENCE,
  COVERAGE_SYNTHESIS_MODEL,
  WRITTEN_DESCRIPTION_SOURCE_NAME,
  adoptedWrittenBodyStillSupported,
  defaultCoverageSynthesisLLM,
  coverageSynthesisDecision,
  countCoverageSynthesisRefusals,
  type CoverageSynthesisDecision,
  type CoverageSnippet,
  type CoverageSynthesisRefusal,
  type CoverageSynthesisRefusalDetails,
  type CoverageSynthesisResult,
  type SynthesizeCoverageInput,
} from '../scrapers/coverageSynthesis';
import { COVERAGE_SYNTHESIS_PROMPT } from '../scrapers/prompts';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertCoverageSynthesisApplyAllowed,
  buildWriterEvidenceSnippetsWithMergedInFill,
  parseCoverageSynthesisArgs,
  planWriterStep,
  liveWrittenBody,
  reinstateStepFor,
  storedWriterEvidenceHash,
  writerStoredHashFor,
  writerObservationAnchors,
  writerWritesAfterBodyAttempt,
  writerWritesFor,
  writtenBodyCardRepairFilter,
  type ReinstateStep,
  type WriterStep,
  carriedOverWrites,
  assertWriterCacheModeAllowed,
  cardPassModeOf,
  coverageSynthesisModeOf,
  deferSearchIndexWritesWhenSkipping,
  writerModelClientFor,
  type CoverageSynthesisMode,
} from './coverageSynthesisCore';
import {
  loadIngestVerifiedRunIds,
  loadWriterEntitiesBySlug,
  WRITER_ENTITY_READ_PROJECTION,
  writerEntityRowOf,
  loadWebsiteUrlStatedByYaleSource,
  loadWriterObservations,
  loadWriterRowEvidence,
  writerLeadNames,
  writerServingRow,
  parseWriterEvidenceFile,
  readJsonInputFile,
  readSlugsFile,
  writerEvidenceFileOf,
  type WriterRowEvidence,
} from './coverageSynthesisEvidence';
import {
  runDerivationImport,
  runDerivationSupersede,
  runWriterEvaluation,
} from './coverageSynthesisEvaluate';
import {
  type CardRequest,
  collectCardRequests,
  parseCardRequests,
  parseImportedCardDrafts,
  runCardImport,
  runCardPass,
} from './cardSynthesisCore';
import {
  cachedCardFor,
  mongoCardSynthesisDerivationStore,
  type CardDraftFn,
} from '../scrapers/cardSynthesisDerivation';
import { CARD_SYNTHESIS_MODEL, defaultCardSynthesisLLM } from '../utils/groundedCardSynthesis';
import {
  mongoWrittenDescriptionDerivationStore,
  parseImportedWriterDrafts,
  resolveWrittenDescription,
  writerInputHash,
  writerModelThroughCache,
  WRITER_CONTRACT_VERSION,
  type WrittenDescriptionStep,
} from './writtenDescriptionDerivationCore';
import { regateRematerializedEntities } from './rematerializeResearchEntities';
import { listResearchEntityMergedInRowsBySurvivor } from '../services/researchEntityCanonicalTombstone';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SOURCE_NAME = WRITTEN_DESCRIPTION_SOURCE_NAME;
const RETIRE_REASON = 'written-description-no-longer-supported-by-evidence';
const REGATE_CHUNK = 500;
const ENTITY_READ_CHUNK = 200;

/**
 * Whether a row carries any live observation from the named scrape runs, read in the
 * materializer's own scope and through both identity forms of the row and of the rows merged
 * into it, so `--defer-materialize-for-runs` defers exactly the rows a materialize would read
 * that run's observations on.
 */
export async function rowHasObservationFromRuns(
  anchors: readonly Record<string, unknown>[],
  runIds: readonly string[],
): Promise<boolean> {
  if (anchors.length === 0 || runIds.length === 0) return false;
  return Boolean(
    await Observation.exists({
      ...materializationReadScopeFilter(),
      scrapeRunId: { $in: runIds.map((id) => new mongoose.Types.ObjectId(id)) },
      $or: [...anchors],
    }),
  );
}

const deferMaterialize = (report: CoverageEntityReport): void => {
  report.writerStep = report.step;
  report.step = 'materialize-deferred';
};

export interface CoverageEntityReport {
  slug: string;
  snippets: number;
  step?:
    | WriterStep
    | WrittenDescriptionStep
    | ReinstateStep
    | 'fullDescription-locked'
    | 'materialize-deferred';
  /** The writer's own step, kept when `step` records a deferred materialize. */
  writerStep?: string;
  modelCalled?: boolean;
  inputHash?: string;
  synthesized: boolean;
  written: boolean;
  adopted?: boolean;
  observationDropped?: boolean;
  observationDroppedBy?: string[];
  description?: string;
  sourceUrls?: string[];
  synthesisRefusal?: CoverageSynthesisRefusal;
  refusalDetails?: CoverageSynthesisRefusalDetails;
  refusedRedraftRetire?: RefusedRedraftRetireOutcome;
}

export async function synthesizeIntoCoverageReport(
  report: CoverageEntityReport,
  input: SynthesizeCoverageInput,
): Promise<CoverageSynthesisResult | null> {
  return (await synthesizeDecisionIntoCoverageReport(report, input)).result;
}

async function synthesizeDecisionIntoCoverageReport(
  report: CoverageEntityReport,
  input: SynthesizeCoverageInput,
): Promise<CoverageSynthesisDecision> {
  const decision = await coverageSynthesisDecision(input);
  if (!decision.result) {
    report.synthesisRefusal = decision.refusal ?? undefined;
    return decision;
  }
  report.synthesized = true;
  report.description = decision.result.description;
  report.sourceUrls = decision.result.sourceUrls;
  return decision;
}

export const summarizeCoverageSynthesisRefusals = (reports: CoverageEntityReport[]) =>
  countCoverageSynthesisRefusals(reports.map((report) => report.synthesisRefusal));

type EntityRow = Record<string, any>;

async function loadTargetEntities(args: ReturnType<typeof parseCoverageSynthesisArgs>) {
  const projection = WRITER_ENTITY_READ_PROJECTION;
  if (args.rederiveCards) {
    return (
      (await ResearchEntity.find({
        ...writtenBodyCardRepairFilter(SOURCE_NAME, { allWrittenRows: args.all }),
        ...(args.slugs.length > 0 ? { slug: { $in: args.slugs } } : {}),
      })
        .select(projection)
        .lean()) as EntityRow[]
    ).map(writerEntityRowOf);
  }
  if (args.slugs.length > 0) {
    return (
      (await ResearchEntity.find({ slug: { $in: args.slugs }, archived: { $ne: true } })
        .select(projection)
        .lean()) as EntityRow[]
    ).map(writerEntityRowOf);
  }
  const rows: EntityRow[] = [];
  let lastId: unknown;
  for (;;) {
    const filter: Record<string, unknown> = { archived: { $ne: true } };
    if (lastId) filter._id = { $gt: lastId };
    const remaining = args.all
      ? ENTITY_READ_CHUNK
      : Math.min(ENTITY_READ_CHUNK, args.limit - rows.length);
    if (remaining <= 0) break;
    const chunk = (await ResearchEntity.find(filter)
      .sort({ _id: 1 })
      .limit(remaining)
      .select(projection)
      .lean()) as EntityRow[];
    if (chunk.length === 0) break;
    rows.push(...chunk.map(writerEntityRowOf));
    lastId = chunk[chunk.length - 1]._id;
    if (chunk.length < remaining) break;
  }
  return rows;
}

export const WRITTEN_ROW_FIELDS = ['fullDescription', 'shortDescription'];

export function writtenRowMaterializeOptions(entityName: string) {
  return {
    dryRun: false,
    synthesizeCardDescription: defaultMaterializerCardSynthesizer(entityName),
    writeOnlyFields: [...WRITTEN_ROW_FIELDS],
  };
}

async function materializeWrittenRow(entity: EntityRow): Promise<string | undefined> {
  const materialized = await materializeEntity(
    'researchEntity',
    { entityKey: entity.slug },
    writtenRowMaterializeOptions(typeof entity.name === 'string' ? entity.name : ''),
  );
  return typeof materialized.entityId === 'string' ? materialized.entityId : undefined;
}

async function settleRefusedRedraftBody(input: {
  entity: EntityRow;
  anchors: Record<string, unknown>[];
  liveBody: string;
  snippets: CoverageSnippet[];
  refusal: CoverageSynthesisRefusal;
  leadPersonName: string;
  apply: boolean;
  report: CoverageEntityReport;
  materializedEntityIds: string[];
}): Promise<void> {
  const { entity, liveBody, report } = input;
  const adoptedBodyStillSupported = adoptedWrittenBodyStillSupported({
    body: liveBody,
    snippets: input.snippets,
    researchAreas: entity.researchAreas,
    entityType: entity.entityType,
  });
  const adopted = adoptedBodyStillSupported
    ? null
    : ((await Observation.findOne({
        entityType: 'researchEntity',
        ...materializationReadScopeFilter(),
        sourceName: SOURCE_NAME,
        field: 'fullDescription',
        value: liveBody,
        $or: input.anchors,
      })
        .select('_id')
        .lean()) as { _id: unknown } | null);
  let fallbackServes = false;
  if (adopted) {
    const planned = await materializeEntity(
      'researchEntity',
      { entityKey: entity.slug },
      {
        dryRun: true,
        writeOnlyFields: [...WRITTEN_ROW_FIELDS],
        treatObservationIdsAsRetired: new Set([String(adopted._id)]),
      },
    );
    fallbackServes = fallbackServesAfterRetire({
      entityDoc: entity,
      plannedSet: planned.plannedSet,
      plannedUnset: planned.plannedUnset,
      retiredBody: liveBody,
      leadPersonName: input.leadPersonName,
    });
  }
  const outcome = decideRefusedRedraftRetire({
    adoptedBodyStillSupported: adoptedBodyStillSupported || !adopted,
    fallbackServes,
  });
  report.refusedRedraftRetire = outcome;
  if (outcome !== 'retire-with-fallback' || !input.apply || !adopted) return;
  await retireObservations(
    { _id: adopted._id },
    refusedRedraftRetireReason(WRITER_CONTRACT_VERSION, input.refusal),
  );
  const materializedId = await materializeWrittenRow(entity);
  if (materializedId) input.materializedEntityIds.push(materializedId);
}

async function servesWrittenBody(entityId: string): Promise<boolean> {
  const fresh = (await ResearchEntity.findById(entityId)
    .select('fullDescription fieldProvenance.fullDescription.sourceName')
    .lean()) as { fullDescription?: unknown; fieldProvenance?: any } | null;
  return (
    fresh?.fieldProvenance?.fullDescription?.sourceName === SOURCE_NAME &&
    typeof fresh?.fullDescription === 'string' &&
    fresh.fullDescription.trim().length > 0
  );
}

interface CardRederivationReport {
  slug: string;
  cardPlanned?: boolean;
  error?: boolean;
}

async function cardAfterMaterialize(
  materialized: Awaited<ReturnType<typeof materializeEntity>>,
  storedCard: unknown,
  applied: boolean,
): Promise<unknown> {
  if (!applied) {
    if (Object.hasOwn(materialized.plannedSet ?? {}, 'shortDescription')) {
      return materialized.plannedSet?.shortDescription;
    }
    return Object.hasOwn(materialized.plannedUnset ?? {}, 'shortDescription')
      ? undefined
      : storedCard;
  }
  if (typeof materialized.entityId !== 'string') return storedCard;
  const fresh = (await ResearchEntity.findById(materialized.entityId)
    .select('shortDescription')
    .lean()) as { shortDescription?: unknown } | null;
  return fresh?.shortDescription;
}

async function rederiveWrittenBodyCards(
  entities: EntityRow[],
  args: ReturnType<typeof parseCoverageSynthesisArgs>,
  dbLabel: string,
): Promise<void> {
  const reports: CardRederivationReport[] = [];
  const materializedEntityIds: string[] = [];
  await mapWithConcurrency(entities, args.concurrency, async (entity) => {
    const report: CardRederivationReport = { slug: entity.slug };
    reports.push(report);
    try {
      const options = writtenRowMaterializeOptions(
        typeof entity.name === 'string' ? entity.name : '',
      );
      const materialized = await materializeEntity(
        'researchEntity',
        { entityKey: entity.slug },
        { ...options, dryRun: !args.apply },
      );
      report.cardPlanned =
        (await cardAfterMaterialize(materialized, entity.shortDescription, args.apply)) !==
        entity.shortDescription;
      if (args.apply && typeof materialized.entityId === 'string') {
        materializedEntityIds.push(materialized.entityId);
      }
    } catch (error) {
      report.error = true;
      console.error(`[coverage-synthesis] ${entity.slug}: ${sanitizeLogValue(error)}`);
    }
  });
  const regates = [];
  for (let index = 0; index < materializedEntityIds.length; index += REGATE_CHUNK) {
    regates.push(
      await regateRematerializedEntities(materializedEntityIds.slice(index, index + REGATE_CHUNK)),
    );
  }
  const errors = reports.filter((report) => report.error).length;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: dbLabel,
    scope: 'rederive-cards',
    scanned: reports.length,
    cardPlanned: reports.filter((entry) => entry.cardPlanned).length,
    entityErrors: errors,
    regated: regates.reduce((sum, entry) => sum + entry.scopedEntities, 0),
    tierChanged: regates.reduce((sum, entry) => sum + entry.tierChanged, 0),
    tierTransitions: regates.flatMap((entry) => entry.tierTransitions),
    indexSyncFailures: regates.reduce((sum, entry) => sum + entry.indexSyncFailures, 0),
    indexSyncSkipped: regates.reduce((sum, entry) => sum + entry.indexSyncDeferred, 0),
    entities: reports,
  };
  console.log(
    JSON.stringify(
      {
        ...report,
        tierTransitions: report.tierTransitions.length,
        entities: `${reports.length} rows`,
      },
      null,
      2,
    ),
  );
  if (args.output) {
    fs.writeFileSync(resolveSafeJsonReportOutputPath(args.output), JSON.stringify(report, null, 2));
  }
  if (errors > 0) process.exitCode = 1;
}

type ReadOnlyMode = Exclude<CoverageSynthesisMode, 'write' | 'print-writer-prompt'>;

function namedSlugs(args: ReturnType<typeof parseCoverageSynthesisArgs>): string[] {
  return [...new Set([...args.slugs, ...(args.slugsFile ? readSlugsFile(args.slugsFile) : [])])];
}

async function rowEvidenceFor(
  args: ReturnType<typeof parseCoverageSynthesisArgs>,
  slugs: string[],
): Promise<{ rows: WriterRowEvidence[]; missingSlugs: string[]; evidenceNow: Date }> {
  if (args.evidenceFile) {
    const file = parseWriterEvidenceFile(readJsonInputFile(args.evidenceFile, '--evidence-file'));
    const wanted = new Set(slugs);
    const rows = slugs.length > 0 ? file.rows.filter((row) => wanted.has(row.slug)) : file.rows;
    const present = new Set(rows.map((row) => row.slug));
    return {
      rows,
      missingSlugs: slugs.filter((slug) => !present.has(slug)),
      evidenceNow: new Date(file.capturedAt),
    };
  }
  const entities = await loadWriterEntitiesBySlug(slugs);
  const rows = await loadWriterRowEvidence(entities, await loadIngestVerifiedRunIds());
  const present = new Set(rows.map((row) => row.slug));
  return {
    rows,
    missingSlugs: slugs.filter((slug) => !present.has(slug)),
    evidenceNow: new Date(),
  };
}

function writeJsonReport(output: string, flag: string, value: unknown): void {
  fs.writeFileSync(resolveSafeJsonReportOutputPath(output, flag), JSON.stringify(value, null, 2));
}

async function withServingRows(requests: readonly CardRequest[]): Promise<CardRequest[]> {
  const unjudgeable = requests.filter((request) => !request.servingRow);
  if (unjudgeable.length === 0) return [...requests];
  const entities = await loadWriterEntitiesBySlug([
    ...new Set(unjudgeable.map((request) => request.slug)),
  ]);
  const servingRowBySlug = new Map<string, ServingRowContext>();
  for (const entity of entities) {
    servingRowBySlug.set(
      entity.slug,
      writerServingRow({ entity, leadNames: await writerLeadNames(entity._id) }),
    );
  }
  return requests.map((request) => {
    const servingRow = request.servingRow ?? servingRowBySlug.get(request.slug);
    return servingRow ? { ...request, servingRow } : request;
  });
}

async function runCardPassMode(
  args: ReturnType<typeof parseCoverageSynthesisArgs>,
  dbLabel: string,
): Promise<void> {
  const cardMode = cardPassModeOf(args);
  const slugs = namedSlugs(args);
  const wanted = new Set(slugs);
  const requests = args.evidenceFile
    ? parseCardRequests(readJsonInputFile(args.evidenceFile, '--evidence-file')).filter(
        (request) => wanted.size === 0 || wanted.has(request.slug),
      )
    : await collectCardRequests(await loadWriterEntitiesBySlug(slugs));
  const summary = { mode: 'synthesize-cards', cardMode, db: dbLabel, requests: requests.length };
  if (cardMode === 'capture-evidence') {
    writeJsonReport(args.captureEvidence as string, '--capture-evidence', requests);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const store = mongoCardSynthesisDerivationStore;
  if (cardMode === 'import-derivations') {
    if (!args.output)
      throw new Error(
        'research-entity:coverage-synthesis --synthesize-cards --import-derivations requires --output',
      );
    const report = await runCardImport({
      requests: await withServingRows(requests),
      drafts: parseImportedCardDrafts(
        readJsonInputFile(args.importDerivations as string, '--import-derivations'),
      ),
      store,
      validateOnly: args.validateOnly,
    });
    writeJsonReport(args.output, '--output', {
      ...summary,
      validateOnly: args.validateOnly,
      ...report,
    });
    console.log(
      JSON.stringify({ ...summary, stored: report.stored, byReason: report.byReason }, null, 2),
    );
    return;
  }
  let callLLM: CardDraftFn | null = null;
  if (cardMode === 'evaluate') {
    if (!args.output)
      throw new Error(
        'research-entity:coverage-synthesis --synthesize-cards --evaluate requires --output',
      );
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey)
      throw new Error(
        'research-entity:coverage-synthesis --synthesize-cards --evaluate requires OPENAI_API_KEY',
      );
    callLLM = (llmInput) =>
      defaultCardSynthesisLLM({ ...llmInput, apiKey, model: CARD_SYNTHESIS_MODEL });
  }
  const report = await runCardPass({ requests, store, callLLM, concurrency: args.concurrency });
  if (args.output) writeJsonReport(args.output, '--output', { ...summary, ...report });
  console.log(
    JSON.stringify({ ...summary, modelCalls: report.modelCalls, byStep: report.byStep }, null, 2),
  );
}

async function runSupersedeDraftMode(
  args: ReturnType<typeof parseCoverageSynthesisArgs>,
  dbLabel: string,
): Promise<void> {
  const [slug] = args.slugs;
  const drafts = parseImportedWriterDrafts(
    readJsonInputFile(args.importDerivations as string, '--import-derivations'),
  );
  const { rows, evidenceNow } = await rowEvidenceFor(args, [slug]);
  const report = await runDerivationSupersede({
    slug,
    rows,
    drafts,
    store: mongoWrittenDescriptionDerivationStore,
    evidenceNow,
    apply: args.apply,
    reason: args.reason ?? '',
    decidedBy: args.decidedBy ?? '',
  });
  const summary = { mode: 'supersede-draft', db: dbLabel, ...report };
  if (args.output) writeJsonReport(args.output, '--output', summary);
  console.log(JSON.stringify(summary, null, 2));
  if (report.blockedBy) process.exitCode = 1;
}

async function runReadOnlyMode(
  mode: ReadOnlyMode,
  args: ReturnType<typeof parseCoverageSynthesisArgs>,
  dbLabel: string,
): Promise<void> {
  if (mode === 'synthesize-cards') {
    await runCardPassMode(args, dbLabel);
    return;
  }
  if (mode === 'capture-evidence') {
    const slugs = namedSlugs(args);
    const { rows, missingSlugs, evidenceNow } = await rowEvidenceFor(args, slugs);
    writeJsonReport(
      args.captureEvidence as string,
      '--capture-evidence',
      writerEvidenceFileOf(rows, evidenceNow, dbLabel),
    );
    console.log(
      JSON.stringify({ mode, db: dbLabel, captured: rows.length, missingSlugs }, null, 2),
    );
    return;
  }
  if (mode === 'supersede-draft') {
    await runSupersedeDraftMode(args, dbLabel);
    return;
  }
  if (!args.output)
    throw new Error(`research-entity:coverage-synthesis --${mode} requires --output`);
  const store = mongoWrittenDescriptionDerivationStore;
  if (mode === 'import-derivations') {
    const drafts = parseImportedWriterDrafts(
      readJsonInputFile(args.importDerivations as string, '--import-derivations'),
    );
    const { rows, evidenceNow } = await rowEvidenceFor(args, [
      ...new Set(drafts.map((draft) => draft.slug)),
    ]);
    const report = await runDerivationImport({
      rows,
      drafts,
      store,
      evidenceNow,
      validateOnly: args.validateOnly,
    });
    writeJsonReport(args.output, '--output', { mode, db: dbLabel, ...report });
    console.log(
      JSON.stringify(
        { mode, db: dbLabel, byOutcome: report.byOutcome, stored: report.stored },
        null,
        2,
      ),
    );
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !args.cacheOnly)
    throw new Error('research-entity:coverage-synthesis --evaluate requires OPENAI_API_KEY');
  const { rows, missingSlugs, evidenceNow } = await rowEvidenceFor(args, namedSlugs(args));
  const report = await runWriterEvaluation({
    rows,
    missingSlugs,
    store,
    cacheOnly: args.cacheOnly,
    drafting:
      args.cacheOnly || !apiKey
        ? null
        : writerModelThroughCache({
            callLLM: defaultCoverageSynthesisLLM(
              apiKey,
              COVERAGE_SYNTHESIS_MODEL,
              undefined,
              'coverage-synthesis-evaluate',
            ),
            store,
          }),
    evidenceNow,
    concurrency: args.concurrency,
    log: (message) => console.error(message),
  });
  writeJsonReport(args.output, '--output', {
    generatedAt: new Date().toISOString(),
    mode,
    db: dbLabel,
    evidence: args.evidenceFile ? 'evidence-file' : 'live',
    ...report,
  });
  console.log(
    JSON.stringify(
      { mode, db: dbLabel, modelCalls: report.modelCalls, byStep: report.byStep },
      null,
      2,
    ),
  );
}

export async function runCoverageSynthesis(argv: string[] = process.argv.slice(2)) {
  const args = parseCoverageSynthesisArgs(argv);
  const mode = coverageSynthesisModeOf(args);
  if (mode === 'print-writer-prompt') {
    process.stdout.write(`${COVERAGE_SYNTHESIS_PROMPT}\n`);
    return;
  }
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:coverage-synthesis',
    mongoUrl: process.env.MONGODBURL,
  });
  if (mode !== 'write') {
    const { writesDevelopmentCache } = assertWriterCacheModeAllowed(mode, guard.dbLabel, args);
    if (writesDevelopmentCache) recordDevApplyIntent('research-entity:coverage-synthesis');
    await initializeConnections();
    await runReadOnlyMode(mode, args, guard.dbLabel);
    return;
  }
  assertCoverageSynthesisApplyAllowed(args, guard.dbLabel);

  deferSearchIndexWritesWhenSkipping(args);
  const callLLM = writerModelClientFor({
    apply: args.apply && !args.reinstateRetiredBodies && !args.cacheOnly,
    apiKey: process.env.OPENAI_API_KEY,
    create: defaultCoverageSynthesisLLM,
  });
  const store = mongoWrittenDescriptionDerivationStore;
  const drafting = callLLM ? writerModelThroughCache({ callLLM, store }) : null;

  await initializeConnections();
  const connectionDrops = countConnectionDrops();

  const entities = await loadTargetEntities(args);
  const verifiedRunIds = await loadIngestVerifiedRunIds();
  if (args.rederiveCards) {
    await rederiveWrittenBodyCards(entities, args, guard.dbLabel);
    return;
  }
  const mergedInBySurvivor = await listResearchEntityMergedInRowsBySurvivor(
    entities.map((entity) => entity._id),
  );
  const source = args.apply ? await getSourceByName(SOURCE_NAME) : null;
  if (args.apply && !source) {
    throw new Error(
      `research-entity:coverage-synthesis apply requires the '${SOURCE_NAME}' source to be seeded`,
    );
  }
  const runId = new mongoose.Types.ObjectId().toString();
  const context = source
    ? {
        scrapeRunId: runId,
        sourceId: source._id,
        sourceName: SOURCE_NAME,
        sourceWeight: COVERAGE_CONFIDENCE,
        dryRun: false,
      }
    : null;

  const reports: CoverageEntityReport[] = [];
  const cardRequests: CardRequest[] = [];
  const materializedEntityIds: string[] = [];
  let written = 0;
  let observationDropped = 0;
  let adopted = 0;
  let entityErrors = 0;

  await mapWithConcurrency(entities, args.concurrency, async (entity) => {
    const report: CoverageEntityReport = {
      slug: entity.slug,
      snippets: 0,
      synthesized: false,
      written: false,
    };
    reports.push(report);
    const locked: string[] = Array.isArray(entity.manuallyLockedFields)
      ? entity.manuallyLockedFields
      : [];
    if (locked.includes('fullDescription')) {
      report.step = 'fullDescription-locked';
      return;
    }
    const anchors = writerObservationAnchors({ entityKey: entity.slug, entityId: entity._id });
    const observations = await loadWriterObservations(anchors, verifiedRunIds);
    const mergedInAnchors = (mergedInBySurvivor.get(String(entity._id)) ?? []).flatMap((row) =>
      writerObservationAnchors({ entityKey: row.slug, entityId: row._id }),
    );
    const leadNames = await writerLeadNames(entity._id);
    const snippets = await buildWriterEvidenceSnippetsWithMergedInFill(
      observations,
      () => loadWriterObservations(mergedInAnchors, verifiedRunIds),
      entity.recentGrants,
      {
        websiteUrl: entity.websiteUrl,
        fieldValueRefusals: entity.fieldValueRefusals,
        entityType: entity.entityType,
        kind: entity.kind,
        identity: entity,
        leadNames,
        websiteUrlStatedByYaleSource: await loadWebsiteUrlStatedByYaleSource(
          anchors,
          entity.websiteUrl,
        ),
      },
    );
    report.snippets = snippets.length;
    if (args.reinstateRetiredBodies) {
      const retired = (await Observation.findOne({
        entityType: 'researchEntity',
        sourceName: SOURCE_NAME,
        field: 'fullDescription',
        $and: [
          {
            $or: [
              { 'rollback.reason': RETIRE_REASON },
              { 'rollback.reason': { $regex: `^${REFUSED_REDRAFT_RETIRE_REASON_PREFIX}:` } },
            ],
          },
        ],
        $or: anchors,
      })
        .sort({ observedAt: -1 })
        .select('_id value')
        .lean()) as { _id: unknown; value?: unknown } | null;
      const retiredBody = typeof retired?.value === 'string' ? retired.value : undefined;
      const reinstate = reinstateStepFor({
        liveBody: liveWrittenBody(observations, SOURCE_NAME),
        retiredBody,
        retiredBodyStillSupported: adoptedWrittenBodyStillSupported({
          body: retiredBody,
          snippets,
          researchAreas: entity.researchAreas,
          entityType: entity.entityType,
        }),
      });
      report.step = reinstate;
      if (reinstate !== 'reinstated' || !args.apply || !retired) return;
      try {
        await Observation.updateOne(
          { _id: retired._id },
          { $set: { superseded: false }, $unset: { rollback: '' } },
        );
        resetDescriptionOwnershipCitersCache();
        if (
          await rowHasObservationFromRuns(
            [...anchors, ...mergedInAnchors],
            args.deferMaterializeForRuns,
          )
        ) {
          deferMaterialize(report);
          return;
        }
        const materializedId = await materializeWrittenRow(entity);
        if (!materializedId) return;
        materializedEntityIds.push(materializedId);
        report.adopted = await servesWrittenBody(materializedId);
        if (report.adopted) adopted += 1;
      } catch (error) {
        entityErrors += 1;
        console.error(`[coverage-synthesis] ${entity.slug}: ${sanitizeLogValue(error)}`);
      }
      return;
    }
    const storedHash = writerStoredHashFor(
      args,
      storedWriterEvidenceHash(observations, SOURCE_NAME),
    );
    const planned = planWriterStep({ snippets, storedHash, freshHash: writerInputHash(snippets) });
    report.step = planned;
    if (planned === 'evidence-unchanged') return;

    let decision: CoverageSynthesisDecision | null = null;
    let derivationInputHash: string | undefined;
    let carriedOver = false;
    if (planned === 'synthesize') {
      try {
        const resolution = await resolveWrittenDescription({
          snippets,
          entityName: typeof entity.name === 'string' ? entity.name : '',
          entityType: entity.entityType,
          researchAreas: entity.researchAreas,
          servingRow: writerServingRow({ entity, leadNames }),
          previousInputHash: storedHash,
          store,
          drafting,
          cacheOnly: args.cacheOnly,
        });
        report.step = resolution.step;
        report.modelCalled = resolution.modelCalled;
        report.inputHash = resolution.inputHash;
        decision = resolution.decision;
        derivationInputHash = resolution.derivationInputHash;
        carriedOver =
          resolution.step === 'carried-over-unchanged' ||
          resolution.step === 'carried-over-prompt-change';
        if (decision?.result) {
          report.synthesized = true;
          report.description = decision.result.description;
          report.sourceUrls = decision.result.sourceUrls;
        } else if (decision?.refusal) {
          report.synthesisRefusal = decision.refusal;
        }
        if (resolution.refusalDetails) report.refusalDetails = resolution.refusalDetails;
      } catch (error) {
        entityErrors += 1;
        console.error(`[coverage-synthesis] ${entity.slug}: ${sanitizeLogValue(error)}`);
        return;
      }
      if (!decision) return;
    }
    const materializeIsDeferred = await rowHasObservationFromRuns(
      [...anchors, ...mergedInAnchors],
      args.deferMaterializeForRuns,
    );
    if (materializeIsDeferred) deferMaterialize(report);
    const liveBody = liveWrittenBody(observations, SOURCE_NAME);
    if (args.retireUnsupportedRefusedBodies && decision?.refusal && liveBody) {
      try {
        await settleRefusedRedraftBody({
          entity,
          anchors,
          liveBody,
          snippets,
          refusal: decision.refusal,
          leadPersonName: leadNames[0] ?? '',
          apply: Boolean(args.apply && context),
          report,
          materializedEntityIds,
        });
      } catch (error) {
        entityErrors += 1;
        console.error(`[coverage-synthesis] ${entity.slug}: ${sanitizeLogValue(error)}`);
        return;
      }
    }
    let writes = carriedOverWrites(writerWritesFor(planned, decision), {
      carriedOver,
      liveBody,
      description: decision?.result?.description,
    });
    if (writes.writeBody && decision?.result) {
      cardRequests.push({
        slug: entity.slug,
        entityName: typeof entity.name === 'string' ? entity.name : '',
        fullDescription: decision.result.description,
        evidenceTexts: snippets.map((snippet) => snippet.text),
        researchAreas: Array.isArray(entity.researchAreas)
          ? entity.researchAreas.filter((area): area is string => typeof area === 'string')
          : [],
        servingRow: writerServingRow({ entity, leadNames }),
      });
    }
    if (!args.apply || !context) return;
    try {
      let changed = false;
      if (writes.writeBody && decision?.result) {
        const entityName = typeof entity.name === 'string' ? entity.name : '';
        const evidenceTexts = snippets.map((snippet) => snippet.text);
        const stored = await appendSynthesizedDescription(
          report,
          {
            entityType: 'researchEntity',
            entityKey: entity.slug,
            field: 'fullDescription',
            value: decision.result.description,
            sourceUrl: decision.result.sourceUrls[0],
            confidenceOverride: COVERAGE_CONFIDENCE,
          },
          context,
          appendObservations,
          withServedCardForBody(createDescriptionCardJudge(), (fullDescription) =>
            cachedCardFor({ fullDescription, evidenceTexts, entityName }),
          ),
        );
        if (stored) {
          written += 1;
          changed = true;
        } else observationDropped += 1;
        writes = writerWritesAfterBodyAttempt(writes, stored);
      }
      const materializedId =
        changed && !materializeIsDeferred ? await materializeWrittenRow(entity) : undefined;
      if (materializedId) materializedEntityIds.push(materializedId);
      if (writes.recordHash && derivationInputHash && derivationInputHash !== storedHash) {
        await appendObservations(
          [
            contentHashObservation(
              { entityType: 'researchEntity', entityKey: entity.slug },
              decision?.result?.sourceUrls[0] ?? '',
              derivationInputHash,
            ),
          ],
          context,
        );
      }
      if (!materializedId) return;
      report.adopted = await servesWrittenBody(materializedId);
      if (report.adopted) adopted += 1;
    } catch (error) {
      entityErrors += 1;
      console.error(`[coverage-synthesis] ${entity.slug}: ${sanitizeLogValue(error)}`);
    }
  });

  const regates = [];
  for (let index = 0; index < materializedEntityIds.length; index += REGATE_CHUNK) {
    regates.push(
      await regateRematerializedEntities(materializedEntityIds.slice(index, index + REGATE_CHUNK)),
    );
  }

  const countBy = (step: string) => reports.filter((report) => report.step === step).length;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: guard.dbLabel,
    scope: args.slugs.length > 0 ? 'slugs' : args.all ? 'all-live' : `first-${args.limit}`,
    scanned: reports.length,
    llmCalls: reports.filter((entry) => entry.modelCalled).length,
    plannedLlmCalls: countBy('planned'),
    cacheMissesNoCall: countBy('cache-miss-no-call'),
    materializeDeferred: countBy('materialize-deferred'),
    cacheHits: countBy('cache-hit'),
    carriedOverUnchanged: countBy('carried-over-unchanged'),
    carriedOverPromptChange: countBy('carried-over-prompt-change'),
    evidenceUnchanged: countBy('evidence-unchanged'),
    reinstated: countBy('reinstated'),
    reinstateRefused: countBy('reinstate-refused'),
    refusedRedraftRetire: {
      keptSupported: reports.filter((r) => r.refusedRedraftRetire === 'kept-supported').length,
      retiredWithFallback: reports.filter((r) => r.refusedRedraftRetire === 'retire-with-fallback')
        .length,
      residualNoFallback: reports.filter((r) => r.refusedRedraftRetire === 'residual-no-fallback')
        .length,
    },
    noEvidence: countBy('no-evidence'),
    fullDescriptionLocked: countBy('fullDescription-locked'),
    synthesized: reports.filter((r) => r.synthesized).length,
    synthesisRefusals: summarizeCoverageSynthesisRefusals(reports),
    written,
    observationDropped,
    observationDroppedBy: reports.reduce<Record<string, number>>((counts, entry) => {
      for (const guard of entry.observationDroppedBy ?? [])
        counts[guard] = (counts[guard] ?? 0) + 1;
      return counts;
    }, {}),
    adopted,
    entityErrors,
    connectionDrops: { ...connectionDrops },
    regated: regates.reduce((sum, entry) => sum + entry.scopedEntities, 0),
    tierChanged: regates.reduce((sum, entry) => sum + entry.tierChanged, 0),
    indexSyncFailures: regates.reduce((sum, entry) => sum + entry.indexSyncFailures, 0),
    indexSyncSkipped: regates.reduce((sum, entry) => sum + entry.indexSyncDeferred, 0),
    entities: reports,
  };
  if (args.captureCardRequests) {
    writeJsonReport(args.captureCardRequests, '--capture-card-requests', cardRequests);
  }
  console.log(
    JSON.stringify(
      { ...report, cardRequests: cardRequests.length, entities: `${reports.length} rows` },
      null,
      2,
    ),
  );
  if (args.output) {
    fs.writeFileSync(resolveSafeJsonReportOutputPath(args.output), JSON.stringify(report, null, 2));
  }
  if (entityErrors > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  void runScriptMain(runCoverageSynthesis, {
    logFailure: (error) =>
      console.error('Failed to run coverage synthesis:', sanitizeLogValue(error)),
  });
}
