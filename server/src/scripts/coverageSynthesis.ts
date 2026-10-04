import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import {
  appendObservations,
  getSourceByName,
  retireObservations,
} from '../scrapers/observationStore';
import { contentHashObservation } from '../scrapers/contentHashGate';
import { materializeEntity, materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { appendSynthesizedDescription } from './synthesizedDescriptionObservation';
import {
  COVERAGE_CONFIDENCE,
  WRITTEN_DESCRIPTION_SOURCE_NAME,
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
  buildWriterEvidenceSnippets,
  parseCoverageSynthesisArgs,
  planWriterStep,
  storedWriterEvidenceHash,
  writerEvidenceHash,
  writerObservationAnchors,
  writerWritesAfterBodyAttempt,
  writerWritesFor,
  type WriterStep,
} from './coverageSynthesisCore';
import { regateRematerializedEntities } from './rematerializeResearchEntities';

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
  step?: WriterStep | 'fullDescription-locked';
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
  const projection = 'slug name entityType researchAreas recentGrants manuallyLockedFields';
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

async function materializeWrittenRow(slug: string): Promise<string | undefined> {
  const materialized = await materializeEntity(
    'researchEntity',
    { entityKey: slug },
    { dryRun: false },
  );
  return typeof materialized.entityId === 'string' ? materialized.entityId : undefined;
}

async function main() {
  const args = parseCoverageSynthesisArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:coverage-synthesis',
    mongoUrl: process.env.MONGODBURL,
  });
  assertCoverageSynthesisApplyAllowed(args, guard.dbLabel);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('research-entity:coverage-synthesis requires OPENAI_API_KEY');
  const callLLM = defaultCoverageSynthesisLLM(apiKey);

  await initializeConnections();

  const entities = await loadTargetEntities(args);
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
      .select('field value sourceUrl sourceName confidence observedAt')
      .lean()) as unknown as Array<CoverageObservationLike & { observedAt?: Date }>;

    const snippets = buildWriterEvidenceSnippets(observations, entity.recentGrants);
    report.snippets = snippets.length;
    const freshHash = writerEvidenceHash(snippets);
    const step = planWriterStep({
      snippets,
      storedHash: storedWriterEvidenceHash(observations, SOURCE_NAME),
      freshHash,
    });
    report.step = step;
    if (step === 'evidence-unchanged') return;

    let decision: CoverageSynthesisDecision | null = null;
    if (step === 'synthesize') {
      try {
        decision = await synthesizeDecisionIntoCoverageReport(report, {
          snippets,
          entityName: typeof entity.name === 'string' ? entity.name : '',
          entityType: entity.entityType,
          researchAreas: entity.researchAreas,
          callLLM,
        });
      } catch (error) {
        entityErrors += 1;
        console.error(`[coverage-synthesis] ${entity.slug}: ${sanitizeLogValue(error)}`);
        return;
      }
    }
    if (!args.apply || !context) return;
    try {
      let writes = writerWritesFor(step, decision);
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
      const materializedId = changed ? await materializeWrittenRow(entity.slug) : undefined;
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
      const fresh = (await ResearchEntity.findById(materializedId)
        .select('fullDescription fieldProvenance.fullDescription.sourceName')
        .lean()) as { fullDescription?: unknown; fieldProvenance?: any } | null;
      report.adopted =
        fresh?.fieldProvenance?.fullDescription?.sourceName === SOURCE_NAME &&
        typeof fresh?.fullDescription === 'string' &&
        fresh.fullDescription.trim().length > 0;
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
    llmCalls: countBy('synthesize'),
    evidenceUnchanged: countBy('evidence-unchanged'),
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
