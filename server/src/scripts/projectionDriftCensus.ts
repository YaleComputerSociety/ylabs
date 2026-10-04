import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { resolveResearchEntityCanonicalIdentity } from '../services/researchEntityCanonicalTombstone';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  rematerializeFailureMessage,
  rematerializeSkipReasonForEntity,
} from './rematerializeResearchEntitiesCore';
import {
  chunkProjectionDriftCensusIds,
  classifyEntityProjectionDrift,
  parseProjectionDriftCensusArgs,
  PROJECTION_DRIFT_CENSUS_AGGREGATE_OPTIONS,
  projectionDriftCensusSamplePipeline,
  projectionDriftReportsForUnloadedSlugs,
  projectionDriftSkipReasonForResult,
  scaleProjectionDriftCensusToCorpus,
  summarizeProjectionDriftCensus,
  type ProjectionDriftEntityReport,
} from './projectionDriftCensusCore';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

async function* loadCensusRows(
  sample: number,
  slugs: string[],
  includeArchived: boolean,
): AsyncGenerator<Record<string, unknown>> {
  if (slugs.length > 0) {
    // The archived filter stays out of the slug query so a requested archived row
    // loads and reports `skipped: archived-entity` rather than vanishing from the
    // report with nothing saying it was asked for.
    yield* await ResearchEntity.find({ slug: { $in: slugs } }).lean<
      Array<Record<string, unknown>>
    >();
    return;
  }
  const sampledIds = await ResearchEntity.aggregate<{ _id: unknown }>(
    projectionDriftCensusSamplePipeline(sample, includeArchived),
    PROJECTION_DRIFT_CENSUS_AGGREGATE_OPTIONS,
  );
  for (const batch of chunkProjectionDriftCensusIds(sampledIds.map((row) => row._id))) {
    yield* await ResearchEntity.find({ _id: { $in: batch } }).lean<
      Array<Record<string, unknown>>
    >();
  }
}

async function censusRow(
  stored: Record<string, unknown>,
  includeArchived: boolean,
): Promise<ProjectionDriftEntityReport> {
  const slug = String(stored.slug || '');
  const redirectCanonical = await resolveResearchEntityCanonicalIdentity({
    slug,
    entityId: stored._id ? String(stored._id) : undefined,
  });
  // A dedupe can leave an observation's entityKey on the merged-away slug while
  // its entityId names the survivor (#2941), so a projection keyed on the
  // requested row would be diffed against a document it would never write.
  const skipped = rematerializeSkipReasonForEntity(
    stored,
    includeArchived,
    redirectCanonical?._id ? String(redirectCanonical._id) : undefined,
  );
  if (skipped) return { slug, skipped, findings: [] };

  const result = await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: true });
  const projectionSkipped = projectionDriftSkipReasonForResult(result);
  if (projectionSkipped) return { slug, skipped: projectionSkipped, findings: [] };
  return {
    slug,
    findings: classifyEntityProjectionDrift({
      stored,
      plannedSet: result.plannedSet || {},
      plannedUnset: result.plannedUnset || {},
      schema: ResearchEntity.schema,
    }),
  };
}

async function main() {
  const args = parseProjectionDriftCensusArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'research-entity:projection-drift-census',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();

  const corpusRows = await ResearchEntity.countDocuments(
    args.includeArchived ? {} : { archived: { $ne: true } },
  );
  const entities: ProjectionDriftEntityReport[] = [];
  for await (const row of loadCensusRows(args.sample, args.slugs, args.includeArchived)) {
    try {
      entities.push(await censusRow(row, args.includeArchived));
    } catch (error) {
      entities.push({
        slug: String(row.slug || ''),
        error: rematerializeFailureMessage(error),
        findings: [],
      });
    }
  }
  entities.push(...projectionDriftReportsForUnloadedSlugs(args.slugs, entities));

  const summary = summarizeProjectionDriftCensus(entities);
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: 'read-only',
    corpusRows,
    requestedSample: args.slugs.length > 0 ? undefined : args.sample,
    requestedSlugs: args.slugs,
    includeArchived: args.includeArchived,
    summary,
    scaledToCorpus:
      args.slugs.length > 0 ? undefined : scaleProjectionDriftCensusToCorpus(summary, corpusRows),
    entities,
  };

  console.log(JSON.stringify({ ...report, entities: undefined }, null, 2));
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${args.output}`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to census projection drift:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
