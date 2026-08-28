import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import {
  resolveField,
  type ResolverObservation,
} from '../scrapers/confidenceResolver';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME = 'official-profile-pi-backfill';
export const PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAME = 'lab-microsite-description-llm';
const DESCRIPTION_FIELDS = ['description', 'fullDescription', 'shortDescription'];

export interface RepairProfileDescriptionBackfillConflictsArgs {
  apply: boolean;
  confirmProfileDescriptionConflictRepair: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
}

export interface ProfileDescriptionConflictObservation {
  id: string;
  sourceName: string;
  value: unknown;
  observedAt?: Date | string;
  confidence?: number;
}

export interface ProfileDescriptionConflictGroup {
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  observations: ProfileDescriptionConflictObservation[];
}

export interface ProfileDescriptionConflictRepairPlan {
  planId: string;
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  preferredSourceName: string;
  supersededSourceName: string;
  keepObservationId: string;
  supersedeObservationIds: string[];
}

const PROFILE_DESCRIPTION_CONFLICT_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeProfileDescriptionConflictObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return PROFILE_DESCRIPTION_CONFLICT_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function consumePath(value: string | undefined, flag: string): string {
  return resolveSafeJsonReportOutputPath(value, flag);
}

export function parseRepairProfileDescriptionBackfillConflictsArgs(
  argv: string[],
): RepairProfileDescriptionBackfillConflictsArgs {
  const args: RepairProfileDescriptionBackfillConflictsArgs = {
    apply: false,
    confirmProfileDescriptionConflictRepair: false,
    limit: 500,
    limitProvided: false,
    maxApply: 50,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-profile-description-conflict-repair') {
      args.confirmProfileDescriptionConflictRepair = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      args.limitProvided = true;
      continue;
    }
    if (arg === '--limit') {
      args.limit = parsePositiveInteger(argv[index + 1], '--limit');
      args.limitProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
      continue;
    }
    if (arg === '--max-apply') {
      args.maxApply = parsePositiveInteger(argv[index + 1], '--max-apply');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = consumePath(arg.slice('--output='.length), '--output');
      continue;
    }
    if (arg === '--output') {
      args.output = consumePath(argv[index + 1], '--output');
      index += 1;
      continue;
    }
    throw new Error(`Unknown profile description conflict repair argument: ${arg}`);
  }

  return args;
}

export function assertRepairProfileDescriptionBackfillConflictsApplyAllowed(
  args: RepairProfileDescriptionBackfillConflictsArgs,
  plannedSupersedeObservations: number,
): void {
  if (!args.apply) return;
  if (!args.confirmProfileDescriptionConflictRepair) {
    throw new Error(
      '--confirm-profile-description-conflict-repair is required when --apply is set.',
    );
  }
  if (!args.limitProvided) {
    throw new Error('--limit is required when --apply is set.');
  }
  if (plannedSupersedeObservations > args.maxApply) {
    throw new Error(`Apply would supersede ${plannedSupersedeObservations} rows, above --max-apply.`);
  }
}

function idValue(value: unknown): string {
  return serializedDocumentId(value) || '';
}

function toResolverObservation(
  observation: ProfileDescriptionConflictObservation,
  field: string,
): ResolverObservation {
  return {
    field,
    value: observation.value,
    sourceName: observation.sourceName,
    confidence: typeof observation.confidence === 'number' ? observation.confidence : 0.5,
    observedAt: observation.observedAt ? new Date(observation.observedAt) : new Date(0),
  };
}

function chooseKeepObservation(
  observations: ProfileDescriptionConflictObservation[],
): ProfileDescriptionConflictObservation | undefined {
  return [...observations].sort((left, right) => {
    const byConfidence = (Number(right.confidence) || 0) - (Number(left.confidence) || 0);
    if (byConfidence !== 0) return byConfidence;
    const byObserved =
      new Date(right.observedAt || 0).getTime() - new Date(left.observedAt || 0).getTime();
    if (byObserved !== 0) return byObserved;
    return left.id.localeCompare(right.id);
  })[0];
}

export function buildProfileDescriptionConflictRepairPlan(
  group: ProfileDescriptionConflictGroup,
): ProfileDescriptionConflictRepairPlan | null {
  if (group.entityType !== 'researchEntity' || !DESCRIPTION_FIELDS.includes(group.field)) {
    return null;
  }

  const preferredObservations = group.observations.filter(
    (observation) => observation.sourceName === PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAME,
  );
  const profileObservations = group.observations.filter(
    (observation) => observation.sourceName === PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
  );
  if (preferredObservations.length === 0 || profileObservations.length === 0) return null;

  const resolved = resolveField(
    group.field,
    group.observations.map((observation) => toResolverObservation(observation, group.field)),
  );
  if (!resolved?.contributingSources.includes(PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAME)) {
    return null;
  }

  const keepObservation = chooseKeepObservation(preferredObservations);
  if (!keepObservation) return null;
  const supersedeObservationIds = profileObservations.map((observation) => observation.id);
  if (supersedeObservationIds.length === 0) return null;

  return {
    planId: [
      group.entityType,
      group.entityKey || group.entityId || 'unknown-entity',
      group.field,
    ].join(':'),
    entityType: group.entityType,
    entityId: group.entityId,
    entityKey: group.entityKey,
    field: group.field,
    preferredSourceName: PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAME,
    supersededSourceName: PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
    keepObservationId: keepObservation.id,
    supersedeObservationIds,
  };
}

