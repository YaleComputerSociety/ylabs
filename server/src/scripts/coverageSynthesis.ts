import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import {
  COVERAGE_CONFIDENCE,
  defaultCoverageSynthesisLLM,
  gatherCoverageSnippets,
  synthesizeCoverageDescription,
  type CoverageObservationLike,
} from '../scrapers/coverageSynthesis';
import { fullDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertCoverageSynthesisApplyAllowed,
  parseCoverageSynthesisArgs,
} from './coverageSynthesisCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_NAME = 'coverage-synthesis-llm';

interface CoverageEntityReport {
  slug: string;
  snippets: number;
  synthesized: boolean;
  written: boolean;
  description?: string;
  sourceUrls?: string[];
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

  const filter: Record<string, unknown> =
    args.slugs.length > 0
      ? { slug: { $in: args.slugs } }
      : {
          archived: { $ne: true },
          $or: [
            { fullDescription: { $in: [null, ''] } },
            { $expr: { $lt: [{ $strLenCP: { $ifNull: ['$fullDescription', ''] } }, 120] } },
          ],
        };
  const entities = (await ResearchEntity.find(filter)
    .select('slug name entityType researchAreas fullDescription')
    .limit(args.limit)
    .lean()) as Record<string, any>[];

  const source = args.apply ? await getSourceByName(SOURCE_NAME) : null;
  if (args.apply && !source) {
    throw new Error(`research-entity:coverage-synthesis apply requires the '${SOURCE_NAME}' source to be seeded`);
  }
  const runId = new mongoose.Types.ObjectId().toString();

  const reports: CoverageEntityReport[] = [];
  let written = 0;
  for (const entity of entities) {
    if (fullDescriptionQuality(entity.fullDescription, entity.researchAreas, entity.entityType).isUseful) {
      continue;
    }
    const observations = (await Observation.find({
      entityType: 'researchEntity',
      entityKey: entity.slug,
    })
      .select('field value sourceUrl sourceName')
      .lean()) as unknown as CoverageObservationLike[];
    const snippets = gatherCoverageSnippets(observations);
    const report: CoverageEntityReport = {
      slug: entity.slug,
      snippets: snippets.length,
      synthesized: false,
      written: false,
    };
    if (snippets.length > 0) {
      const result = await synthesizeCoverageDescription({
        snippets,
        entityName: typeof entity.name === 'string' ? entity.name : '',
        entityType: entity.entityType,
        researchAreas: entity.researchAreas,
        callLLM,
      });
      if (result) {
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
                confidenceOverride: COVERAGE_CONFIDENCE,
              },
            ],
            {
              scrapeRunId: runId,
              sourceId: source._id,
              sourceName: SOURCE_NAME,
              sourceWeight: COVERAGE_CONFIDENCE,
              dryRun: false,
            },
          );
          report.written = true;
          written += 1;
        }
      }
    }
    reports.push(report);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: guard.dbLabel,
    limit: args.limit,
    scanned: reports.length,
    synthesized: reports.filter((r) => r.synthesized).length,
    written,
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
      console.error('Failed to run coverage synthesis:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
