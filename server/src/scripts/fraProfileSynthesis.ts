import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getSourceByName } from '../scrapers/observationStore';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { htmlToText } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { defaultCoverageSynthesisLLM } from '../scrapers/coverageSynthesis';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
  assertFraProfileSynthesisApplyAllowed,
  parseFraProfileSynthesisArgs,
} from './fraProfileSynthesisCore';
import {
  FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS,
  profileUrlOf,
  runFraProfileSynthesisEntity,
  selectFraProfileSynthesisTargets,
  type FraProfileSynthesisEntity,
  type FraProfileSynthesisEntityReport,
} from './fraProfileSynthesisLane';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
  const args = parseFraProfileSynthesisArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:fra-profile-synthesis',
    mongoUrl: process.env.MONGODBURL,
  });
  assertFraProfileSynthesisApplyAllowed(args, {
    environment: guard.environment,
    dbLabel: guard.dbLabel,
    mongoUrl: process.env.MONGODBURL,
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('research-entity:fra-profile-synthesis requires OPENAI_API_KEY');
  const callLLM = defaultCoverageSynthesisLLM(apiKey);

  await initializeConnections();
  const source = args.apply ? await getSourceByName(FRA_PROFILE_SYNTHESIS_SOURCE_NAME) : null;
  if (args.apply && !source) {
    throw new Error(
      `${FRA_PROFILE_SYNTHESIS_SOURCE_NAME} is not seeded; run the source seed before applying`,
    );
  }

  const filter: Record<string, unknown> =
    args.slugs.length > 0
      ? { slug: { $in: args.slugs } }
      : { entityType: 'FACULTY_RESEARCH_AREA', archived: { $ne: true } };
  const entities = (await ResearchEntity.find(filter)
    .select(FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS)
    .lean()) as FraProfileSynthesisEntity[];

  const scoped = selectFraProfileSynthesisTargets(entities);
  const targets = args.limit > 0 ? scoped.slice(0, args.limit) : scoped;

  const reports: FraProfileSynthesisEntityReport[] = [];
  let written = 0;
  let synthesized = 0;
  const runId = `fra-profile-synthesis-${Date.now()}`;

  for (const entity of targets) {
    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrl: profileUrlOf(entity.sourceUrls),
      callLLM,
      fetchProfileText: async (url) => htmlToText((await fetchPageWithPolicy(url)).html),
      apply: args.apply,
      runId,
      sourceId: source?._id,
    });
    reports.push(report);
    if (report.synthesized) synthesized += 1;
    if (report.written) written += 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: guard.dbLabel,
    inScopeBioShaped: scoped.length,
    attempted: targets.length,
    synthesized,
    written,
    skipped: reports.filter((report) => report.skipped).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const report of reports) {
    console.log(
      `  ${report.synthesized ? 'OK  ' : 'skip'} ${sanitizeLogValue(report.slug)}${report.skipped ? `  (${report.skipped})` : ''}`,
    );
  }

  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.writeFileSync(outputPath, `${JSON.stringify({ summary, reports }, null, 2)}\n`);
    console.log(`report written: ${outputPath}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
