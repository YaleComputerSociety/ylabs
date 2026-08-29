import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { synthesizeCoverageDescription, defaultCoverageSynthesisLLM } from '../scrapers/coverageSynthesis';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { planStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
  GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
  assertGrantCorpusSynthesisApplyAllowed,
  buildGrantCorpusSnippets,
  entityHasBetterSourcedDescription,
  parseGrantCorpusSynthesisArgs,
  type FullDescriptionObservationLike,
} from './grantCorpusSynthesisCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface GrantCorpusEntityReport {
  slug: string;
  grants: number;
  snippets: number;
  synthesized: boolean;
  written: boolean;
  gainedSchool: boolean;
  promotedToStudentReady: boolean;
  school?: string;
  description?: string;
  sourceUrls?: string[];
  skipped?: string;
}

async function main() {
  const args = parseGrantCorpusSynthesisArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:grant-corpus-synthesis',
    mongoUrl: process.env.MONGODBURL,
  });
  assertGrantCorpusSynthesisApplyAllowed(args, guard.dbLabel);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('research-entity:grant-corpus-synthesis requires OPENAI_API_KEY');
  const callLLM = defaultCoverageSynthesisLLM(apiKey);

  await initializeConnections();

  const filter: Record<string, unknown> =
    args.slugs.length > 0
      ? { slug: { $in: args.slugs } }
      : {
          archived: { $ne: true },
          $or: [{ recentGrantCount: { $gt: 0 } }, { 'recentGrants.0': { $exists: true } }],
        };
  const entities = (await ResearchEntity.find(filter)
    .select(
      'slug name entityType kind researchAreas fullDescription recentGrants school studentVisibilityTier manuallyLockedFields',
    )
    .limit(args.limit)
    .lean()) as Record<string, any>[];

  const source = args.apply ? await getSourceByName(GRANT_CORPUS_SYNTHESIS_SOURCE_NAME) : null;
  if (args.apply && !source) {
    throw new Error(
      `research-entity:grant-corpus-synthesis apply requires the '${GRANT_CORPUS_SYNTHESIS_SOURCE_NAME}' source to be seeded (run scrape:seed-sources)`,
    );
  }
  const runId = new mongoose.Types.ObjectId().toString();

  const reports: GrantCorpusEntityReport[] = [];
  const materializedEntityIds: string[] = [];
  const beforeTierByEntityId = new Map<string, string>();
  const reportByEntityId = new Map<string, GrantCorpusEntityReport>();
  let written = 0;
  let gainedSchool = 0;

  for (const entity of entities) {
    const report: GrantCorpusEntityReport = {
      slug: entity.slug,
      grants: Array.isArray(entity.recentGrants) ? entity.recentGrants.length : 0,
      snippets: 0,
      synthesized: false,
      written: false,
      gainedSchool: false,
      promotedToStudentReady: false,
    };
    const manuallyLockedFields: string[] = Array.isArray(entity.manuallyLockedFields)
      ? entity.manuallyLockedFields
      : [];
    if (manuallyLockedFields.includes('fullDescription')) {
      report.skipped = 'fullDescription-locked';
      reports.push(report);
      continue;
    }

    const fullDescriptionObservations = (await Observation.find({
      entityType: 'researchEntity',
      entityKey: entity.slug,
      field: 'fullDescription',
    })
      .select('value sourceName')
      .lean()) as unknown as FullDescriptionObservationLike[];
    if (
      entityHasBetterSourcedDescription(
        fullDescriptionObservations,
        entity.researchAreas,
        entity.entityType,
      )
    ) {
      report.skipped = 'better-sourced-description';
      reports.push(report);
      continue;
    }

    const snippets = buildGrantCorpusSnippets(entity.recentGrants);
    report.snippets = snippets.length;
    if (snippets.length === 0) {
      report.skipped = 'no-grant-text';
      reports.push(report);
      continue;
    }

    const result = await synthesizeCoverageDescription({
      snippets,
      entityName: typeof entity.name === 'string' ? entity.name : '',
      entityType: entity.entityType,
      researchAreas: entity.researchAreas,
      callLLM,
    });
    if (!result) {
      report.skipped = 'synthesis-failed-quality-gate';
      reports.push(report);
      continue;
    }
    report.synthesized = true;
    report.description = result.description;
    report.sourceUrls = result.sourceUrls;

    if (args.apply && source) {
      await appendObservations(
        [
          {
            entityType: 'researchEntity',
            entityKey: entity.slug,
            field: 'fullDescription',
            value: result.description,
            sourceUrl: result.sourceUrls[0],
            confidenceOverride: GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
          },
        ],
        {
          scrapeRunId: runId,
          sourceId: source._id,
          sourceName: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
          sourceWeight: GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
          dryRun: false,
        },
      );
      report.written = true;
      written += 1;

      const beforeSchool =
        typeof entity.school === 'string' ? entity.school.trim() : '';
      const materializeResult = await materializeEntity(
        'researchEntity',
        { entityKey: entity.slug },
        { dryRun: false },
      );
      const materializedId =
        typeof materializeResult.entityId === 'string' ? materializeResult.entityId : undefined;
      const fresh = materializedId
        ? ((await ResearchEntity.findById(materializedId)
            .select('school studentVisibilityTier')
            .lean()) as { school?: unknown; studentVisibilityTier?: unknown } | null)
        : null;
      const afterSchool =
        fresh && typeof fresh.school === 'string' ? fresh.school.trim() : beforeSchool;
      if (!beforeSchool && afterSchool) {
        report.gainedSchool = true;
        report.school = afterSchool;
        gainedSchool += 1;
      }
      if (materializedId) {
        materializedEntityIds.push(materializedId);
        beforeTierByEntityId.set(
          materializedId,
          typeof entity.studentVisibilityTier === 'string'
            ? entity.studentVisibilityTier
            : 'operator_review',
        );
        reportByEntityId.set(materializedId, report);
      }
    }
    reports.push(report);
  }

  let promotedToStudentReady = 0;
  if (args.apply && materializedEntityIds.length > 0) {
    const plans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: materializedEntityIds,
    });
    for (const plan of plans) {
      if (
        plan.tier !== 'student_ready' ||
        beforeTierByEntityId.get(plan.recordId) === 'student_ready'
      ) {
        continue;
      }
      const entityReport = reportByEntityId.get(plan.recordId);
      if (entityReport && !entityReport.promotedToStudentReady) {
        entityReport.promotedToStudentReady = true;
        promotedToStudentReady += 1;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: guard.dbLabel,
    limit: args.limit,
    scanned: reports.length,
    synthesized: reports.filter((r) => r.synthesized).length,
    written,
    gainedSchool,
    promotedToStudentReady,
    entities: reports,
  };
  console.log(JSON.stringify(report, null, 2));
  if (args.output) {
    fs.writeFileSync(resolveSafeJsonReportOutputPath(args.output), JSON.stringify(report, null, 2));
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run grant-corpus synthesis:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
