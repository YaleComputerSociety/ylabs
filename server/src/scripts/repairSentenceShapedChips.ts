/**
 * Repair chips a source punctuated as prose (#2553).
 *
 * Two arms, each keyed on the stored value rather than on a plan, so a re-run over
 * already-repaired rows plans nothing: a document arm over `research_entities`,
 * and an observation arm, because the document field alone is reverted by the next
 * materialization while the observation still asserts the prose. No row is frozen
 * with a manual field lock; the observation rewrite is what makes the repair
 * durable, and the ingest-side guards keep the next scrape clean.
 *
 *   yarn --cwd server tsx src/scripts/repairSentenceShapedChips.ts
 *   yarn --cwd server tsx src/scripts/repairSentenceShapedChips.ts --apply \
 *     --confirm-sentence-shaped-chip-repair
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { buildObservationFingerprint, retireObservations } from '../scrapers/observationStore';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  CHIP_REPAIR_FIELDS,
  accumulateChipRepairCounts,
  emptyChipRepairCounts,
  planChipList,
  type ChipRepairCounts,
  type ChipRepairField,
} from './repairSentenceShapedChipsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:repair-sentence-shaped-chips';
const NOT_ARCHIVED = { $or: [{ archived: { $exists: false } }, { archived: false }] };
const RETIRE_REASON = 'sentence-shaped-chip-repair-2553';

export interface SentenceShapedChipCliOptions {
  dryRun: boolean;
  confirm: boolean;
  output?: string;
}

export function parseSentenceShapedChipArgs(argv: string[]): SentenceShapedChipCliOptions {
  const options: SentenceShapedChipCliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-sentence-shaped-chip-repair') options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

export interface SentenceShapedChipResult {
  mode: 'dry-run' | 'apply';
  documentsScanned: number;
  observationsScanned: number;
  documents: Record<ChipRepairField, ChipRepairCounts>;
  observations: Record<ChipRepairField, ChipRepairCounts>;
  documentsPlanned: number;
  documentsWritten: number;
  observationsRewritten: number;
  observationsRetired: number;
  entitiesSynced: number;
  examples: Array<{
    layer: 'document' | 'observation';
    field: ChipRepairField;
    refused: string[];
    trimmed: Array<{ before: string; after: string }>;
  }>;
}

const emptyFieldCounts = (): Record<ChipRepairField, ChipRepairCounts> =>
  Object.fromEntries(CHIP_REPAIR_FIELDS.map((field) => [field, emptyChipRepairCounts()])) as Record<
    ChipRepairField,
    ChipRepairCounts
  >;

const MAX_REPORTED_EXAMPLES = 40;

export async function runSentenceShapedChipRepair(options: {
  dryRun: boolean;
}): Promise<SentenceShapedChipResult> {
  const result: SentenceShapedChipResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    documentsScanned: 0,
    observationsScanned: 0,
    documents: emptyFieldCounts(),
    observations: emptyFieldCounts(),
    documentsPlanned: 0,
    documentsWritten: 0,
    observationsRewritten: 0,
    observationsRetired: 0,
    entitiesSynced: 0,
    examples: [],
  };

  const recordExample = (
    layer: 'document' | 'observation',
    field: ChipRepairField,
    refused: string[],
    trimmed: Array<{ before: string; after: string }>,
  ) => {
    if (result.examples.length >= MAX_REPORTED_EXAMPLES) return;
    result.examples.push({ layer, field, refused, trimmed });
  };

  const entities = (await ResearchEntity.find(NOT_ARCHIVED)
    .select(['_id', 'slug', ...CHIP_REPAIR_FIELDS].join(' '))
    .lean()) as Array<Record<string, unknown>>;
  result.documentsScanned = entities.length;

  const documentWrites: Array<{ slug: string; set: Record<string, string[]>; unset: string[] }> =
    [];
  for (const entity of entities) {
    const set: Record<string, string[]> = {};
    const unset: string[] = [];
    let changed = false;
    for (const field of CHIP_REPAIR_FIELDS) {
      if (!Array.isArray(entity[field])) continue;
      const plan = planChipList(field, entity[field]);
      if (!plan.changed) continue;
      accumulateChipRepairCounts(result.documents[field], plan);
      recordExample('document', field, plan.refused, plan.trimmed);
      changed = true;
      if (plan.repaired.length === 0) unset.push(field);
      else set[field] = plan.repaired;
    }
    if (changed) documentWrites.push({ slug: String(entity.slug), set, unset });
  }
  result.documentsPlanned = documentWrites.length;

  const observations = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: CHIP_REPAIR_FIELDS as unknown as string[] },
    superseded: { $ne: true },
  })
    .select('_id sourceName entityType entityId entityKey field value')
    .lean()) as Array<Record<string, unknown>>;
  result.observationsScanned = observations.length;

  const observationRewrites: Array<{
    id: unknown;
    value: string[];
    fingerprint?: string;
  }> = [];
  const observationRetirements: unknown[] = [];
  for (const observation of observations) {
    const field = observation.field as ChipRepairField;
    if (!Array.isArray(observation.value)) continue;
    const plan = planChipList(field, observation.value);
    if (!plan.changed) continue;
    accumulateChipRepairCounts(result.observations[field], plan);
    recordExample('observation', field, plan.refused, plan.trimmed);
    if (plan.repaired.length === 0) {
      observationRetirements.push(observation._id);
      continue;
    }
    observationRewrites.push({
      id: observation._id,
      value: plan.repaired,
      // These fields fingerprint on their value, so a rewritten value with its old
      // fingerprint stops matching what the next run emits and supersession breaks.
      fingerprint: buildObservationFingerprint({
        sourceName: String(observation.sourceName ?? ''),
        entityType: String(observation.entityType ?? ''),
        entityId: observation.entityId,
        entityKey: typeof observation.entityKey === 'string' ? observation.entityKey : undefined,
        field,
        value: plan.repaired,
      }),
    });
  }

  if (options.dryRun) {
    result.observationsRewritten = observationRewrites.length;
    result.observationsRetired = observationRetirements.length;
    return result;
  }

  for (const rewrite of observationRewrites) {
    const written = await Observation.updateOne(
      { _id: rewrite.id },
      {
        $set: {
          value: rewrite.value,
          ...(rewrite.fingerprint ? { observationFingerprint: rewrite.fingerprint } : {}),
        },
      },
    );
    result.observationsRewritten += written.modifiedCount ?? 0;
  }
  if (observationRetirements.length > 0) {
    const retired = await retireObservations(
      { _id: { $in: observationRetirements } },
      RETIRE_REASON,
    );
    result.observationsRetired = retired.retired;
  }

  for (const write of documentWrites) {
    const update: Record<string, unknown> = {};
    if (Object.keys(write.set).length > 0) update.$set = write.set;
    if (write.unset.length > 0) {
      update.$unset = Object.fromEntries(write.unset.map((field) => [field, '']));
    }
    if (Object.keys(update).length === 0) continue;
    const written = await ResearchEntity.updateOne({ slug: write.slug }, update);
    result.documentsWritten += written.modifiedCount ?? 0;
  }

  if (documentWrites.length > 0) {
    const fresh = await ResearchEntity.find({
      slug: { $in: documentWrites.map((write) => write.slug) },
    }).lean();
    await syncEntities('researchEntity', fresh as never[]);
    result.entitiesSynced = fresh.length;
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseSentenceShapedChipArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error(`${SCRIPT_NAME} apply mode requires --confirm-sentence-shaped-chip-repair.`);
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
    const result = await runSentenceShapedChipRepair({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), environment: guard.environment, ...result }, null, 2)}\n`,
      );
      console.log(`Saved sentence-shaped chip repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ ...result, examples: undefined }, null, 2));
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
