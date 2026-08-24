/**
 * #1372 backfill: re-scrape and re-materialize currentUndergradCount for
 * entities whose stored count was written before #1325's recency/institution
 * gate (deriveCurrentUndergradCount) existed.
 *
 * Usage:
 *   tsx src/scripts/backfill1372UndergradCountRescrape.ts [--slugs a,b,c] [--output <path>]
 *     Dry run: discovers targets (or uses --slugs), re-runs the corrected
 *     extraction live against each lab's website, and reports the before/after
 *     currentUndergradCount diff. Writes nothing.
 *
 *   tsx src/scripts/backfill1372UndergradCountRescrape.ts --apply [--slugs a,b,c]
 *     Re-runs extraction, persists the resulting Observations, and
 *     field-scopes materialization to currentUndergradCount +
 *     undergradEvidenceQuote. materializeEntity's own apply path
 *     unconditionally recomputes access signals, resyncs Meili, and
 *     recomputes browseRankScore per entity, so no separate resync/browse-rank
 *     step is needed here.
 *
 * Restricted to the Development database regardless of mode.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { materializeEntity, shouldIgnoreObservationForEntityMaterialization } from '../scrapers/entityMaterializer';
import { syncEntity } from '../services/meiliSyncService';
import {
  LabMicrositeUndergradLLMExtractor,
  candidateLabFromResearchEntityDoc,
  type CandidateLab,
} from '../scrapers/sources/labMicrositeUndergradLLMExtractor';
import type { ObservationInput, ScraperContext } from '../scrapers/types';
import { buildRematerializeFieldChanges } from './rematerializeResearchEntitiesCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  BACKFILL_1372_SOURCE_NAME,
  BACKFILL_1372_WRITE_ONLY_FIELDS,
  isContaminatedUndergradEvidenceQuote,
  isLegacyCurrentUndergradCountObservation,
  parseBackfill1372Args,
  selectBackfillTargetSlugs,
  selectContaminatedEvidenceQuoteObservations,
  type CandidateEntitySummary,
} from './backfill1372UndergradCountRescrapeCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TRACKED_FIELDS_FOR_REPORT = [...BACKFILL_1372_WRITE_ONLY_FIELDS] as const;

function assertDevelopmentTarget(): void {
  const uri = process.env.MONGODBURL || '';
  let pathname: string;
  try {
    pathname = new URL(uri).pathname;
  } catch {
    pathname = '';
  }
  if (pathname !== '/Development') {
    throw new Error(
      `backfill-1372 refuses to run: MONGODBURL pathname is "${pathname}", not "/Development".`,
    );
  }
}

async function discoverTargetSlugs(): Promise<string[]> {
  const legacyObservations = await Observation.find({
    entityType: 'researchEntity',
    field: 'currentUndergradCount',
    sourceName: BACKFILL_1372_SOURCE_NAME,
    superseded: false,
  })
    .select('entityKey observedAt')
    .lean<Array<{ entityKey?: string; observedAt?: Date }>>();

  const legacySlugs = new Set(
    legacyObservations
      .filter((obs) => obs.entityKey && isLegacyCurrentUndergradCountObservation(obs.observedAt))
      .map((obs) => obs.entityKey as string),
  );
  if (legacySlugs.size === 0) return [];

  const entities = await ResearchEntity.find({
    slug: { $in: Array.from(legacySlugs) },
    archived: { $ne: true },
  })
    .select('slug currentUndergradCount manuallyLockedFields')
    .lean<CandidateEntitySummary[]>();

  return selectBackfillTargetSlugs(legacySlugs, entities);
}

interface EntityDiff {
  slug: string;
  before: number | undefined;
  after: number | undefined;
  changed: boolean;
}

async function runExtractionForSlugs(
  slugs: string[],
  apply: boolean,
): Promise<{ observations: ObservationInput[]; fetchFailed: number; llmFailed: number }> {
  const docs = await ResearchEntity.find({ slug: { $in: slugs } })
    .select('_id slug name websiteUrl website sourceUrls archived manuallyLockedFields')
    .lean();
  const candidateLabs: CandidateLab[] = docs
    .map(candidateLabFromResearchEntityDoc)
    .filter((lab) => lab.websiteUrl);

  const captured: ObservationInput[] = [];
  const source = await getSourceByName(BACKFILL_1372_SOURCE_NAME);
  if (!source) {
    throw new Error(`No Source row found for "${BACKFILL_1372_SOURCE_NAME}". Run "yarn scrape:seed-sources" first.`);
  }

  let scrapeRunId = 'backfill-1372-preview';
  if (apply) {
    const run = await ScrapeRun.create({
      sourceId: source._id,
      sourceName: source.name,
      triggeredBy: 'cli',
      startedAt: new Date(),
      status: 'running',
      options: { only: slugs, ignoreWorkPlanner: true, dryRun: false, triggeredVia: 'backfill-1372' } as any,
    });
    scrapeRunId = String(run._id);
  }

  const ctx: ScraperContext = {
    scrapeRunId,
    sourceId: source._id,
    sourceName: source.name,
    sourceWeight: source.defaultWeight,
    options: {
      dryRun: !apply,
      useCache: true,
      release: false,
      only: undefined,
      limit: candidateLabs.length,
      ignoreWorkPlanner: true,
      exhaustive: false,
      logisticsProductionMode: false,
      dbReview: false,
      triggeredBy: 'cli',
    },
    emit: async (input) => {
      const inputs = Array.isArray(input) ? input : [input];
      captured.push(...inputs);
      if (apply) {
        await appendObservations(inputs, {
          scrapeRunId,
          sourceId: source._id,
          sourceName: source.name,
          sourceWeight: source.defaultWeight,
          dryRun: false,
        });
      }
    },
    log: (msg, meta) => {
      if (meta) console.log(`[backfill-1372]`, msg, sanitizeLogValue(meta));
      else console.log(`[backfill-1372]`, msg);
    },
  };

  const extractor = new LabMicrositeUndergradLLMExtractor({
    labFinder: async () => candidateLabs,
  });
  const result = await extractor.run(ctx);

  if (apply) {
    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      {
        $set: {
          finishedAt: new Date(),
          status: 'success',
          observationCount: captured.length,
          entitiesObserved: result.entitiesObserved,
          fetchMetrics: result.fetchMetrics,
          metrics: result.metrics,
        },
      },
    );
  }

  const notes = result.notes || '';
  const fetchFailedMatch = /(\d+) fetch-failed/.exec(notes);
  const llmFailedMatch = /(\d+) llm-failed/.exec(notes);
  return {
    observations: captured,
    fetchFailed: fetchFailedMatch ? Number(fetchFailedMatch[1]) : 0,
    llmFailed: llmFailedMatch ? Number(llmFailedMatch[1]) : 0,
  };
}

interface EvidenceQuoteSweepResult {
  contaminatedCount: number;
  affectedSlugs: string[];
  rematerializedSlugs: string[];
}

/**
 * undergradEvidenceQuote's #1325 gate gap (#1372) let historical/non-Yale
 * quotes reach production from ANY source, not just entities discovered via
 * the currentUndergradCount legacy-timestamp check. This sweeps every active
 * undergradEvidenceQuote Observation corpus-wide and supersedes the
 * contaminated ones so resolution falls back to a clean value (or clears the
 * field when none remains) rather than continuing to surface a bad quote.
 */
