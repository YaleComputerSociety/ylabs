import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  isAdvancementValuedObservation,
  leavesEntityWithNoCitation,
  planAdvancementWebsiteRepair,
  type AdvancementRepairPlan,
} from './retireAdvancementPageWebsiteUrlsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:retire-advancement-page-websites';
const ROLLBACK_REASON =
  'institutional advancement page is not a research home: a fundraising or giving page names its donor, not the entity (#2460)';

export interface RetireAdvancementPageWebsiteUrlsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): RetireAdvancementPageWebsiteUrlsArgs {
  const args: RetireAdvancementPageWebsiteUrlsArgs = {
    apply: false,
    confirm: false,
    maxApply: 600,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retire-advancement-websites') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
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
  name?: string;
  entityType?: string;
  studentVisibilityTier?: string;
  plan: AdvancementRepairPlan;
  leavesNoCitation: boolean;
}

export async function loadPlannedEntities(): Promise<PlannedEntity[]> {
  const entities = await ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug name entityType studentVisibilityTier websiteUrl sourceUrls')
    .lean();

  const planned: PlannedEntity[] = [];
  for (const entity of entities as any[]) {
    const plan = planAdvancementWebsiteRepair(entity);
    if (!plan) continue;
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    planned.push({
      entityId,
      slug: entity.slug,
      name: entity.name,
      entityType: entity.entityType,
      studentVisibilityTier: entity.studentVisibilityTier,
      plan,
      leavesNoCitation: leavesEntityWithNoCitation(plan),
    });
  }
  return planned.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

export async function loadPlannedObservationIds(slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const observations = await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: slugs },
    field: { $in: ['websiteUrl', 'sourceUrls'] },
    superseded: { $ne: true },
  })
    .select('_id field value')
    .lean();

  return (observations as any[])
    .filter((obs) => isAdvancementValuedObservation(obs.field, obs.value))
    .map((obs) => serializedDocumentId(obs._id))
    .filter((id): id is string => Boolean(id));
}

async function applyRepair(
  planned: PlannedEntity[],
  observationIds: string[],
): Promise<{ entitiesRepaired: number; observationsSuperseded: number }> {
  let entitiesRepaired = 0;
  for (const entry of planned) {
    const unset: Record<string, ''> = {};
    const set: Record<string, unknown> = { sourceUrls: entry.plan.nextSourceUrls };
    if (entry.plan.clearWebsiteUrl) {
      unset.websiteUrl = '';
      unset['fieldProvenance.websiteUrl'] = '';
    }
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(entry.entityId) },
      { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
    );
    if (result.modifiedCount > 0) entitiesRepaired += 1;
  }

  let observationsSuperseded = 0;
  if (observationIds.length > 0) {
    const ids = observationIds.map((id) => new mongoose.Types.ObjectId(id));
    const result = await Observation.updateMany(
      { _id: { $in: ids }, superseded: { $ne: true } },
      {
        $set: {
          superseded: true,
          rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON },
        },
      },
    );
    observationsSuperseded = result.modifiedCount || 0;
  }

  return { entitiesRepaired, observationsSuperseded };
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
  const observationIds = await loadPlannedObservationIds(
    planned.map((entry) => entry.slug).filter((slug): slug is string => Boolean(slug)),
  );

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-retire-advancement-websites is required when --apply is set.');
    }
    if (planned.length > args.maxApply) {
      throw new Error(
        `Apply would repair ${planned.length} entities, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply
    ? await applyRepair(planned, observationIds)
    : { entitiesRepaired: 0, observationsSuperseded: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    plannedEntities: planned.length,
    plannedWebsiteUrlClears: planned.filter((entry) => entry.plan.clearWebsiteUrl).length,
    plannedSourceUrlRemovals: planned.reduce(
      (sum, entry) => sum + entry.plan.removedSourceUrls.length,
      0,
    ),
    entitiesLeftWithNoCitation: planned.filter((entry) => entry.leavesNoCitation).length,
    plannedObservations: observationIds.length,
    entitiesRepaired: applied.entitiesRepaired,
    observationsSuperseded: applied.observationsSuperseded,
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
