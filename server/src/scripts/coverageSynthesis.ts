import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import {
  appendObservations,
  getSourceByName,
  retireObservations,
} from '../scrapers/observationStore';
import { contentHashObservation } from '../scrapers/contentHashGate';
import { resetDescriptionOwnershipCitersCache } from '../scrapers/descriptionOwnershipResolverScreen';
import {
  defaultMaterializerCardSynthesizer,
  materializeEntity,
  materializationReadScopeFilter,
} from '../scrapers/entityMaterializer';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { appendSynthesizedDescription } from './synthesizedDescriptionObservation';
import {
  COVERAGE_CONFIDENCE,
  WRITTEN_DESCRIPTION_SOURCE_NAME,
  adoptedWrittenBodyStillSupported,
  defaultCoverageSynthesisLLM,
  coverageSynthesisDecision,
  countCoverageSynthesisRefusals,
  type CoverageObservationLike,
  type CoverageSynthesisDecision,
  type CoverageSynthesisRefusal,
  type CoverageSynthesisResult,
  type SynthesizeCoverageInput,
} from '../scrapers/coverageSynthesis';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  WRITER_EVIDENCE_FIELDS,
  assertCoverageSynthesisApplyAllowed,
  buildWriterEvidenceSnippetsWithMergedInFill,
  parseCoverageSynthesisArgs,
  planWriterStep,
  liveWrittenBody,
  reinstateStepFor,
  storedWriterEvidenceHash,
  writerEvidenceHash,
  writerStoredHashFor,
  writerObservationAnchors,
  writerWritesAfterBodyAttempt,
  writerWritesFor,
  writtenBodyCardRepairFilter,
  type ReinstateStep,
  type WriterStep,
  INGEST_VERIFIED_EXTRACTION_SOURCE,
  PAGE_GROUNDING_VERIFIED_SINCE,
  ingestVerifiedRunIds,
  markIngestVerifiedObservations,
  deferSearchIndexWritesWhenSkipping,
  synthesizeWithWriterModel,
  writerModelClientFor,
} from './coverageSynthesisCore';
import { regateRematerializedEntities } from './rematerializeResearchEntities';
import { listResearchEntityMergedInRowsBySurvivor } from '../services/researchEntityCanonicalTombstone';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SOURCE_NAME = WRITTEN_DESCRIPTION_SOURCE_NAME;
const RETIRE_REASON = 'written-description-no-longer-supported-by-evidence';
const REGATE_CHUNK = 500;
const ENTITY_READ_CHUNK = 200;

export interface CoverageEntityReport {
  slug: string;
  snippets: number;
  step?: WriterStep | ReinstateStep | 'fullDescription-locked';
  synthesized: boolean;
  written: boolean;
  retired?: number;
  adopted?: boolean;
  observationDropped?: boolean;
  description?: string;
  sourceUrls?: string[];
  synthesisRefusal?: CoverageSynthesisRefusal;
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
  const projection =
    'slug name entityType researchAreas recentGrants manuallyLockedFields shortDescription websiteUrl fieldValueRefusals';
  if (args.rederiveCards) {
    return (await ResearchEntity.find({
      ...writtenBodyCardRepairFilter(SOURCE_NAME, { allWrittenRows: args.all }),
      ...(args.slugs.length > 0 ? { slug: { $in: args.slugs } } : {}),
    })
      .select(projection)
      .lean()) as EntityRow[];
  }
  if (args.slugs.length > 0) {
    return (await ResearchEntity.find({ slug: { $in: args.slugs }, archived: { $ne: true } })
      .select(projection)
      .lean()) as EntityRow[];
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
    rows.push(...chunk);
    lastId = chunk[chunk.length - 1]._id;
    if (chunk.length < remaining) break;
  }
  return rows;
}

