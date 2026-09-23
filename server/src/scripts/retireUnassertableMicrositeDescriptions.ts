/**
 * Retires the stored description observations of `lab-microsite-undergrad-llm`
 * that the lane would no longer assert, and stops the rows carrying the text
 * they produced (#2570).
 *
 * The lane had no crawl-seed-versus-citation rule, so a paginated faculty index
 * and other people's profile pages became per-person description sources. The
 * ingest guards close the producer; this clears the reservoir those runs left
 * behind, which the next sweep would otherwise keep re-resolving.
 *
 * Non-production defaults to dry-run. Apply requires
 * --confirm-retire-unassertable-descriptions.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  UNASSERTABLE_DESCRIPTION_FIELDS,
  SOURCE_DISQUALIFYING_REASONS,
  normalizeRetiredSourceUrl,
  planStoredDescriptionClears,
  unassertableDescriptionReasons,
  type StoredDescriptionClear,
  type UnassertableDescriptionReason,
} from './retireUnassertableMicrositeDescriptionsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:retire-unassertable-microsite-descriptions';
// Both microsite description lanes, because every reason below is a probe of the
// observation rather than of the lane that wrote it, and the sibling lane cites the
// same pages. Scoping to one of the two left half of the disqualified citations
// standing (#1750).
const SOURCE_NAMES = ['lab-microsite-undergrad-llm', 'lab-microsite-description-llm'] as const;
const ROLLBACK_REASON =
  'unassertable microsite description: a paginated or multi-person index, or a person page belonging to somebody else, is a crawl seed and never a citation (#2570)';

const ENTITY_IDENTITY_FIELDS =
  'slug name displayName school schools departments sourceUrls fullDescription shortDescription fieldProvenance studentVisibilityTier entityType recentGrants';

export interface RetireUnassertableDescriptionsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): RetireUnassertableDescriptionsArgs {
  const args: RetireUnassertableDescriptionsArgs = {
    apply: false,
    confirm: false,
    maxApply: 200,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retire-unassertable-descriptions') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
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

interface PlannedRetirement {
  entityKey: string;
  entityId?: string;
  studentVisibilityTier?: string;
  entityType?: string;
  observationIds: string[];
  fields: string[];
  reasons: UnassertableDescriptionReason[];
  disqualifiedSourceUrlCount: number;
  storedClears: StoredDescriptionClear[];
}

export async function loadPlannedRetirements(): Promise<PlannedRetirement[]> {
  const observations = await Observation.find({
    entityType: 'researchEntity',
    sourceName: { $in: [...SOURCE_NAMES] },
    field: { $in: [...UNASSERTABLE_DESCRIPTION_FIELDS] },
    superseded: { $ne: true },
  })
    .select('_id entityKey field value sourceUrl')
    .lean();

  const byKey = new Map<string, Array<Record<string, any>>>();
  for (const observation of observations as any[]) {
    const key = String(observation.entityKey || '');
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(observation);
  }

  const planned: PlannedRetirement[] = [];
  for (const [entityKey, rows] of byKey) {
    const entity = await ResearchEntity.findOne({ slug: entityKey })
      .select(ENTITY_IDENTITY_FIELDS)
      .lean();
    if (!entity) continue;

    const observationIds: string[] = [];
    const fields = new Set<string>();
    const reasons = new Set<UnassertableDescriptionReason>();
    const disqualifiedSourceUrls = new Set<string>();
    for (const observation of rows) {
      const rowReasons = unassertableDescriptionReasons(observation as never, entity as never);
      if (rowReasons.length === 0) continue;
      const observationId = serializedDocumentId(observation._id);
      if (!observationId) continue;
      observationIds.push(observationId);
      fields.add(String(observation.field));
      rowReasons.forEach((reason) => reasons.add(reason));
      if (rowReasons.some((reason) => SOURCE_DISQUALIFYING_REASONS.includes(reason))) {
        disqualifiedSourceUrls.add(normalizeRetiredSourceUrl(observation.sourceUrl));
      }
    }
    if (observationIds.length === 0) continue;

    planned.push({
      entityKey,
      entityId: serializedDocumentId((entity as any)._id) || undefined,
      studentVisibilityTier: (entity as any).studentVisibilityTier,
      entityType: (entity as any).entityType,
      observationIds,
      fields: [...fields].sort(),
      reasons: [...reasons].sort(),
      disqualifiedSourceUrlCount: disqualifiedSourceUrls.size,
      storedClears: planStoredDescriptionClears(entity as never, disqualifiedSourceUrls),
    });
  }
  return planned.sort((a, b) => a.entityKey.localeCompare(b.entityKey));
}

async function applyRetirements(planned: PlannedRetirement[]): Promise<{
  observationsSuperseded: number;
  entitiesCleared: number;
  regatedEntities: number;
}> {
  const observationIds = planned.flatMap((entry) => entry.observationIds);
  let observationsSuperseded = 0;
  if (observationIds.length > 0) {
    const result = await Observation.updateMany(
      {
        _id: { $in: observationIds.map((id) => new mongoose.Types.ObjectId(id)) },
        superseded: { $ne: true },
      },
      {
        $set: {
          superseded: true,
          rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON },
        },
      },
    );
    observationsSuperseded = result.modifiedCount || 0;
  }

  let entitiesCleared = 0;
  for (const entry of planned) {
    if (entry.storedClears.length === 0 || !entry.entityId) continue;
    const unset: Record<string, ''> = {};
    for (const clear of entry.storedClears) {
      unset[clear.field] = '';
      unset[`fieldProvenance.${clear.field}`] = '';
    }
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(entry.entityId) },
      { $unset: unset },
    );
    if (result.modifiedCount > 0) entitiesCleared += 1;
  }

  // Losing a description changes what the gate had to work with, so every row that
  // lost one is re-decided rather than left on a decision made about prose it no
  // longer carries.
  const regateIds = planned
    .filter((entry) => entry.storedClears.length > 0 && entry.entityId)
    .map((entry) => entry.entityId as string);
  let regatedEntities = 0;
  if (regateIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: regateIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    regatedEntities = regateIds.length;
  }

  return { observationsSuperseded, entitiesCleared, regatedEntities };
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const planned = await loadPlannedRetirements();
  const plannedObservations = planned.reduce((sum, entry) => sum + entry.observationIds.length, 0);

  if (args.apply) {
    if (!args.confirm) {
      throw new Error(
        '--confirm-retire-unassertable-descriptions is required when --apply is set.',
      );
    }
    if (plannedObservations > args.maxApply) {
      throw new Error(
        `Apply would retire ${plannedObservations} observations, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply
    ? await applyRetirements(planned)
    : { observationsSuperseded: 0, entitiesCleared: 0, regatedEntities: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    sourceNames: [...SOURCE_NAMES],
    plannedEntities: planned.length,
    plannedObservations,
    // Every arm is counted on its own in dry-run: a union total hides an arm that
    // silently matches nothing.
    byReason: countBy(planned.flatMap((entry) => entry.reasons)),
    plannedStoredClears: planned.reduce((sum, entry) => sum + entry.storedClears.length, 0),
    byStoredClearReason: countBy(
      planned.flatMap((entry) => entry.storedClears.map((clear) => clear.reason)),
    ),
    byVisibilityTier: countBy(planned.map((entry) => entry.studentVisibilityTier || 'UNKNOWN')),
    observationsSuperseded: applied.observationsSuperseded,
    entitiesCleared: applied.entitiesCleared,
    regatedEntities: applied.regatedEntities,
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