async function sweepContaminatedEvidenceQuotes(apply: boolean): Promise<EvidenceQuoteSweepResult> {
  const activeQuoteObservations = await Observation.find({
    entityType: 'researchEntity',
    field: 'undergradEvidenceQuote',
    superseded: false,
  })
    .select('_id entityKey value')
    .lean<Array<{ _id: unknown; entityKey?: string; value: unknown }>>();

  const contaminatedObservations = selectContaminatedEvidenceQuoteObservations(
    activeQuoteObservations.map((obs) => ({
      id: String(obs._id),
      entityKey: obs.entityKey || '',
      value: obs.value,
    })),
  );

  // The materialized ResearchEntity field is the ground truth for what's
  // actually served, and can carry a contaminated value even when every
  // backing Observation is already superseded (e.g. a prior run superseded
  // the Observation but materializeEntity never $unsets a field down to
  // nothing - see restrictMaterializerSetToFields). Check it directly rather
  // than trusting Observation state alone.
  const materializedEntities = await ResearchEntity.find({
    undergradEvidenceQuote: { $exists: true, $ne: '' },
  })
    .select('slug undergradEvidenceQuote')
    .lean<Array<{ slug: string; undergradEvidenceQuote?: string }>>();
  const materializedContaminatedSlugs = materializedEntities
    .filter((entity) => isContaminatedUndergradEvidenceQuote(entity.undergradEvidenceQuote))
    .map((entity) => entity.slug);

  const affectedSlugs = Array.from(
    new Set([
      ...contaminatedObservations.map((obs) => obs.entityKey).filter(Boolean),
      ...materializedContaminatedSlugs,
    ]),
  ).sort();

  const rematerializedSlugs: string[] = [];
  if (apply && affectedSlugs.length > 0) {
    if (contaminatedObservations.length > 0) {
      await Observation.updateMany(
        { _id: { $in: contaminatedObservations.map((obs) => obs.id) } },
        { $set: { superseded: true } },
      );
    }

    const stillActive = await Observation.find({
      entityType: 'researchEntity',
      field: 'undergradEvidenceQuote',
      entityKey: { $in: affectedSlugs },
      superseded: false,
    })
      .select('entityKey field value')
      .lean<Array<{ entityKey?: string; field: string; value: unknown }>>();
    // Mirror materializeEntity's own exclusion so "has a candidate" matches what
    // it will actually resolve to, not just "an active Observation exists" -
    // shouldIgnoreObservationForEntityMaterialization also drops implausible or
    // recency/institution-gated quotes (see #1372).
    const slugsWithRemainingObservation = new Set(
      stillActive
        .filter((obs) => !shouldIgnoreObservationForEntityMaterialization('researchEntity', obs))
        .map((obs) => obs.entityKey)
        .filter(Boolean),
    );

    for (const slug of affectedSlugs) {
      if (slugsWithRemainingObservation.has(slug)) {
        // materializeEntity never $unsets a field with zero active observations
        // (see restrictMaterializerSetToFields), so it only suffices when a
        // clean observation remains for the resolver to fall back to.
        await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: false, writeOnlyFields: ['undergradEvidenceQuote'] });
      } else {
        await ResearchEntity.updateOne(
          { slug },
          { $unset: { undergradEvidenceQuote: '', 'confidenceByField.undergradEvidenceQuote': '' } },
        );
        const fresh = await ResearchEntity.findOne({ slug }).lean();
        if (fresh) await syncEntity('researchEntity', fresh);
      }
      rematerializedSlugs.push(slug);
    }
  }

  return { contaminatedCount: contaminatedObservations.length, affectedSlugs, rematerializedSlugs };
}