export function buildProfileDescriptionConflictRepairPlans(
  groups: ProfileDescriptionConflictGroup[],
): ProfileDescriptionConflictRepairPlan[] {
  return groups
    .map(buildProfileDescriptionConflictRepairPlan)
    .filter((plan): plan is ProfileDescriptionConflictRepairPlan => Boolean(plan));
}

async function loadConflictGroups(limit: number): Promise<ProfileDescriptionConflictGroup[]> {
  const profileRows = await Observation.find({
    entityType: 'researchEntity',
    sourceName: PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
    field: { $in: DESCRIPTION_FIELDS },
    superseded: { $ne: true },
  })
    .select('entityType entityId entityKey field')
    .sort({ observedAt: -1, _id: 1 })
    .limit(Math.max(limit * 5, limit))
    .lean();

  const seen = new Set<string>();
  const groups: ProfileDescriptionConflictGroup[] = [];
  for (const row of profileRows as Array<Record<string, any>>) {
    const entityId = idValue(row.entityId);
    const entityKey = String(row.entityKey || '');
    const field = String(row.field || '');
    const key = [row.entityType, entityId || entityKey, field].join(':');
    if (seen.has(key)) continue;
    seen.add(key);

    const match: Record<string, unknown> = {
      entityType: row.entityType,
      field,
      superseded: { $ne: true },
    };
    if (row.entityId) match.entityId = row.entityId;
    else if (entityKey) match.entityKey = entityKey;
    else continue;

    const observations = await Observation.find(match)
      .select('sourceName value observedAt confidence')
      .lean();
    groups.push({
      entityType: String(row.entityType || ''),
      ...(entityId ? { entityId } : {}),
      ...(entityKey ? { entityKey } : {}),
      field,
      observations: (observations as Array<Record<string, any>>).map((observation) => ({
        id: idValue(observation._id),
        sourceName: String(observation.sourceName || ''),
        value: observation.value,
        observedAt: observation.observedAt,
        confidence: typeof observation.confidence === 'number' ? observation.confidence : undefined,
      })),
    });
    if (groups.length >= limit) break;
  }

  return groups;
}

async function applyPlans(plans: ProfileDescriptionConflictRepairPlan[]) {
  const applied = [];
  for (const plan of plans) {
    const keepObservationId = normalizeProfileDescriptionConflictObjectId(plan.keepObservationId);
    const supersedeObservationIds = plan.supersedeObservationIds
      .map((id) => normalizeProfileDescriptionConflictObjectId(id))
      .filter((id): id is string => Boolean(id));
    if (!keepObservationId || supersedeObservationIds.length === 0) continue;
    const supersedeIds = supersedeObservationIds.map((id) => new mongoose.Types.ObjectId(id));
    const keepId = new mongoose.Types.ObjectId(keepObservationId);
    const result = await Observation.updateMany(
      {
        _id: { $in: supersedeIds },
        sourceName: PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
        superseded: { $ne: true },
      },
      {
        $set: {
          superseded: true,
          supersededBy: keepId,
        },
      },
    );
    applied.push({
      ...plan,
      supersededObservations: result.modifiedCount || 0,
    });
  }
  return applied;
}

export function writeProfileDescriptionConflictRepairOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseRepairProfileDescriptionBackfillConflictsArgs(process.argv.slice(2));
  assertRepairProfileDescriptionBackfillConflictsApplyAllowed(args, 0);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'observations:repair-profile-description-conflicts',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const groups = await loadConflictGroups(args.limit);
  const plans = buildProfileDescriptionConflictRepairPlans(groups);
  const plannedSupersedeObservations = plans.reduce(
    (sum, plan) => sum + plan.supersedeObservationIds.length,
    0,
  );
  assertRepairProfileDescriptionBackfillConflictsApplyAllowed(
    args,
    plannedSupersedeObservations,
  );
  const applied = args.apply ? await applyPlans(plans) : [];

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
    mode: args.apply ? 'apply' : 'dry-run',
    groupsScanned: groups.length,
    plannedGroups: plans.length,
    plannedSupersedeObservations,
    plans: plans.slice(0, 50),
    applied,
  };
  console.log(JSON.stringify(report, null, 2));
  writeProfileDescriptionConflictRepairOutput(report, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to repair profile description conflicts:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
