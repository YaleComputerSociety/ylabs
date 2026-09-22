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
  fraProfileSynthesisLeads,
  newFraProfileSynthesisRunId,
  profileUrlsOf,
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
  const leadsByEntityId = await fraProfileSynthesisLeads(entities);

  const scoped = selectFraProfileSynthesisTargets(
    entities.map((entity) => ({
      ...entity,
      leads: leadsByEntityId.get(String(entity._id)) ?? [],
    })),
  );
  const targets = args.limit > 0 ? scoped.slice(0, args.limit) : scoped;

  const reports: FraProfileSynthesisEntityReport[] = [];
  let written = 0;
  let adopted = 0;
  let synthesized = 0;
  let reverted = 0;
  let revertLeftRowUnserved = 0;
  const runId = newFraProfileSynthesisRunId();

  for (const entity of targets) {
    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrls: profileUrlsOf(entity),
      callLLM,
      fetchProfileText: async (url) => htmlToText((await fetchPageWithPolicy(url)).html),
      apply: args.apply,
      runId,
      sourceId: source?._id,
    });
    reports.push(report);
    if (report.synthesized) synthesized += 1;
    if (report.written) written += 1;
    if (report.adopted) adopted += 1;
    if (report.reverted) reverted += 1;
    if (report.reverted && !report.revertRestoredServedCard) revertLeftRowUnserved += 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: guard.dbLabel,
    inScope: scoped.length,
    attempted: targets.length,
    synthesized,
    written,
    adopted,
    reverted,
    revertLeftRowUnserved,
    skipped: reports.filter((report) => report.skipped).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const report of reports) {
    const outcome = report.reverted
      ? `  (reverted: ${report.revertedReason}${report.revertRestoredServedCard ? '' : '; row still serves no card'})`
      : report.skipped
        ? `  (${report.skipped})`
        : '';
    console.log(
      `  ${report.reverted ? 'back' : report.synthesized ? 'OK  ' : 'skip'} ${sanitizeLogValue(report.slug)}${outcome}`,
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
