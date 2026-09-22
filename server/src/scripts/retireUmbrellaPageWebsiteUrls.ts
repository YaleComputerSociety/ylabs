import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  isUmbrellaValuedWebsiteUrlObservation,
  planUmbrellaWebsiteUrlRepair,
  type UmbrellaWebsiteUrlRepairPlan,
} from './retireUmbrellaPageWebsiteUrlsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:retire-umbrella-page-website-urls';
const ROLLBACK_REASON =
  'umbrella page as a person website: a research group root or a department audience-recruitment page names a collective, so it is provenance for the person rather than the person research home (#2579)';

export interface RetireUmbrellaPageWebsiteUrlsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): RetireUmbrellaPageWebsiteUrlsArgs {
  const args: RetireUmbrellaPageWebsiteUrlsArgs = { apply: false, confirm: false, maxApply: 40 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retire-umbrella-page-website-urls') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

interface PlannedEntity {
  entityId: string;
  slug?: string;
  entityType?: string;
  studentVisibilityTier?: string;
  plan: UmbrellaWebsiteUrlRepairPlan;
}

export async function loadPlannedEntities(): Promise<PlannedEntity[]> {
  const entities = await ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug entityType kind studentVisibilityTier websiteUrl sourceUrls')
    .lean();

  const planned: PlannedEntity[] = [];
  for (const entity of entities as any[]) {
    const plan = planUmbrellaWebsiteUrlRepair(entity);
    if (!plan) continue;
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    planned.push({
      entityId,
      slug: entity.slug,
      entityType: entity.entityType,
      studentVisibilityTier: entity.studentVisibilityTier,
      plan,
    });
  }
  return planned.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

export async function loadPlannedObservationIds(
  slugs: string[],
  entityBySlug: Map<string, { entityType?: unknown; kind?: unknown }>,
): Promise<string[]> {
  if (slugs.length === 0) return [];
  const observations = await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: slugs },
    field: 'websiteUrl',
    superseded: { $ne: true },
  })
    .select('_id field value entityKey')
    .lean();

  return (observations as any[])
    .filter((observation) =>
      isUmbrellaValuedWebsiteUrlObservation(
        observation.field,
        observation.value,
        entityBySlug.get(observation.entityKey) || {},
      ),
    )
    .map((observation) => serializedDocumentId(observation._id))
    .filter((id): id is string => Boolean(id));
}

/**
 * Every row that cites one of the retired URLs anywhere, not just the rows being
 * cleared. Retiring a shared URL removes a duplicate collision, and the collision can
 * be the only thing holding another row out of student view, so the incumbent is
 * re-decided alongside the borrower (the #2385 cohort surfaced three such rows).
 */
export async function loadRegateEntityIds(
  plannedEntityIds: string[],
  retiredUrls: string[],
): Promise<string[]> {
  const ids = new Set(plannedEntityIds);
  if (retiredUrls.length > 0) {
    const citing = await ResearchEntity.find({
      archived: { $ne: true },
      $or: [{ websiteUrl: { $in: retiredUrls } }, { sourceUrls: { $in: retiredUrls } }],
    })
      .select('_id')
      .lean();
    for (const entity of citing as any[]) {
      const id = serializedDocumentId(entity._id);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

async function applyRepair(
  planned: PlannedEntity[],
  observationIds: string[],
  regateEntityIds: string[],
): Promise<{ entitiesRepaired: number; observationsSuperseded: number; regatedEntities: number }> {
  let entitiesRepaired = 0;
  for (const entry of planned) {
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(entry.entityId) },
      { $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } },
    );
    if (result.modifiedCount > 0) entitiesRepaired += 1;
  }

  let observationsSuperseded = 0;
  if (observationIds.length > 0) {
    const ids = observationIds.map((id) => new mongoose.Types.ObjectId(id));
    const result = await Observation.updateMany(
      { _id: { $in: ids }, superseded: { $ne: true } },
      {
        $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON } },
      },
    );
    observationsSuperseded = result.modifiedCount || 0;
  }

  let regatedEntities = 0;
  if (regateEntityIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: regateEntityIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    regatedEntities = regateEntityIds.length;
  }

  return { entitiesRepaired, observationsSuperseded, regatedEntities };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const planned = await loadPlannedEntities();
  const slugs = planned.map((entry) => entry.slug).filter((slug): slug is string => Boolean(slug));
  const observationIds = await loadPlannedObservationIds(
    slugs,
    new Map(
      planned
        .filter((entry) => Boolean(entry.slug))
        .map((entry) => [String(entry.slug), { entityType: entry.entityType }]),
    ),
  );
  const retiredUrls = [...new Set(planned.map((entry) => entry.plan.retiredWebsiteUrl))];
  const regateEntityIds = await loadRegateEntityIds(
    planned.map((entry) => entry.entityId),
    retiredUrls,
  );

  if (args.apply) {
    if (!args.confirm) {
      throw new Error(
        '--confirm-retire-umbrella-page-website-urls is required when --apply is set.',
      );
    }
    if (planned.length > args.maxApply) {
      throw new Error(
        `Apply would clear ${planned.length} website slots, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply
    ? await applyRepair(planned, observationIds, regateEntityIds)
    : { entitiesRepaired: 0, observationsSuperseded: 0, regatedEntities: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    plannedEntities: planned.length,
    plannedServedEntities: planned.filter(
      (entry) => entry.studentVisibilityTier === 'student_ready',
    ).length,
    citationRetained: planned.filter((entry) => entry.plan.citationRetained).length,
    retiredUrls: retiredUrls.length,
    plannedObservations: observationIds.length,
    regateCandidates: regateEntityIds.length,
    entitiesRepaired: applied.entitiesRepaired,
    observationsSuperseded: applied.observationsSuperseded,
    regatedEntities: applied.regatedEntities,
    byEntityType: planned.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.entityType || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    byVisibilityTier: planned.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.studentVisibilityTier || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    entities: planned,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, entities: planned.slice(0, 25) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