function diffForSlug(
  slug: string,
  before: number | undefined,
  observations: ObservationInput[],
): EntityDiff {
  const countObs = observations.find((obs) => obs.entityKey === slug && obs.field === 'currentUndergradCount');
  const after = typeof countObs?.value === 'number' ? countObs.value : before;
  return { slug, before, after, changed: (before ?? 0) !== (after ?? 0) };
}

async function main(): Promise<void> {
  assertDevelopmentTarget();
  await initializeConnections();

  const args = parseBackfill1372Args(process.argv.slice(2));
  const targetSlugs = args.slugs && args.slugs.length > 0 ? args.slugs : await discoverTargetSlugs();

  console.log(`Target entities: ${targetSlugs.length}`);
  console.log(targetSlugs.join(', ') || '(none)');

  if (targetSlugs.length === 0) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const before = await ResearchEntity.find({ slug: { $in: targetSlugs } })
    .select('slug currentUndergradCount')
    .lean<Array<{ slug: string; currentUndergradCount?: number }>>();
  const beforeBySlug = new Map(before.map((entity) => [entity.slug, entity.currentUndergradCount]));

  const { observations, fetchFailed, llmFailed } = await runExtractionForSlugs(targetSlugs, args.apply);

  const diffs = targetSlugs.map((slug) => diffForSlug(slug, beforeBySlug.get(slug), observations));
  const changedCount = diffs.filter((diff) => diff.changed).length;

  console.log(
    `Extraction complete. fetchFailed=${fetchFailed} llmFailed=${llmFailed} entitiesWithChangedCount=${changedCount}/${targetSlugs.length}`,
  );
  for (const diff of diffs.filter((d) => d.changed)) {
    console.log(`  ${diff.slug}: ${diff.before ?? 0} -> ${diff.after ?? 0}`);
  }

  const materializeReports: Array<{
    slug: string;
    fieldsWritten?: number;
    changes: ReturnType<typeof buildRematerializeFieldChanges>;
  }> = [];

  if (args.apply) {
    for (const slug of targetSlugs) {
      const beforeDoc = await ResearchEntity.findOne({ slug })
        .select(TRACKED_FIELDS_FOR_REPORT.join(' '))
        .lean<Record<string, unknown>>();
      if (!beforeDoc) continue;
      const result = await materializeEntity(
        'researchEntity',
        { entityKey: slug },
        { dryRun: false, writeOnlyFields: [...BACKFILL_1372_WRITE_ONLY_FIELDS] },
      );
      const afterDoc = await ResearchEntity.findOne({ slug })
        .select(TRACKED_FIELDS_FOR_REPORT.join(' '))
        .lean<Record<string, unknown>>();
      const changes = buildRematerializeFieldChanges(
        beforeDoc,
        (afterDoc as Record<string, unknown>) || {},
        {},
        TRACKED_FIELDS_FOR_REPORT,
      );
      materializeReports.push({ slug, fieldsWritten: result.fieldsWritten, changes });
    }
    console.log(
      `Materialized ${materializeReports.length} entities; ${materializeReports.filter((r) => r.changes.length > 0).length} changed.`,
    );
  }

  const evidenceQuoteSweep = await sweepContaminatedEvidenceQuotes(args.apply);
  console.log(
    `Evidence-quote sweep: ${evidenceQuoteSweep.contaminatedCount} contaminated observation(s) across ${evidenceQuoteSweep.affectedSlugs.length} entities.`,
  );
  if (evidenceQuoteSweep.affectedSlugs.length > 0) {
    console.log(`  ${evidenceQuoteSweep.affectedSlugs.join(', ')}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    targetSlugs,
    fetchFailed,
    llmFailed,
    entitiesWithChangedCount: changedCount,
    diffs,
    materializeReports,
    evidenceQuoteSweep,
  };
  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error('backfill-1372 failed:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
