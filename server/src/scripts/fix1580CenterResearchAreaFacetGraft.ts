import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { isListingOrIndexUrl } from '../utils/researchHomeWebsiteUrl';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  isResearchAreaFacetGraftObservation,
  planUnbackedResearchAreaClear,
  type UnbackedResearchAreaClearResult,
} from './fix1580CenterResearchAreaFacetGraftCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:fix-1580-center-research-area-facet-graft';
const ROLLBACK_REASON =
  'research-area-source-extractor fell back to a shared cores/centers-institutes listing page and grafted its aggregate content as this entity\'s own researchAreas (#1580)';

// #585-style residue with no observation to roll back: a `researchAreas` value
// written before the observation pipeline existed for this record, which a
// stranded-field sweep can never reach because it has no observation history
// to key off of.
const UNBACKED_EXTRA_SLUGS = ['leaderer-lab-bpl2'];

export interface Fix1580Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

export function parseArgs(argv: string[]): Fix1580Args {
  const args: Fix1580Args = { apply: false, confirm: false, maxApply: 200 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-fix-1580') args.confirm = true;
    else if (arg.startsWith('--max-apply=')) args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  return args;
}

interface GraftedObservationRow {
  observationId: string;
  entitySlug?: string;
  entityId?: string;
  sourceUrl?: string;
  value: unknown;
}

// All observations ever minted with the graft signature, active or already
// superseded, so a re-run after --apply still identifies the full affected
// cohort for the stranded-field sweep below.
async function loadGraftObservationRecords(): Promise<any[]> {
  const observations = await Observation.find({
    entityType: 'researchEntity',
    field: 'researchAreas',
    sourceName: 'research-area-source-extractor',
  })
    .select('_id entityKey entityId sourceUrl value superseded')
    .lean();
  return (observations as any[]).filter((obs) =>
    isResearchAreaFacetGraftObservation(
      {
        entityType: 'researchEntity',
        field: 'researchAreas',
        sourceName: 'research-area-source-extractor',
        sourceUrl: obs.sourceUrl,
        superseded: false,
      },
      isListingOrIndexUrl,
    ),
  );
}

export async function loadGraftedObservations(): Promise<GraftedObservationRow[]> {
  const records = await loadGraftObservationRecords();
  return records
    .filter((obs) => obs.superseded !== true)
    .map((obs) => ({
      observationId: serializedDocumentId(obs._id) || '',
      entitySlug: obs.entityKey,
      entityId: obs.entityId ? serializedDocumentId(obs.entityId) : undefined,
      sourceUrl: obs.sourceUrl,
      value: obs.value,
    }));
}

async function applyGraftRollback(rows: GraftedObservationRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ids = rows.map((row) => new mongoose.Types.ObjectId(row.observationId));
  const result = await Observation.updateMany(
    { _id: { $in: ids }, superseded: { $ne: true } },
    { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON } } },
  );
  return result.modifiedCount || 0;
}

/**
 * A superseded observation only stops contributing at the *next* materialize
 * pass, and materialize leaves a field untouched (not cleared) once zero
 * observations remain for it - so a center whose graft was its only
 * researchAreas signal is left holding the stale grafted value even after the
 * observation backing it is rolled back and the entity is rematerialized.
 * This sweep clears exactly that stranded case, scoped to the entities this
 * fix actually touched. The graft observation ids are excluded from the
 * "still backed" count (rather than requiring rollback to have already run)
 * so the plan is identical in dry-run and apply mode.
 */
export async function loadStrandedResearchAreaClearPlans(): Promise<UnbackedResearchAreaClearResult[]> {
  const graftRecords = await loadGraftObservationRecords();
  const graftObservationIds = graftRecords.map((obs) => obs._id);
  const entityIds = new Set<string>();
  for (const obs of graftRecords) {
    const id = obs.entityId ? serializedDocumentId(obs.entityId) : undefined;
    if (id) entityIds.add(id);
  }

  const byId = await ResearchEntity.find({ _id: { $in: [...entityIds].map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('slug researchAreas')
    .lean();
  const bySlug = await ResearchEntity.find({ slug: { $in: UNBACKED_EXTRA_SLUGS } })
    .select('slug researchAreas')
    .lean();
  const entities = [...byId, ...bySlug];

  const plans: UnbackedResearchAreaClearResult[] = [];
  for (const entity of entities as any[]) {
    const activeCount = await Observation.countDocuments({
      entityType: 'researchEntity',
      field: 'researchAreas',
      superseded: { $ne: true },
      _id: { $nin: graftObservationIds },
      $or: [{ entityId: entity._id }, { entityKey: entity.slug }],
    });
    plans.push(
      planUnbackedResearchAreaClear({
        slug: entity.slug,
        currentResearchAreas: entity.researchAreas,
        activeResearchAreaObservationCount: activeCount,
      }),
    );
  }
  return plans;
}

async function applyStrandedClears(plans: UnbackedResearchAreaClearResult[]): Promise<number> {
  let cleared = 0;
  for (const plan of plans) {
    if (!plan.shouldClear) continue;
    const result = await ResearchEntity.updateOne({ slug: plan.slug }, { $unset: { researchAreas: '' } });
    cleared += result.modifiedCount || 0;
  }
  return cleared;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const graftedObservations = await loadGraftedObservations();
  const strandedClearPlans = await loadStrandedResearchAreaClearPlans();
  const plannedClears = strandedClearPlans.filter((plan) => plan.shouldClear).length;
  const plannedTotal = graftedObservations.length + plannedClears;

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-fix-1580 is required when --apply is set.');
    }
    if (plannedTotal > args.maxApply) {
      throw new Error(`Apply would touch ${plannedTotal} records, above --max-apply=${args.maxApply}.`);
    }
  }

  const supersededObservations = args.apply ? await applyGraftRollback(graftedObservations) : 0;
  const clearedEntities = args.apply ? await applyStrandedClears(strandedClearPlans) : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    plannedGraftRollbacks: graftedObservations.length,
    supersededObservations,
    plannedUnbackedClears: plannedClears,
    clearedEntities,
    graftedObservations,
    strandedClearPlans,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, graftedObservations: graftedObservations.slice(0, 50) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
