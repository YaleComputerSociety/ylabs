import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { htmlToText } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import {
  synthesizeCoverageDescription,
  defaultCoverageSynthesisLLM,
} from '../scrapers/coverageSynthesis';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  FRA_PROFILE_SYNTHESIS_CONFIDENCE,
  FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
  MIN_SNIPPETS_TO_SYNTHESIZE,
  assertFraProfileSynthesisApplyAllowed,
  isBioShapedFacultyDescription,
  parseFraProfileSynthesisArgs,
  profileResearchSnippets,
  repairPronounLead,
} from './fraProfileSynthesisCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface EntityReport {
  slug: string;
  snippets: number;
  synthesized: boolean;
  written: boolean;
  description?: string;
  sourceUrl?: string;
  skipped?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function profileUrlOf(sourceUrls: unknown): string {
  return (
    (Array.isArray(sourceUrls) ? sourceUrls : []).find(
      (url): url is string => typeof url === 'string' && /\/profile\//i.test(url),
    ) ?? ''
  );
}

async function main(): Promise<void> {
  const args = parseFraProfileSynthesisArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:fra-profile-synthesis',
    mongoUrl: process.env.MONGODBURL,
  });
  assertFraProfileSynthesisApplyAllowed(args, guard.dbLabel);

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
    .select({ slug: 1, name: 1, fullDescription: 1, sourceUrls: 1 })
    .lean()) as Array<Record<string, unknown>>;

  // Only entities currently serving a biography are in scope. A FRA whose
  // description already reads as research is left alone: the A/B that justified
  // this lane measured the bio-shaped cohort only, and rewriting good
  // descriptions is the churn-without-benefit mistake #2183 recorded.
  const scoped = entities.filter(
    (entity) =>
      isBioShapedFacultyDescription(entity.fullDescription) && profileUrlOf(entity.sourceUrls),
  );
  const targets = args.limit > 0 ? scoped.slice(0, args.limit) : scoped;

  const reports: EntityReport[] = [];
  let written = 0;
  let synthesized = 0;
  const runId = `fra-profile-synthesis-${Date.now()}`;

  for (const entity of targets) {
    const slug = String(entity.slug ?? '');
    const profileUrl = profileUrlOf(entity.sourceUrls);
    const report: EntityReport = { slug, snippets: 0, synthesized: false, written: false };
    reports.push(report);

    let pageText = '';
    try {
      const fetched = await fetchPageWithPolicy(profileUrl);
      pageText = htmlToText(fetched.html);
    } catch {
      report.skipped = 'profile fetch failed';
      continue;
    }

    const snippets = profileResearchSnippets(pageText, profileUrl);
    report.snippets = snippets.length;
    if (snippets.length < MIN_SNIPPETS_TO_SYNTHESIZE) {
      report.skipped = `only ${snippets.length} research snippet(s) on the profile page`;
      continue;
    }

    const result = await synthesizeCoverageDescription({
      snippets,
      entityName: String(entity.name ?? 'Research'),
      callLLM,
    });
    if (!result) {
      report.skipped = 'synthesizer failed closed (grounding or quality gate)';
      continue;
    }

    const description = repairPronounLead(result.description);
    // Fail closed rather than trade one biography for another: a synthesis that
    // still reads as a person bio is not an improvement on what we serve.
    if (!description || isBioShapedFacultyDescription(description)) {
      report.skipped = 'synthesized text still reads as a person biography';
      continue;
    }
    report.synthesized = true;
    report.description = description;
    report.sourceUrl = result.sourceUrls[0] ?? profileUrl;
    synthesized += 1;

    if (args.apply && source) {
      await appendObservations(
        [
          {
            entityType: 'researchEntity',
            entityKey: slug,
            field: 'fullDescription',
            value: description,
            sourceUrl: report.sourceUrl,
            confidenceOverride: FRA_PROFILE_SYNTHESIS_CONFIDENCE,
          },
        ],
        {
          scrapeRunId: runId,
          sourceId: source._id,
          sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
          sourceWeight: FRA_PROFILE_SYNTHESIS_CONFIDENCE,
          dryRun: false,
        },
      );
      await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: false });
      report.written = true;
      written += 1;
    }
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
