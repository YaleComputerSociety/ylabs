import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { buildObservationFingerprint } from '../scrapers/observationStore';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  BACKFILL_ENTITY_TYPE,
  BACKFILL_KIND,
  BACKFILL_SOURCE_NAME,
  planLabBrandedNameTypeBackfill,
  summarizeLabBrandedNameTypeBackfill,
  type LabBrandedNameTypeCandidate,
  type LabBrandedNameTypePlanRow,
} from './labBrandedNameTypeBackfillCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:backfill-lab-branded-name-type';

export interface LabBrandedNameTypeCliOptions {
  dryRun: boolean;
  confirm: boolean;
  output?: string;
}

export function parseLabBrandedNameTypeArgs(argv: string[]): LabBrandedNameTypeCliOptions {
  const options: LabBrandedNameTypeCliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-lab-branded-name-type') options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

interface BrandObservationLike {
  entityId?: unknown;
  entityKey?: unknown;
  value?: unknown;
  sourceId?: unknown;
  sourceUrl?: unknown;
  confidence?: unknown;
  observedAt?: unknown;
}

/**
 * The latest non-superseded branded name this lane asserted per row. Superseded
 * rows are excluded rather than ranked: a retired assertion is not evidence about
 * the row as it stands, and `superseded` is the field observations actually retire
 * through.
 */
async function loadBrandObservations(): Promise<Map<string, BrandObservationLike>> {
  const docs = await Observation.find({
    entityType: 'researchEntity',
    sourceName: BACKFILL_SOURCE_NAME,
    field: 'name',
    superseded: { $ne: true },
  })
    .select('entityId entityKey value sourceId sourceUrl confidence observedAt')
    .sort({ observedAt: 1 })
    .lean<BrandObservationLike[]>();

  const latest = new Map<string, BrandObservationLike>();
  for (const doc of docs) {
    const key = typeof doc.entityKey === 'string' ? doc.entityKey : '';
    if (key) latest.set(key, doc);
  }
  return latest;
}

export interface LabBrandedNameTypeResult {
  mode: 'dry-run' | 'apply';
  brandObservations: number;
  summary: ReturnType<typeof summarizeLabBrandedNameTypeBackfill>;
  observationsInserted: number;
  entitiesUpdated: number;
  synced: number;
  rows: LabBrandedNameTypePlanRow[];
}

export async function runLabBrandedNameTypeBackfill(options: {
  dryRun: boolean;
}): Promise<LabBrandedNameTypeResult> {
  const brands = await loadBrandObservations();
  const entities = await ResearchEntity.find({ slug: { $in: [...brands.keys()] } })
    .select('_id slug name entityType kind archived manuallyLockedFields')
    .lean<Array<Record<string, unknown>>>();

  const candidates: LabBrandedNameTypeCandidate[] = entities.map((entity) => {
    const slug = String(entity.slug);
    const brand = brands.get(slug);
    return {
      slug,
      storedName: entity.name,
      entityType: entity.entityType,
      kind: entity.kind,
      archived: entity.archived,
      manuallyLockedFields: entity.manuallyLockedFields,
      brandedName: brand?.value,
      brandedNameSourceUrl: brand?.sourceUrl,
      brandedNameObservedAt:
        brand?.observedAt instanceof Date ? brand.observedAt.toISOString() : undefined,
    };
  });

  const rows = planLabBrandedNameTypeBackfill(candidates);
  const planned = rows.filter((row) => row.outcome === 'plan');
  const result: LabBrandedNameTypeResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    brandObservations: brands.size,
    summary: summarizeLabBrandedNameTypeBackfill(rows),
    observationsInserted: 0,
    entitiesUpdated: 0,
    synced: 0,
    rows,
  };
  if (options.dryRun || planned.length === 0) return result;

  const entityBySlug = new Map(entities.map((entity) => [String(entity.slug), entity]));
  const docs = planned.flatMap((row) => {
    const brand = brands.get(row.slug);
    const entity = entityBySlug.get(row.slug);
    if (!brand || !entity) return [];
    const shared = {
      entityType: 'researchEntity' as const,
      entityId: entity._id,
      entityKey: row.slug,
      sourceId: brand.sourceId,
      sourceName: BACKFILL_SOURCE_NAME,
      sourceUrl: brand.sourceUrl,
      confidence: typeof brand.confidence === 'number' ? brand.confidence : 0.95,
      observedAt: brand.observedAt ?? new Date(),
    };
    return [
      { field: 'entityType', value: BACKFILL_ENTITY_TYPE },
      { field: 'kind', value: BACKFILL_KIND },
    ].map((assertion) => ({
      ...shared,
      ...assertion,
      observationFingerprint: buildObservationFingerprint({
        sourceName: BACKFILL_SOURCE_NAME,
        entityType: 'researchEntity',
        entityId: entity._id,
        entityKey: row.slug,
        field: assertion.field,
        value: assertion.value,
      }),
    }));
  });

  if (docs.length > 0) {
    const inserted = await Observation.insertMany(docs, { ordered: false });
    result.observationsInserted = inserted.length;
  }

  await ResearchEntity.bulkWrite(
    planned.map((row) => ({
      updateOne: {
        filter: { slug: row.slug },
        update: { $set: { entityType: BACKFILL_ENTITY_TYPE, kind: BACKFILL_KIND } },
      },
    })),
  );
  const updated = await ResearchEntity.find({ slug: { $in: planned.map((row) => row.slug) } })
    .select('slug entityType kind')
    .lean();
  result.entitiesUpdated = updated.filter(
    (entity) => (entity as { entityType?: string }).entityType === BACKFILL_ENTITY_TYPE,
  ).length;

  const fresh = await ResearchEntity.find({ slug: { $in: planned.map((row) => row.slug) } }).lean();
  await syncEntities('researchEntity', fresh as never[]);
  result.synced = fresh.length;
  return result;
}

async function main(): Promise<void> {
  const options = parseLabBrandedNameTypeArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error(`${SCRIPT_NAME} apply mode requires --confirm-lab-branded-name-type.`);
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runLabBrandedNameTypeBackfill({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        `${JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, ...result },
          null,
          2,
        )}\n`,
      );
      console.log(`Saved lab-branded-name type report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ ...result, rows: result.rows.slice(0, 40) }, null, 2));
    if (apply && result.summary.plan > 0) {
      console.log(
        'entityType decides the visibility gate cohort, so run student-visibility:gate next and read the tier change from that dry-run rather than from a count over student_ready.',
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
