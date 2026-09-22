import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { resolveResearchEntityMergeRedirectCanonical } from '../services/researchEntityMergeRedirectService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  rematerializeFailureMessage,
  rematerializeSkipReasonForEntity,
} from './rematerializeResearchEntitiesCore';
import {
  classifyEntityProjectionDrift,
  parseProjectionDriftCensusArgs,
  projectionDriftReportsForUnloadedSlugs,
  scaleProjectionDriftCensusToCorpus,
  summarizeProjectionDriftCensus,
  type ProjectionDriftEntityReport,
} from './projectionDriftCensusCore';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function loadCensusRows(sample: number, slugs: string[], includeArchived: boolean) {
  if (slugs.length > 0) {
    // The archived filter stays out of the slug query so a requested archived row
    // loads and reports `skipped: archived-entity` rather than vanishing from the
    // report with nothing saying it was asked for.
    return ResearchEntity.find({ slug: { $in: slugs } }).lean<Array<Record<string, unknown>>>();
  }
  return ResearchEntity.aggregate<Record<string, unknown>>([
    { $match: includeArchived ? {} : { archived: { $ne: true } } },
    { $sample: { size: sample } },
  ]);
}

async function censusRow(
  stored: Record<string, unknown>,
  includeArchived: boolean,
): Promise<ProjectionDriftEntityReport> {
  const slug = String(stored.slug || '');
  const redirectCanonical = await resolveResearchEntityMergeRedirectCanonical({
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
  if (result.skipped) return { slug, skipped: result.skipped, findings: [] };
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
  const rows = await loadCensusRows(args.sample, args.slugs, args.includeArchived);

  const entities: ProjectionDriftEntityReport[] = [];
  for (const row of rows) {
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
