import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  RESEARCH_ENTITY_IDENTITY_NAME_FIELDS,
  materializeEntity,
} from '../scrapers/entityMaterializer';
import { buildObservationFingerprint, retireObservations } from '../scrapers/observationStore';
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
 * Every non-superseded branded name this lane asserted, oldest first. Superseded
 * rows are excluded rather than ranked: a retired assertion is not evidence about
 * the row as it stands, and `superseded` is the field observations actually retire
 * through.
 */
async function loadBrandObservations(): Promise<BrandObservationLike[]> {
  return Observation.find({
    entityType: 'researchEntity',
    sourceName: BACKFILL_SOURCE_NAME,
    field: 'name',
    superseded: { $ne: true },
  })
    .select('entityId entityKey value sourceId sourceUrl confidence observedAt')
    .sort({ observedAt: 1 })
    .lean<BrandObservationLike[]>();
}

interface BrandedRow {
  entity: Record<string, unknown>;
  brand: BrandObservationLike;
}

/**
 * The row each brand is evidence ABOUT, latest brand per row.
 *
 * A dedupe re-points an observation's `entityId` at the surviving row and leaves
 * `entityKey` on the merged-away slug, so reading `entityKey` alone reaches the
 * donor - archived, or deleted outright - while the live row that actually serves
 * the brand stays invisible. The materializer resolves both anchors and therefore
 * projects the brand onto the survivor (#1131), so keying this population by
 * `entityKey` asked about a row the product no longer serves: measured on
 * Development, 54 live rows served a brand whose observation is keyed to another
 * slug, and two of them were still typed faculty research with a laboratory's name
 * in the H1 (#2446).
 *
 * `entityId` wins over `entityKey` for the same reason the materializer prefers it:
 * it is the anchor a merge updates, so it names the row as it stands now.
 */
async function resolveBrandedRows(brands: BrandObservationLike[]): Promise<BrandedRow[]> {
  const entityIds = [
    ...new Set(brands.map((brand) => String(brand.entityId ?? '')).filter(Boolean)),
  ];
  const entityKeys = [
    ...new Set(brands.map((brand) => String(brand.entityKey ?? '')).filter(Boolean)),
  ];
  const entities = await ResearchEntity.find({
    $or: [{ _id: { $in: entityIds } }, { slug: { $in: entityKeys } }],
  })
    .select('_id slug name entityType kind archived manuallyLockedFields')
    .lean<Array<Record<string, unknown>>>();

  const byId = new Map(entities.map((entity) => [String(entity._id), entity]));
  const bySlug = new Map(entities.map((entity) => [String(entity.slug), entity]));

  const owned = new Map<string, BrandedRow>();
  for (const brand of brands) {
    const entity =
      byId.get(String(brand.entityId ?? '')) ?? bySlug.get(String(brand.entityKey ?? ''));
    if (!entity) continue;
    owned.set(String(entity.slug), { entity, brand });
  }
  return [...owned.values()];
}

const RETRACTION_REASON = `${SCRIPT_NAME}: brand was not read from the row's own site (#2446)`;

/**
 * Retires a lab-branded name the corpus cannot evidence, and lets the row's
 * remaining evidence name it again.
 *
 * Retracting the observation rather than writing a name is what makes this hold:
 * the brand outranks the roster's own name at 0.95 against 0.8, so a field write
 * would be undone by the next materialization while the unevidenced brand kept
 * winning. Superseding it and re-materializing hands the decision back to the
 * roster, which is the source that read the page the name was taken from.
 *
 * The lane asserts a brand as a `name` and a `displayName` twin from the same page
 * in the same moment, and both have to go. Retiring them is not enough for
 * `displayName`: the retraction does not rewrite the document and no roster source
 * emits the field, so the graft outlives its own evidence (#2351) and is cleared
 * here. `name` is never cleared, which is the same division the materializer's own
 * name authority draws, and it is safe because every serve path falls back to `name`.
 *
 * Every active assertion of this brand ON THIS ROW goes, under either anchor, rather
 * than the one the population happened to resolve through. `name` is not a
 * latest-wins fingerprint field, so a brand emitted before a dedupe (keyed to the
 * merged-away shell) and the same brand emitted after it (keyed to the survivor)
 * never supersede each other, and the materializer reads both anchors back onto the
 * one row. Retiring a single anchor pair would leave the other still winning at 0.95
 * while the run reported the name reclaimed.
 *
 * Idempotent by the observations' own state rather than by bookkeeping: a retracted
 * brand no longer loads, so the row leaves this population entirely on a re-run.
 */
