import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { materializeAccessForResearchGroup } from '../scrapers/accessMaterializer';
import { getSourceCoverage } from '../scrapers/sourceCoverageRegistry';
import { syncEntity } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_NAME = 'research-entity-cache-backfill';

interface CliOptions {
  apply: boolean;
  limit: number;
  scanLimit: number;
  syncMeili: boolean;
}

interface PlannedObservation {
  field: string;
  value: unknown;
  confidence: number;
  sourceUrl: string;
  fingerprint: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, limit: 100, scanLimit: 0, syncMeili: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--sync-meili') options.syncMeili = true;
    else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--limit must be positive');
      options.limit = parsed;
    } else if (arg.startsWith('--scan-limit=')) {
      const parsed = Number(arg.slice('--scan-limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--scan-limit must be positive');
      options.scanLimit = parsed;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.scanLimit === 0) {
    options.scanLimit = Math.max(options.limit, 5000);
  }
  return options;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function sourceUrlForEntity(entity: any): string {
  const urls = [
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    entity.websiteUrl,
    entity.website,
  ];
  return urls.map(textValue).find((url) => /^https?:\/\//i.test(url)) || '';
}

function plannedObservations(entity: any): PlannedObservation[] {
  const sourceUrl = sourceUrlForEntity(entity);
  const out: Omit<PlannedObservation, 'fingerprint'>[] = [];
  const currentUndergradCount = Number(entity.currentUndergradCount);
  const undergradEvidenceQuote = textValue(entity.undergradEvidenceQuote);

  if (Number.isFinite(currentUndergradCount) && currentUndergradCount > 0) {
    out.push({
      field: 'currentUndergradCount',
      value: currentUndergradCount,
      confidence: 0.55,
      sourceUrl,
    });
  }
  if (entity.acceptingUndergrads === true) {
    out.push({
      field: 'acceptingUndergrads',
      value: true,
      confidence: undergradEvidenceQuote ? 0.5 : 0.35,
      sourceUrl,
    });
  }
  if (undergradEvidenceQuote) {
    out.push({
      field: 'undergradEvidenceQuote',
      value: undergradEvidenceQuote,
      confidence: 0.45,
      sourceUrl,
    });
  }

  return out.map((plan) => ({
    ...plan,
    fingerprint: [
      SOURCE_NAME,
      String(entity._id),
      plan.field,
      JSON.stringify(plan.value),
      plan.sourceUrl,
    ].join(':'),
  }));
}

function expectsPathway(plans: PlannedObservation[]): boolean {
  return plans.some(
    (plan) =>
      plan.field === 'currentUndergradCount' ||
      (plan.field === 'acceptingUndergrads' && plan.value === true),
  );
}

function expectsAccessSignal(plans: PlannedObservation[]): boolean {
  return plans.some(
    (plan) => plan.field === 'currentUndergradCount' || plan.field === 'acceptingUndergrads',
  );
}

async function ensureBackfillSource() {
  const coverage = getSourceCoverage(SOURCE_NAME);
  return Source.findOneAndUpdate(
    { name: SOURCE_NAME },
    {
      $setOnInsert: {
        name: SOURCE_NAME,
        displayName: 'ResearchEntity cache backfill',
        description:
          'One-time recovery of legacy ResearchEntity undergraduate-access cache fields into append-only observations.',
        baseUrl: '',
        defaultWeight: 0.35,
        isManualLock: false,
        enabled: true,
        cadence: 'manual-audit',
        coverage,
      },
    },
    { upsert: true, new: true },
  ).lean();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:backfill-access-from-cache',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const source: any = await ensureBackfillSource();
  const run: any = options.apply
    ? await ScrapeRun.create({
        sourceId: source._id,
        sourceName: SOURCE_NAME,
        triggeredBy: 'cli',
        startedAt: new Date(),
        status: 'running',
        options,
      })
    : undefined;
  let insertedObservationCount = 0;
  let materializationErrors = 0;

  const docs = await ResearchEntity.find({
    archived: { $ne: true },
    $or: [
      { acceptingUndergrads: true },
      { currentUndergradCount: { $gt: 0 } },
      { undergradEvidenceQuote: { $exists: true, $ne: '' } },
    ],
  })
    .select(
      '_id slug name acceptingUndergrads currentUndergradCount undergradEvidenceQuote sourceUrls websiteUrl website',
    )
    .sort({ lastObservedAt: 1, _id: 1 })
    .limit(options.scanLimit)
    .lean();

  const results: any[] = [];
  let scanned = 0;
  for (const entity of docs as any[]) {
    scanned += 1;
    const plans = plannedObservations(entity);
    const existingObservationFingerprints = new Set(
      (
        await Observation.find({
          observationFingerprint: { $in: plans.map((plan) => plan.fingerprint) },
          superseded: false,
        })
          .select('observationFingerprint')
          .lean()
      ).map((obs: any) => String(obs.observationFingerprint)),
    );
    const toCreate = plans.filter((plan) => !existingObservationFingerprints.has(plan.fingerprint));
    const existingArtifacts = await Promise.all([
      AccessSignal.countDocuments({ researchEntityId: entity._id, archived: { $ne: true } }),
      EntryPathway.countDocuments({ researchEntityId: entity._id, archived: { $ne: true } }),
    ]);
    const needsMaterialization =
      (expectsAccessSignal(plans) && existingArtifacts[0] === 0) ||
      (expectsPathway(plans) && existingArtifacts[1] === 0);

    if (toCreate.length === 0 && !needsMaterialization) continue;
    if (results.length >= options.limit) break;

    let materialized:
      | Awaited<ReturnType<typeof materializeAccessForResearchGroup>>
      | undefined;
    if (options.apply) {
      if (toCreate.length > 0) {
        await Observation.insertMany(
          toCreate.map((plan) => ({
            entityType: 'researchEntity',
            entityId: entity._id,
            entityKey: entity.slug,
            field: plan.field,
            value: plan.value,
            sourceId: source._id,
            sourceName: SOURCE_NAME,
            sourceUrl: plan.sourceUrl,
            confidence: plan.confidence,
            observedAt: new Date(),
            observationFingerprint: plan.fingerprint,
            scrapeRunId: run?._id,
          })),
        );
        insertedObservationCount += toCreate.length;
      }
      materialized = await materializeAccessForResearchGroup({
        researchEntityId: String(entity._id),
        entityKey: entity.slug,
      });
      materializationErrors += materialized.errors || 0;
      if (options.syncMeili) {
        const updated = await ResearchEntity.findById(entity._id).lean();
        if (updated) await syncEntity('researchEntity', updated);
      }
    }

    results.push({
      slug: entity.slug,
      name: entity.name,
      existingAccessSignals: existingArtifacts[0],
      existingPathways: existingArtifacts[1],
      plannedObservationCount: plans.length,
      newObservationCount: toCreate.length,
      needsMaterialization,
      action:
        toCreate.length > 0
          ? 'create-observations-and-materialize'
          : 'materialize-existing-observations',
      fields: toCreate.map((plan) => plan.field),
      materialized,
    });
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: options.apply ? 'apply' : 'preview',
        scanned,
        scanLimit: options.scanLimit,
        processedEntities: results.length,
        plannedNewObservations: results.reduce((sum, row) => sum + row.newObservationCount, 0),
        insertedObservations: insertedObservationCount,
        results: results.slice(0, 50),
      },
      null,
      2,
    ),
  );

  if (run) {
    await ScrapeRun.updateOne(
      { _id: run._id },
      {
        $set: {
          finishedAt: new Date(),
          status: materializationErrors > 0 ? 'partial' : 'success',
          observationCount: insertedObservationCount,
          entitiesObserved: results.length,
          materializationErrors,
          metrics: {
            scanned,
            processedEntities: results.length,
            plannedNewObservations: results.reduce((sum, row) => sum + row.newObservationCount, 0),
          },
        },
      },
    );
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
