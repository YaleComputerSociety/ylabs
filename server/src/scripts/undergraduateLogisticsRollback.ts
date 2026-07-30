import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { UndergraduateLogisticsClaim } from '../models/undergraduateLogisticsClaim';
import {
  materializeUndergraduateLogisticsForResearchEntity,
  UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET,
} from '../scrapers/undergraduateLogisticsMaterializer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface RollbackObservationLike {
  _id?: unknown;
  entityId?: unknown;
  entityKey?: unknown;
  observationFingerprint?: unknown;
  superseded?: unknown;
}

export interface UndergraduateLogisticsRollbackPlan {
  observationIds: string[];
  activeObservationIds: string[];
  entityIds: string[];
  entityKeys: string[];
  observationFingerprints: string[];
}

export function undergraduateLogisticsRollbackObservationFilter(runId: string) {
  return {
    scrapeRunId: runId,
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    field: { $in: Array.from(UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET) },
  };
}

export function buildUndergraduateLogisticsRollbackPlan(
  observations: RollbackObservationLike[],
): UndergraduateLogisticsRollbackPlan {
  const observationIds = new Set<string>();
  const activeObservationIds = new Set<string>();
  const entityIds = new Set<string>();
  const entityKeys = new Set<string>();
  const observationFingerprints = new Set<string>();
  for (const observation of observations) {
    const observationId = String(observation._id || '');
    if (/^[a-f0-9]{24}$/i.test(observationId)) {
      observationIds.add(observationId);
      if (observation.superseded === false) activeObservationIds.add(observationId);
    }
    if (observation.superseded !== false) continue;
    const entityId = String(observation.entityId || '');
    if (/^[a-f0-9]{24}$/i.test(entityId)) entityIds.add(entityId);
    const entityKey = typeof observation.entityKey === 'string' ? observation.entityKey.trim() : '';
    if (entityKey) entityKeys.add(entityKey);
    const fingerprint =
      typeof observation.observationFingerprint === 'string'
        ? observation.observationFingerprint.trim()
        : '';
    if (fingerprint) observationFingerprints.add(fingerprint);
  }
  return {
    observationIds: Array.from(observationIds).sort(),
    activeObservationIds: Array.from(activeObservationIds).sort(),
    entityIds: Array.from(entityIds).sort(),
    entityKeys: Array.from(entityKeys).sort(),
    observationFingerprints: Array.from(observationFingerprints).sort(),
  };
}

interface PredecessorObservationLike {
  _id?: unknown;
  observationFingerprint?: unknown;
}

export function selectUndergraduateLogisticsRollbackPredecessors(
  observations: PredecessorObservationLike[],
): string[] {
  const selectedFingerprints = new Set<string>();
  const observationIds: string[] = [];
  for (const observation of observations) {
    const fingerprint =
      typeof observation.observationFingerprint === 'string'
        ? observation.observationFingerprint
        : '';
    const observationId = String(observation._id || '');
    if (!fingerprint || selectedFingerprints.has(fingerprint)) continue;
    if (!/^[a-f0-9]{24}$/i.test(observationId)) continue;
    selectedFingerprints.add(fingerprint);
    observationIds.push(observationId);
  }
  return observationIds;
}

interface Args {
  runId: string;
  apply: boolean;
  confirmed: boolean;
  reason: string;
  output?: string;
}

export function parseUndergraduateLogisticsRollbackArgs(argv: string[]): Args {
  const args: Args = {
    runId: '',
    apply: false,
    confirmed: false,
    reason: 'Rollback of source-backed undergraduate logistics acquisition run.',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--run=')) {
      args.runId = arg.slice('--run='.length);
      continue;
    }
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-undergraduate-logistics-rollback') {
      args.confirmed = true;
      continue;
    }
    if (arg.startsWith('--reason=')) {
      args.reason = arg.slice('--reason='.length).trim().slice(0, 500);
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown undergraduate logistics rollback argument: ${arg}`);
  }
  if (!mongoose.isValidObjectId(args.runId)) throw new Error('--run requires a ScrapeRun ObjectId');
  if (args.apply && !args.confirmed) {
    throw new Error('Apply requires --confirm-undergraduate-logistics-rollback');
  }
  if (!args.reason) throw new Error('--reason cannot be empty');
  return args;
}

async function run(): Promise<void> {
  const args = parseUndergraduateLogisticsRollbackArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'undergraduate-logistics-rollback',
    mongoUrl: process.env.MONGODBURL,
  });
  const observations = await Observation.find(
    undergraduateLogisticsRollbackObservationFilter(args.runId),
  )
    .select('_id entityId entityKey observationFingerprint superseded')
    .lean();
  const plan = buildUndergraduateLogisticsRollbackPlan(observations);
  const keyedEntities = plan.entityKeys.length
    ? await ResearchEntity.find({ slug: { $in: plan.entityKeys }, archived: { $ne: true } })
        .select('_id slug')
        .lean()
    : [];
  const entityIds = Array.from(
    new Set([...plan.entityIds, ...keyedEntities.map((entity) => String(entity._id))]),
  );
  const affectedClaims = await UndergraduateLogisticsClaim.countDocuments({
    sourceScrapeRunIds: args.runId,
    archived: { $ne: true },
  });
  const result: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    scrapeRunId: args.runId,
    plan: {
      observations: plan.observationIds.length,
      activeObservations: plan.activeObservationIds.length,
      affectedEntities: entityIds.length,
      affectedClaims,
    },
  };

  if (args.apply && plan.observationIds.length > 0) {
    const rolledBackAt = new Date();
    const observationUpdate = await Observation.updateMany(
      { _id: { $in: plan.observationIds } },
      {
        $set: {
          superseded: true,
          rollback: { rolledBackAt, reason: args.reason },
        },
      },
    );
    const predecessorCandidates = plan.observationFingerprints.length
      ? await Observation.find({
          observationFingerprint: { $in: plan.observationFingerprints },
          scrapeRunId: { $ne: args.runId },
          'rollback.rolledBackAt': { $exists: false },
        })
          .sort({ observedAt: -1, _id: -1 })
          .select('_id observationFingerprint')
          .lean()
      : [];
    const predecessorIds = selectUndergraduateLogisticsRollbackPredecessors(predecessorCandidates);
    if (predecessorIds.length > 0) {
      await Observation.updateMany(
        { _id: { $in: predecessorIds } },
        { $set: { superseded: false }, $unset: { supersededBy: '' } },
      );
    }
    const materialized = [];
    for (const entityId of entityIds) {
      const entity: any = await ResearchEntity.findById(entityId).select('slug').lean();
      if (!entity) continue;
      materialized.push(
        await materializeUndergraduateLogisticsForResearchEntity({
          researchEntityId: entityId,
          entityKey: String(entity.slug || ''),
          now: rolledBackAt,
        }),
      );
    }
    result.applied = {
      observationsSuperseded: observationUpdate.modifiedCount,
      predecessorsRestored: predecessorIds.length,
      entitiesRematerialized: materialized.length,
      claimsKnown: materialized.reduce((sum, row) => sum + row.known, 0),
      claimsArchived: materialized.reduce((sum, row) => sum + row.archived, 0),
      conflictsWithheld: materialized.reduce((sum, row) => sum + row.conflicts, 0),
    };
  }

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