async function retractUnevidencedBrands(
  retractable: LabBrandedNameTypePlanRow[],
  brandedRowsBySlug: Map<string, BrandedRow>,
): Promise<{
  brandAssertionsRetracted: number;
  namesRematerialized: Array<{ slug: string; name: string }>;
}> {
  const namesRematerialized: Array<{ slug: string; name: string }> = [];
  let brandAssertionsRetracted = 0;
  for (const row of retractable) {
    const entity = brandedRowsBySlug.get(row.slug)?.entity;
    if (!entity) continue;
    const { retired } = await retireObservations(
      {
        entityType: 'researchEntity',
        sourceName: BACKFILL_SOURCE_NAME,
        field: { $in: [...RESEARCH_ENTITY_IDENTITY_NAME_FIELDS] },
        value: row.brandedName,
        $or: [{ entityId: entity._id }, { entityKey: row.slug }],
      },
      RETRACTION_REASON,
    );
    if (retired === 0) continue;
    brandAssertionsRetracted += retired;
    await materializeEntity('researchEntity', { entityKey: row.slug }, { syncMeilisearch: false });
    await ResearchEntity.updateOne(
      { slug: row.slug, displayName: row.brandedName },
      { $unset: { displayName: '', 'fieldProvenance.displayName': '' } },
    );
    const fresh = await ResearchEntity.findOne({ slug: row.slug }).lean<Record<string, unknown>>();
    if (!fresh) continue;
    await syncEntities('researchEntity', [fresh] as never[]);
    namesRematerialized.push({ slug: row.slug, name: String(fresh.name ?? '') });
  }
  return { brandAssertionsRetracted, namesRematerialized };
}

export interface LabBrandedNameTypeResult {
  mode: 'dry-run' | 'apply';
  brandObservations: number;
  brandedRows: number;
  summary: ReturnType<typeof summarizeLabBrandedNameTypeBackfill>;
  observationsInserted: number;
  entitiesUpdated: number;
  brandAssertionsRetracted: number;
  namesRematerialized: Array<{ slug: string; name: string }>;
  synced: number;
  rows: LabBrandedNameTypePlanRow[];
}

export async function runLabBrandedNameTypeBackfill(options: {
  dryRun: boolean;
}): Promise<LabBrandedNameTypeResult> {
  const brandObservations = await loadBrandObservations();
  const brandedRows = await resolveBrandedRows(brandObservations);
  const brandedRowsBySlug = new Map(
    brandedRows.map((brandedRow) => [String(brandedRow.entity.slug), brandedRow]),
  );

  const candidates: LabBrandedNameTypeCandidate[] = brandedRows.map(({ entity, brand }) => {
    const slug = String(entity.slug);
    return {
      slug,
      storedName: entity.name,
      entityType: entity.entityType,
      kind: entity.kind,
      archived: entity.archived,
      manuallyLockedFields: entity.manuallyLockedFields,
      brandedName: brand.value,
      brandedNameSourceUrl: brand.sourceUrl,
      brandedNameObservedAt:
        brand.observedAt instanceof Date ? brand.observedAt.toISOString() : undefined,
    };
  });

  const rows = planLabBrandedNameTypeBackfill(candidates);
  const planned = rows.filter((row) => row.outcome === 'plan');
  const retractable = rows.filter((row) => row.outcome === 'brand-not-self-declared');
  const result: LabBrandedNameTypeResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    brandObservations: brandObservations.length,
    brandedRows: brandedRows.length,
    summary: summarizeLabBrandedNameTypeBackfill(rows),
    observationsInserted: 0,
    entitiesUpdated: 0,
    brandAssertionsRetracted: 0,
    namesRematerialized: [],
    synced: 0,
    rows,
  };
  if (options.dryRun) return result;

  const retracted = await retractUnevidencedBrands(retractable, brandedRowsBySlug);
  result.brandAssertionsRetracted = retracted.brandAssertionsRetracted;
  result.namesRematerialized = retracted.namesRematerialized;
  if (planned.length === 0) return result;

  const docs = planned.flatMap((row) => {
    const brandedRow = brandedRowsBySlug.get(row.slug);
    if (!brandedRow) return [];
    const { entity, brand } = brandedRow;
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
    if (apply && (result.summary.plan > 0 || result.brandAssertionsRetracted > 0)) {
      console.log(
        'entityType and name both decide the visibility gate cohort, so run student-visibility:gate next and read the tier change from that dry-run rather than from a count over student_ready.',
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