export function writtenRowMaterializeOptions(entityName: string) {
  return {
    dryRun: false,
    synthesizeCardDescription: defaultMaterializerCardSynthesizer(entityName),
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

async function main() {
  const args = parseCoverageSynthesisArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:coverage-synthesis',
    mongoUrl: process.env.MONGODBURL,
  });
  assertCoverageSynthesisApplyAllowed(args, guard.dbLabel);

  deferSearchIndexWritesWhenSkipping(args);
  const callLLM = writerModelClientFor({
    apply: args.apply && !args.reinstateRetiredBodies,
    apiKey: process.env.OPENAI_API_KEY,
    create: defaultCoverageSynthesisLLM,
  });

  await initializeConnections();

  const entities = await loadTargetEntities(args);
  const verifiedRunIds = ingestVerifiedRunIds(
    (await ScrapeRun.find({
      sourceName: INGEST_VERIFIED_EXTRACTION_SOURCE,
      startedAt: { $gte: PAGE_GROUNDING_VERIFIED_SINCE },
      invalidated: { $ne: true },
    })
      .select('_id sourceName startedAt invalidated')
      .lean()) as Array<{
      _id: unknown;
      sourceName?: unknown;
      startedAt?: unknown;
      invalidated?: unknown;
    }>,
  );
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
  const materializedEntityIds: string[] = [];
  let written = 0;
  let observationDropped = 0;
  let retired = 0;
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
    const observations = (await Observation.find({
      entityType: 'researchEntity',
      ...materializationReadScopeFilter(),
      field: { $in: WRITER_EVIDENCE_FIELDS },
      $or: anchors,
    })
      .select('field value sourceUrl sourceName confidence observedAt scrapeRunId')
      .lean()) as unknown as Array<CoverageObservationLike & { observedAt?: Date }>;

    const mergedInAnchors = (mergedInBySurvivor.get(String(entity._id)) ?? []).flatMap((row) =>
      writerObservationAnchors({ entityKey: row.slug, entityId: row._id }),
    );
    const loadMergedInObservations = async () =>
      mergedInAnchors.length > 0
        ? markIngestVerifiedObservations(
            (await Observation.find({
              entityType: 'researchEntity',
              ...materializationReadScopeFilter(),
              field: { $in: WRITER_EVIDENCE_FIELDS },
              $or: mergedInAnchors,
            })
              .select('field value sourceUrl sourceName confidence observedAt scrapeRunId')
              .lean()) as unknown as Array<CoverageObservationLike & { observedAt?: Date }>,
            verifiedRunIds,
          )
        : [];
    const snippets = await buildWriterEvidenceSnippetsWithMergedInFill(
      markIngestVerifiedObservations(observations, verifiedRunIds),
      loadMergedInObservations,
      entity.recentGrants,
      {
        websiteUrl: entity.websiteUrl,
        fieldValueRefusals: entity.fieldValueRefusals,
      },
    );
    report.snippets = snippets.length;
    if (args.reinstateRetiredBodies) {
      const retired = (await Observation.findOne({
        entityType: 'researchEntity',
        sourceName: SOURCE_NAME,
        field: 'fullDescription',
        'rollback.reason': RETIRE_REASON,
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
    const freshHash = writerEvidenceHash(snippets);
    const step = planWriterStep({
      snippets,
      storedHash: writerStoredHashFor(args, storedWriterEvidenceHash(observations, SOURCE_NAME)),
      freshHash,
    });
    report.step = step;
    if (step === 'evidence-unchanged') return;

    let decision: CoverageSynthesisDecision | null = null;
    if (step === 'synthesize') {
      try {
        decision = await synthesizeWithWriterModel({
          step,
          callLLM,
          synthesize: (writerModel) =>
            synthesizeDecisionIntoCoverageReport(report, {
              snippets,
              entityName: typeof entity.name === 'string' ? entity.name : '',
              entityType: entity.entityType,
              researchAreas: entity.researchAreas,
              callLLM: writerModel,
            }),
        });
      } catch (error) {
        entityErrors += 1;
        console.error(`[coverage-synthesis] ${entity.slug}: ${sanitizeLogValue(error)}`);
        return;
      }
    }
    if (!args.apply || !context) return;
    try {
      let writes = writerWritesFor(step, decision, {
        adoptedBodyStillSupported: adoptedWrittenBodyStillSupported({
          body: liveWrittenBody(observations, SOURCE_NAME),
          snippets,
          researchAreas: entity.researchAreas,
          entityType: entity.entityType,
        }),
      });
      let changed = false;
      if (writes.writeBody && decision?.result) {
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
        );
        if (stored) {
          written += 1;
          changed = true;
        } else observationDropped += 1;
        writes = writerWritesAfterBodyAttempt(writes, stored);
      }
      if (writes.retireBody) {
        const outcome = await retireObservations(
          {
            entityType: 'researchEntity',
            sourceName: SOURCE_NAME,
            field: 'fullDescription',
            $or: anchors,
          },
          RETIRE_REASON,
        );
        report.retired = outcome.retired;
        retired += outcome.retired;
        if (outcome.retired > 0) changed = true;
      }
      const materializedId = changed ? await materializeWrittenRow(entity) : undefined;
      if (materializedId) materializedEntityIds.push(materializedId);
      if (writes.recordHash) {
        await appendObservations(
          [
            contentHashObservation(
              { entityType: 'researchEntity', entityKey: entity.slug },
              decision?.result?.sourceUrls[0] ?? '',
              freshHash,
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
    llmCalls: args.apply ? countBy('synthesize') : 0,
    plannedLlmCalls: countBy('synthesize'),
    evidenceUnchanged: countBy('evidence-unchanged'),
    reinstated: countBy('reinstated'),
    reinstateRefused: countBy('reinstate-refused'),
    noEvidence: countBy('no-evidence'),
    fullDescriptionLocked: countBy('fullDescription-locked'),
    synthesized: reports.filter((r) => r.synthesized).length,
    synthesisRefusals: summarizeCoverageSynthesisRefusals(reports),
    written,
    observationDropped,
    retired,
    adopted,
    entityErrors,
    regated: regates.reduce((sum, entry) => sum + entry.scopedEntities, 0),
    tierChanged: regates.reduce((sum, entry) => sum + entry.tierChanged, 0),
    indexSyncFailures: regates.reduce((sum, entry) => sum + entry.indexSyncFailures, 0),
    indexSyncSkipped: regates.reduce((sum, entry) => sum + entry.indexSyncDeferred, 0),
    entities: reports,
  };
  console.log(JSON.stringify({ ...report, entities: `${reports.length} rows` }, null, 2));
  if (args.output) {
    fs.writeFileSync(resolveSafeJsonReportOutputPath(args.output), JSON.stringify(report, null, 2));
  }
  if (entityErrors > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run coverage synthesis:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
