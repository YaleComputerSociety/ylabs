import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { researchScopeEvidenceValueHash } from '../services/researchEntityResearchScope';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const narrativeFields = ['summary', 'description', 'shortDescription', 'fullDescription'] as const;

export interface NarrativeValueHashBackfillOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
}

export function parseNarrativeValueHashBackfillArgs(
  argv: string[],
): NarrativeValueHashBackfillOptions {
  const options = { apply: false, confirm: false, limit: 0 };
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--mode=apply') options.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.apply = false;
    else if (arg === '--confirm-narrative-value-hashes') options.confirm = true;
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice('--limit='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
    throw new Error('--limit must be a positive integer.');
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-narrative-value-hashes is required with --apply.');
  }
  return options;
}

export async function planNarrativeValueHashBackfill(limit: number): Promise<
  Array<{
    entityId: unknown;
    field: (typeof narrativeFields)[number];
    provenance: Record<string, unknown>;
  }>
> {
  const entities = await ResearchEntity.find({ archived: { $ne: true } })
    .select(`_id ${narrativeFields.join(' ')} fieldProvenance`)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  const plans = [];
  for (const entity of entities as any[]) {
    for (const field of narrativeFields) {
      const value = typeof entity[field] === 'string' ? entity[field].trim() : '';
      if (!value || entity.fieldProvenance?.[field]?.valueHash) continue;
      const observation = await Observation.findOne({
        entityType: { $in: ['researchEntity', 'researchGroup'] },
        entityId: entity._id,
        field,
        value: entity[field],
        superseded: { $ne: true },
        sourceUrl: { $regex: '^https?://', $options: 'i' },
      })
        .sort({ observedAt: -1 })
        .lean();
      if (!observation) continue;
      plans.push({
        entityId: entity._id,
        field,
        provenance: {
          sourceId: observation.sourceId,
          observationId: observation._id,
          sourceName: observation.sourceName,
          sourceUrl: observation.sourceUrl,
          valueHash: researchScopeEvidenceValueHash(entity[field]),
          observedAt: observation.observedAt,
          confidence: observation.confidence,
        },
      });
    }
  }
  return plans;
}

async function main(): Promise<void> {
  const options = parseNarrativeValueHashBackfillArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'narrative value hash backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const scannedRecordIds = (
    await ResearchEntity.find({ archived: { $ne: true } })
      .select('_id')
      .sort({ _id: 1 })
      .limit(options.limit)
      .lean()
  ).map((entity) => String(entity._id));
  const plans = await planNarrativeValueHashBackfill(options.limit);
  if (options.apply) {
    for (const plan of plans) {
      await ResearchEntity.updateOne(
        { _id: plan.entityId },
        { $set: { [`fieldProvenance.${plan.field}`]: plan.provenance } },
      );
    }
    if (scannedRecordIds.length > 0) {
      const visibilityPlans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: scannedRecordIds,
      });
      await applyStudentVisibilityGatePlans(visibilityPlans);
    }
  }
  console.log(
    JSON.stringify(
      {
        environment: guard.environment,
        db: guard.dbLabel,
        mode: options.apply ? 'apply' : 'dry-run',
        scanned: scannedRecordIds.length,
        matched: plans.length,
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill narrative value hashes:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
