import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { getResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';
import {
  deriveCanonicalResearchAreasFromPage,
  researchAreaObservationsFromExtraction,
} from '../scrapers/sources/researchAreaSourceExtractor';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { syncEntities } from '../services/meiliSyncService';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planListingItemAreaRepair,
  type ListingItemAreaProbe,
} from './retireListingItemResearchAreasCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-areas:retire-listing-item-harvests';
export const CONFIRM_FLAG = '--confirm-retire-listing-item-areas';
const SOURCE_NAME = 'research-area-source-extractor';
const PROBE_CONCURRENCY = 4;

export const LISTING_ITEM_AREA_ROLLBACK_REASON =
  'research areas harvested from a listing item about another subject (#2734)';

export interface RetireListingItemAreaOptions {
  dryRun: boolean;
  confirmed: boolean;
  limit?: number;
  only: string[];
  output?: string;
}

export function parseRetireListingItemAreaArgs(argv: string[]): RetireListingItemAreaOptions {
  const options: RetireListingItemAreaOptions = { dryRun: true, confirmed: false, only: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length));
    } else if (arg === '--only') {
      options.only.push(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--only=')) {
      options.only.push(arg.slice('--only='.length));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  return options;
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

interface ActiveAreaObservation {
  observationId: string;
  entityId?: string;
  entityKey?: string;
  sourceUrl: string;
  assertedAreas: string[];
  observedAt: number;
}

export function newestObservationPerEntity(
  rows: ActiveAreaObservation[],
): Map<string, ActiveAreaObservation> {
  const newest = new Map<string, ActiveAreaObservation>();
  for (const row of rows) {
    const key = row.entityId || row.entityKey;
    if (!key) continue;
    const current = newest.get(key);
    if (!current || row.observedAt > current.observedAt) newest.set(key, row);
  }
  return newest;
}

async function main(): Promise<void> {
  const options = parseRetireListingItemAreaArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();
  const canonicalizer = await getResearchAreaCanonicalizer();

  const observationDocs = (await Observation.find({
    entityType: 'researchEntity',
    field: 'researchAreas',
    sourceName: SOURCE_NAME,
    superseded: { $ne: true },
  })
    .select('_id entityId entityKey sourceUrl value observedAt')
    .lean()) as unknown as Array<{
    _id: unknown;
    entityId?: unknown;
    entityKey?: string;
    sourceUrl?: string;
    value?: unknown;
    observedAt?: Date;
  }>;

  const active: ActiveAreaObservation[] = observationDocs.flatMap((row) => {
    const observationId = serializedDocumentId(row._id);
    const assertedAreas = stringList(row.value);
    if (!observationId || !row.sourceUrl || assertedAreas.length === 0) return [];
    return [
      {
        observationId,
        entityId: serializedDocumentId(row.entityId) || undefined,
        entityKey: row.entityKey,
        sourceUrl: row.sourceUrl,
        assertedAreas,
        observedAt: row.observedAt ? new Date(row.observedAt).getTime() : 0,
      },
    ];
  });

  const newest = [...newestObservationPerEntity(active).values()];
  const entityDocs = (await ResearchEntity.find({
    archived: { $ne: true },
    $or: [
      {
        _id: {
          $in: newest
            .filter((row) => row.entityId)
            .map((row) => new mongoose.Types.ObjectId(row.entityId as string)),
        },
      },
      { slug: { $in: newest.flatMap((row) => (row.entityKey ? [row.entityKey] : [])) } },
    ],
  })
    .select('_id slug researchAreas')
    .lean()) as unknown as Array<{ _id: unknown; slug?: string; researchAreas?: unknown }>;

  const liveById = new Map<string, { entityId: string; slug?: string; storedAreas: string[] }>();
  const liveBySlug = new Map<string, { entityId: string; slug?: string; storedAreas: string[] }>();
  for (const doc of entityDocs) {
    const entityId = serializedDocumentId(doc._id);
    if (!entityId) continue;
    const live = { entityId, slug: doc.slug, storedAreas: stringList(doc.researchAreas) };
    liveById.set(entityId, live);
    if (doc.slug) liveBySlug.set(doc.slug, live);
  }

  const onlyKeys = new Set(options.only.filter(Boolean));
  const targets = newest.flatMap((row) => {
    const live =
      (row.entityId ? liveById.get(row.entityId) : undefined) ||
      (row.entityKey ? liveBySlug.get(row.entityKey) : undefined);
    if (!live) return [];
    if (onlyKeys.size > 0 && !onlyKeys.has(live.slug || '') && !onlyKeys.has(live.entityId)) {
      return [];
    }
    return [{ row, live }];
  });
  const bounded = options.limit === undefined ? targets : targets.slice(0, options.limit);

  const probes: ListingItemAreaProbe[] = [];
  await mapWithConcurrency(bounded, PROBE_CONCURRENCY, async ({ row, live }) => {
    let rederivedAreas: string[] | null = null;
    try {
      const page = await fetchPageWithPolicy(row.sourceUrl);
      if (page.html) {
        rederivedAreas = deriveCanonicalResearchAreasFromPage(canonicalizer, page.html).areas;
      }
    } catch (error) {
      console.error(`[${live.slug || live.entityId}] probe failed: ${sanitizeLogValue(error)}`);
    }
    probes.push({
      entityId: live.entityId,
      slug: live.slug,
      observationId: row.observationId,
      sourceUrl: row.sourceUrl,
      assertedAreas: row.assertedAreas,
      storedAreas: live.storedAreas,
      rederivedAreas,
    });
  });

  const plan = planListingItemAreaRepair(probes);

  let retiredObservations = 0;
  let appendedCorrections = 0;
  let clearedStoredAreas = 0;
  let rematerializedEntities = 0;
  const touchedIds: string[] = [];

  if (!options.dryRun) {
    const source = await getSourceByName(SOURCE_NAME);
    const repairRunId = new mongoose.Types.ObjectId().toString();
    for (const decision of plan.decisions) {
      if (!decision.retiresObservation) continue;
      const retired = await Observation.updateOne(
        { _id: new mongoose.Types.ObjectId(decision.observationId), superseded: { $ne: true } },
        {
          $set: {
            superseded: true,
            rollback: {
              rolledBackAt: new Date(),
              reason: LISTING_ITEM_AREA_ROLLBACK_REASON,
            },
          },
        },
      );
      retiredObservations += retired.modifiedCount || 0;

      if (decision.appendsCorrectedObservation && source) {
        const corrected = researchAreaObservationsFromExtraction(
          { areas: decision.correctedAreas, labeledBacked: false },
          {
            entityId: decision.entityId,
            entityKey: decision.slug,
            sourceUrl: decision.sourceUrl,
          },
        );
        if (corrected.length) {
          await appendObservations(corrected, {
            sourceId: source._id,
            sourceName: SOURCE_NAME,
            scrapeRunId: repairRunId,
            sourceWeight: source.defaultWeight,
            dryRun: false,
          });
          appendedCorrections += 1;
        }
      }

      // Retiring the observation does not clear the document: `researchAreas` is
      // not clear-on-empty, so a row whose only assertion was the listing-item
      // harvest would keep serving it. Keyed on the stored value still being the
      // retracted one, read at apply time.
      if (decision.clearsStoredAreas) {
        const cleared = await ResearchEntity.updateOne(
          {
            _id: new mongoose.Types.ObjectId(decision.entityId),
            researchAreas: { $all: decision.assertedAreas, $size: decision.assertedAreas.length },
          },
          { $set: { researchAreas: [] }, $unset: { 'fieldProvenance.researchAreas': '' } },
        );
        clearedStoredAreas += cleared.modifiedCount || 0;
      }

      if (decision.slug) {
        await materializeEntity('researchEntity', { entityKey: decision.slug });
        rematerializedEntities += 1;
      }
      touchedIds.push(decision.entityId);
    }
  }

  let visibilityTierChanges = 0;
  let resyncedEntities = 0;
  if (!options.dryRun && touchedIds.length > 0) {
    const gate = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: touchedIds,
    });
    visibilityTierChanges = gate.counts.changed;
    const fresh = await ResearchEntity.find({
      _id: { $in: touchedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    await syncEntities('researchEntity', fresh);
    resyncedEntities = fresh.length;
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    activeObservations: active.length,
    entitiesProbed: probes.length,
    verdicts: plan.counts,
    plannedObservationRetirements: plan.observationsToRetire,
    plannedCorrectedObservations: plan.correctedObservationsToAppend,
    plannedStoredFieldClears: plan.storedFieldsToClear,
    plannedAreaWithdrawals: plan.areasWithdrawn,
    retiredObservations,
    appendedCorrections,
    clearedStoredAreas,
    rematerializedEntities,
    visibilityTierChanges,
    resyncedEntities,
    withdrawals: plan.decisions
      .filter((decision) => decision.withdrawnAreas.length > 0)
      .map((decision) => ({
        slug: decision.slug,
        verdict: decision.verdict,
        sourceUrl: decision.sourceUrl,
        withdrawn: decision.withdrawnAreas,
        kept: decision.correctedAreas,
      })),
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${options.output}`);
  }

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
