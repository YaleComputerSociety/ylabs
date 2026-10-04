import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { runWithBoundedConcurrency } from '../scrapers/utils/boundedConcurrency';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { fraProfileSynthesisLeads, profileUrlsOf } from './fraProfileSynthesisLane';
import {
  PROFILE_HONORS_CONFIDENCE,
  PROFILE_HONORS_ENTITY_TYPES,
  PROFILE_HONORS_SOURCE_NAME,
  parseProfileHonorsArgs,
  readProfileHonors,
  type ProfileHonorsEntity,
} from './profileHonorsCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const ENTITY_FIELDS = '_id slug name displayName entityType archived sourceUrls leadHonors';
const PAGE_READ_CONCURRENCY = 6;

async function main(): Promise<void> {
  const args = parseProfileHonorsArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:profile-honors',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const source = args.apply ? await getSourceByName(PROFILE_HONORS_SOURCE_NAME) : null;
  if (args.apply && !source) {
    throw new Error(`${PROFILE_HONORS_SOURCE_NAME} is not seeded; run the source seed first`);
  }

  const filter: Record<string, unknown> =
    args.slugs.length > 0
      ? { slug: { $in: args.slugs } }
      : { entityType: { $in: PROFILE_HONORS_ENTITY_TYPES }, archived: { $ne: true } };
  const entities = (await ResearchEntity.find(filter)
    .select(ENTITY_FIELDS)
    .lean()) as ProfileHonorsEntity[];
  const leadsByEntityId = await fraProfileSynthesisLeads(entities);
  const scoped = entities.map((entity) => ({
    ...entity,
    leads: leadsByEntityId.get(String(entity._id)) ?? [],
  }));
  const targets = args.limit > 0 ? scoped.slice(0, args.limit) : scoped;

  const runId = new mongoose.Types.ObjectId().toString();
  const currentYear = new Date().getFullYear();
  const tally = {
    noProfilePage: 0,
    fetchFailed: 0,
    unchanged: 0,
    write: 0,
    withHonors: 0,
    withRecent: 0,
  };
  const writes: { slug: string; sourceUrl: string; honors: unknown[] }[] = [];
  let read = 0;
  await runWithBoundedConcurrency(targets, PAGE_READ_CONCURRENCY, async (entity) => {
    const outcome = await readProfileHonors(
      entity,
      profileUrlsOf(entity),
      async (url) => (await fetchPageWithPolicy(url)).html,
      currentYear,
    );
    tally[outcome.kind]++;
    if (outcome.kind === 'write' || outcome.kind === 'unchanged') {
      if (outcome.honors.length > 0) tally.withHonors++;
      if (outcome.honors.some((honor) => (honor.year ?? 0) >= currentYear - 5)) tally.withRecent++;
    }
    if (outcome.kind === 'write') {
      const slug = String(entity.slug);
      writes.push({ slug, sourceUrl: outcome.sourceUrl, honors: outcome.honors });
      if (args.apply) {
        await appendObservations(
          [
            {
              entityType: 'researchEntity',
              entityKey: slug,
              field: 'leadHonors',
              value: outcome.honors,
              sourceUrl: outcome.sourceUrl,
              confidenceOverride: PROFILE_HONORS_CONFIDENCE,
            },
          ],
          {
            scrapeRunId: runId,
            sourceId: String(source?._id ?? ''),
            sourceName: PROFILE_HONORS_SOURCE_NAME,
            sourceWeight: PROFILE_HONORS_CONFIDENCE,
            dryRun: false,
          },
        );
        await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: false });
      }
    }
    read++;
    if (read % 100 === 0) console.log(`read ${read}/${targets.length}`);
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: guard.dbLabel,
    inScope: scoped.length,
    attempted: targets.length,
    ...tally,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.writeFileSync(outputPath, `${JSON.stringify({ summary, writes }, null, 2)}\n`);
    console.log(`report written: ${sanitizeLogValue(outputPath)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
