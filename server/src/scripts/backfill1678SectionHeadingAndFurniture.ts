/**
 * #1678 residual backfill: refresh the two entities that were confirmed live
 * with index/careers-page furniture defects (Development, read-only audit in
 * thread 2073) whose scraper-level fixes have since landed in code but were
 * never re-scraped:
 *
 *   1. Paul L. Tipton Faculty Research (dept-physics-paul-l-tipton) - the
 *      dept-faculty-roster "Selected Presentations and Articles for a
 *      General Audience" section-heading-as-researchArea leak fixed in this
 *      change (researchAreaLabels.isPageSectionHeadingPhrase).
 *   2. International Leadership Center (center-jackson-centers-international-leadership-center)
 *      - the lab-microsite-description-llm fellows-directory-dump leak fixed
 *      upstream in #1701 (merged, closed #1678), never backfilled.
 *
 * Usage:
 *   tsx src/scripts/backfill1678SectionHeadingAndFurniture.ts
 *     Dry run: re-runs both extractors scoped to just these two entities and
 *     reports the before/after diff. Writes nothing.
 *
 *   tsx src/scripts/backfill1678SectionHeadingAndFurniture.ts --apply
 *     Persists the resulting Observations, materializes both entities, and
 *     resyncs Meili.
 *
 * Restricted to the Development database regardless of mode.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { syncEntity } from '../services/meiliSyncService';
import { DepartmentRosterScraper, DEFAULT_DEPT_CONFIGS } from '../scrapers/sources/departmentRosterScraper';
import {
  LabMicrositeDescriptionLLMExtractor,
  candidateDescriptionLabsFromDocs,
} from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../scrapers/types';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TIPTON_SLUG = 'dept-physics-paul-l-tipton';
const ILC_SLUG = 'center-jackson-centers-international-leadership-center';

function assertDevelopmentTarget(): void {
  const uri = process.env.MONGODBURL || '';
  let pathname: string;
  try {
    pathname = new URL(uri).pathname;
  } catch {
    pathname = '';
  }
  if (pathname !== '/Development') {
    throw new Error(`backfill-1678 refuses to run: MONGODBURL pathname is "${pathname}", not "/Development".`);
  }
}

async function makeCtx(
  sourceName: string,
  apply: boolean,
  captured: ObservationInput[],
  entityKeyAllowlist: Set<string>,
): Promise<ScraperContext> {
  const source = await getSourceByName(sourceName);
  if (!source) {
    throw new Error(`No Source row found for "${sourceName}". Run "yarn scrape:seed-sources" first.`);
  }

  let scrapeRunId = `backfill-1678-preview-${sourceName}`;
  if (apply) {
    const run = await ScrapeRun.create({
      sourceId: source._id,
      sourceName: source.name,
      triggeredBy: 'cli',
      startedAt: new Date(),
      status: 'running',
      options: { ignoreWorkPlanner: true, dryRun: false, triggeredVia: 'backfill-1678' } as any,
    });
    scrapeRunId = String(run._id);
  }

  return {
    scrapeRunId,
    sourceId: source._id,
    sourceName: source.name,
    sourceWeight: source.defaultWeight,
    options: {
      dryRun: !apply,
      useCache: false,
      release: false,
      ignoreWorkPlanner: true,
      exhaustive: false,
      logisticsProductionMode: false,
      dbReview: false,
      triggeredBy: 'cli',
    },
    emit: async (input) => {
      const inputs = Array.isArray(input) ? input : [input];
      captured.push(...inputs);
      const scoped = inputs.filter((obs) => obs.entityKey && entityKeyAllowlist.has(obs.entityKey));
      if (apply && scoped.length > 0) {
        await appendObservations(scoped, {
          scrapeRunId,
          sourceId: source._id,
          sourceName: source.name,
          sourceWeight: source.defaultWeight,
          dryRun: false,
        });
      }
    },
    log: (msg, meta) => {
      if (meta) console.log('[backfill-1678]', msg, sanitizeLogValue(meta));
      else console.log('[backfill-1678]', msg);
    },
  };
}

async function runTiptonRescrape(apply: boolean): Promise<ObservationInput[]> {
  const physicsConfig = DEFAULT_DEPT_CONFIGS.find((c) => c.deptKey === 'physics');
  if (!physicsConfig) throw new Error('physics dept config not found in DEFAULT_DEPT_CONFIGS');

  const captured: ObservationInput[] = [];
  const allowlist = new Set([TIPTON_SLUG, 'netid:paul.tipton']);
  const ctx = await makeCtx('dept-faculty-roster', apply, captured, allowlist);
  const scraper = new DepartmentRosterScraper([physicsConfig]);
  await scraper.run(ctx);
  return captured.filter((obs) => obs.entityKey === TIPTON_SLUG);
}

async function runIlcRescrape(apply: boolean): Promise<ObservationInput[]> {
  const doc = await ResearchEntity.findOne({ slug: ILC_SLUG })
    .select('_id slug name websiteUrl website sourceUrls manuallyLockedFields entityType kind school schools departments')
    .lean();
  if (!doc) throw new Error(`No research_entities doc found for slug "${ILC_SLUG}"`);
  const candidates = candidateDescriptionLabsFromDocs([doc as any]);
  if (candidates.length === 0) throw new Error(`ILC doc has no usable websiteUrl candidate: ${JSON.stringify(doc)}`);

  const captured: ObservationInput[] = [];
  const allowlist = new Set([ILC_SLUG]);
  const ctx = await makeCtx('lab-microsite-description-llm', apply, captured, allowlist);
  const extractor = new LabMicrositeDescriptionLLMExtractor({
    labFinder: async () => candidates,
  });
  await extractor.run(ctx);
  return captured.filter((obs) => obs.entityKey === ILC_SLUG);
}

async function main(): Promise<void> {
  assertDevelopmentTarget();
  await initializeConnections();

  const apply = process.argv.includes('--apply');
  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);

  const before = await ResearchEntity.find({ slug: { $in: [TIPTON_SLUG, ILC_SLUG] } })
    .select('slug researchAreas fullDescription shortDescription')
    .lean<Array<{ slug: string; researchAreas?: string[]; fullDescription?: string; shortDescription?: string }>>();
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  const tiptonObs = await runTiptonRescrape(apply);
  console.log(
    `Tipton: ${tiptonObs.length} observation(s) captured -`,
    JSON.stringify(tiptonObs.map((o) => ({ field: o.field, value: o.value }))),
  );

  const ilcObs = await runIlcRescrape(apply);
  console.log(
    `ILC: ${ilcObs.length} observation(s) captured -`,
    JSON.stringify(ilcObs.map((o) => ({ field: o.field, value: o.value }))),
  );

  if (apply) {
    for (const slug of [TIPTON_SLUG, ILC_SLUG]) {
      await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: false });
      const fresh = await ResearchEntity.findOne({ slug }).lean();
      if (fresh) await syncEntity('researchEntity', fresh);
    }
  }

  const after = await ResearchEntity.find({ slug: { $in: [TIPTON_SLUG, ILC_SLUG] } })
    .select('slug researchAreas fullDescription shortDescription studentVisibilityTier')
    .lean();
  console.log('AFTER:', JSON.stringify(after, null, 2));

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error('backfill-1678 failed:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
