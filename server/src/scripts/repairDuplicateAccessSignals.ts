import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import {
  buildDuplicateAccessSignalGroupsFromRows,
  type DuplicateAccessSignalGroup,
} from '../scrapers/integrityGate';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface RepairDuplicateAccessSignalsCliOptions {
  apply: boolean;
  confirmDuplicateAccessSignalRepair: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
}

export interface DuplicateAccessSignalRecord {
  _id: unknown;
  researchEntityId?: unknown;
  entryPathwayId?: unknown;
  signalType?: string;
  sourceEvidenceId?: unknown;
  observationId?: unknown;
  derivationKey?: string | null;
  archived?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  review?: {
    status?: string;
    lockedFields?: string[];
  };
}

export interface DuplicateAccessSignalPathwayContext {
  entryPathwayId: string;
  derivationKey?: string | null;
  archived?: boolean;
  activeAccessSignals: number;
  activeContactRoutes: number;
  activePostedOpportunities: number;
  review?: {
    status?: string;
    lockedFields?: string[];
  };
}

export interface DuplicateAccessSignalRepairPlan {
  researchEntityId: string;
  signalType: string;
  canonicalSignalId: string;
  duplicateSignalIds: string[];
  archiveEntryPathwayIds: string[];
  identityFields: Array<{
    identityField: DuplicateAccessSignalGroup['identityField'];
    identityValue: string;
  }>;
  skippedEntryPathwayArchives: Array<{
    entryPathwayId: string;
    reason: string;
  }>;
}

export interface BlockedDuplicateAccessSignalRepairGroup {
  signalIds: string[];
  identityFields: DuplicateAccessSignalRepairPlan['identityFields'];
  reason: string;
}

export interface DuplicateAccessSignalRepairPlanResult {
  plans: DuplicateAccessSignalRepairPlan[];
  blocked: BlockedDuplicateAccessSignalRepairGroup[];
}

function parsePositiveInteger(value: string, optionName: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function valueForFlag(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (!value?.trim() || value.trim().startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return {
    value: value.trim(),
    nextIndex: inline !== undefined ? index : index + 1,
  };
}

export function parseRepairDuplicateAccessSignalsArgs(
  argv: string[],
): RepairDuplicateAccessSignalsCliOptions {
  const options: RepairDuplicateAccessSignalsCliOptions = {
    apply: false,
    confirmDuplicateAccessSignalRepair: false,
    limit: 1000,
    limitProvided: false,
    maxApply: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-duplicate-access-signal-repair') {
      options.confirmDuplicateAccessSignalRepair = true;
      continue;
    }
    if (arg.startsWith('--confirm-duplicate-access-signal-repair=')) {
      throw new Error('--confirm-duplicate-access-signal-repair does not accept a value');
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const parsed = valueForFlag(argv, index, '--limit');
      options.limit = parsePositiveInteger(parsed.value, '--limit');
      options.limitProvided = true;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--max-apply' || arg.startsWith('--max-apply=')) {
      const parsed = valueForFlag(argv, index, '--max-apply');
      options.maxApply = parsePositiveInteger(parsed.value, '--max-apply');
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--output' || arg.startsWith('--output=')) {
      const parsed = valueForFlag(argv, index, '--output');
      options.output = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    throw new Error(`Unknown access-signals:repair-duplicates argument: ${arg}`);
  }

  return options;
}

export function assertDuplicateAccessSignalRepairApplyAllowed(args: {
  apply: boolean;
  confirmDuplicateAccessSignalRepair?: boolean;
  limitProvided?: boolean;
  plannedWrites: number;
  maxApply: number;
}): void {
  if (!args.apply) return;
  if (!args.limitProvided) {
    throw new Error('--limit is required when --apply is set for access-signals:repair-duplicates');
  }
  if (!args.confirmDuplicateAccessSignalRepair) {
    throw new Error(
      '--confirm-duplicate-access-signal-repair is required when --apply is set for access-signals:repair-duplicates',
    );
  }
  if (args.plannedWrites > args.maxApply) {
    throw new Error(`Apply would modify ${args.plannedWrites} artifacts, above --max-apply.`);
  }
}

function stringId(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof (value as { toHexString?: () => string }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString();
  }
  return String(value);
}

function objectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

function timestamp(value: Date | string | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isReviewLocked(record?: {
  review?: {
    status?: string;
    lockedFields?: string[];
  };
}): boolean {
  const status = record?.review?.status || 'unreviewed';
  return status !== 'unreviewed' || Boolean(record?.review?.lockedFields?.length);
}

function groupKey(signalIds: string[]): string {
  return [...signalIds].sort().join('|');
}

function scoreSignal(
  signal: DuplicateAccessSignalRecord,
  pathwayContextById: Map<string, DuplicateAccessSignalPathwayContext>,
): number {
  const pathwayId = stringId(signal.entryPathwayId);
  const pathway = pathwayId ? pathwayContextById.get(pathwayId) : undefined;
  return [
    isReviewLocked(signal) ? 1000 : 0,
    pathway && !pathway.archived ? 100 : 0,
    pathway?.activeContactRoutes ? 20 : 0,
    pathway?.activePostedOpportunities ? 20 : 0,
    stringId(signal.derivationKey).startsWith('application-route-backfill:') ? 5 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function sortedSignalsForCanonicalChoice(
  signals: DuplicateAccessSignalRecord[],
  pathwayContextById: Map<string, DuplicateAccessSignalPathwayContext>,
): DuplicateAccessSignalRecord[] {
  return [...signals].sort((a, b) => {
    const scoreDelta = scoreSignal(b, pathwayContextById) - scoreSignal(a, pathwayContextById);
    if (scoreDelta !== 0) return scoreDelta;
    const createdDelta = timestamp(a.createdAt) - timestamp(b.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return stringId(a._id).localeCompare(stringId(b._id));
  });
}

function pathwayArchiveSkipReason(
  pathway: DuplicateAccessSignalPathwayContext | undefined,
): string | null {
  if (!pathway) return 'missing-pathway';
  if (pathway.archived === true) return 'already-archived';
  if (!stringId(pathway.derivationKey).startsWith('application-route-backfill:')) {
    return 'non-application-route-pathway';
  }
  if (isReviewLocked(pathway)) return 'review-locked-pathway';
  if (pathway.activeContactRoutes > 0) return 'active-contact-routes';
  if (pathway.activePostedOpportunities > 0) return 'active-posted-opportunities';
  if (pathway.activeAccessSignals > 1) return 'other-active-access-signals';
  return null;
}

export function buildDuplicateAccessSignalRepairPlans(
  groups: DuplicateAccessSignalGroup[],
  signals: DuplicateAccessSignalRecord[],
  pathwayContexts: DuplicateAccessSignalPathwayContext[],
): DuplicateAccessSignalRepairPlanResult {
  const signalById = new Map(signals.map((signal) => [stringId(signal._id), signal]));
  const pathwayContextById = new Map(
    pathwayContexts.map((pathway) => [pathway.entryPathwayId, pathway]),
  );
  const grouped = new Map<
    string,
    {
      signalIds: string[];
      identityFields: DuplicateAccessSignalRepairPlan['identityFields'];
    }
  >();

  for (const group of groups) {
    const signalIds = (group.signalIds || []).map(stringId).filter(Boolean);
    if (signalIds.length < 2) continue;
    const key = groupKey(signalIds);
    const existing = grouped.get(key);
    const identity = {
      identityField: group.identityField,
      identityValue: stringId(group.identityValue),
    };
    if (existing) {
      if (
        !existing.identityFields.some(
          (candidate) =>
            candidate.identityField === identity.identityField &&
            candidate.identityValue === identity.identityValue,
        )
      ) {
        existing.identityFields.push(identity);
      }
      continue;
    }
    grouped.set(key, {
      signalIds,
      identityFields: [identity],
    });
  }

  const result: DuplicateAccessSignalRepairPlanResult = {
    plans: [],
    blocked: [],
  };

  for (const group of grouped.values()) {
    const groupSignals = group.signalIds.map((id) => signalById.get(id)).filter(Boolean) as DuplicateAccessSignalRecord[];
    if (groupSignals.length !== group.signalIds.length) {
      result.blocked.push({
        signalIds: group.signalIds,
        identityFields: group.identityFields,
        reason: 'missing-signal-record',
      });
      continue;
    }
    const activeSignals = groupSignals.filter((signal) => signal.archived !== true);
    if (activeSignals.length < 2) continue;

    const researchEntityIds = new Set(activeSignals.map((signal) => stringId(signal.researchEntityId)));
    const signalTypes = new Set(activeSignals.map((signal) => stringId(signal.signalType)));
    if (researchEntityIds.size !== 1 || signalTypes.size !== 1) {
      result.blocked.push({
        signalIds: group.signalIds,
        identityFields: group.identityFields,
        reason: 'mixed-signal-scope',
      });
      continue;
    }

    const [canonical, ...duplicates] = sortedSignalsForCanonicalChoice(
      activeSignals,
      pathwayContextById,
    );
    const lockedDuplicate = duplicates.find(isReviewLocked);
    if (lockedDuplicate) {
      result.blocked.push({
        signalIds: group.signalIds,
        identityFields: group.identityFields,
        reason: `review-locked-duplicate-signal:${stringId(lockedDuplicate._id)}`,
      });
      continue;
    }

    const archiveEntryPathwayIds: string[] = [];
    const skippedEntryPathwayArchives: DuplicateAccessSignalRepairPlan['skippedEntryPathwayArchives'] = [];
    for (const duplicate of duplicates) {
      const entryPathwayId = stringId(duplicate.entryPathwayId);
      if (!entryPathwayId || entryPathwayId === stringId(canonical.entryPathwayId)) continue;
      const pathway = pathwayContextById.get(entryPathwayId);
      const skipReason = pathwayArchiveSkipReason(pathway);
      if (skipReason) {
        if (skipReason !== 'already-archived') {
          skippedEntryPathwayArchives.push({ entryPathwayId, reason: skipReason });
        }
        continue;
      }
      archiveEntryPathwayIds.push(entryPathwayId);
    }

    result.plans.push({
      researchEntityId: [...researchEntityIds][0],
      signalType: [...signalTypes][0],
      canonicalSignalId: stringId(canonical._id),
      duplicateSignalIds: duplicates.map((signal) => stringId(signal._id)),
      archiveEntryPathwayIds: [...new Set(archiveEntryPathwayIds)],
      identityFields: group.identityFields,
      skippedEntryPathwayArchives,
    });
  }

  return result;
}

export function writeDuplicateAccessSignalRepairOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

async function loadDuplicateAccessSignalGroups(limit: number): Promise<DuplicateAccessSignalGroup[]> {
  const fields: DuplicateAccessSignalGroup['identityField'][] = [
    'derivationKey',
    'sourceEvidenceId',
    'observationId',
  ];
  const groups: DuplicateAccessSignalGroup[] = [];

  for (const field of fields) {
    const rows = await AccessSignal.aggregate([
      {
        $match: {
          archived: { $ne: true },
          researchEntityId: { $exists: true, $ne: null },
          signalType: { $exists: true, $ne: '' },
          [field]: { $exists: true, $ne: null },
        },
      },
      {
        $project: {
          researchEntityId: { $toString: '$researchEntityId' },
          signalType: '$signalType',
          identityValue: { $toString: `$${field}` },
          signalId: { $toString: '$_id' },
        },
      },
      { $match: { identityValue: { $nin: ['', 'null', 'undefined'] } } },
      {
        $group: {
          _id: {
            researchEntityId: '$researchEntityId',
            signalType: '$signalType',
            identityValue: '$identityValue',
          },
          signalIds: { $addToSet: '$signalId' },
        },
      },
      { $match: { 'signalIds.1': { $exists: true } } },
      { $limit: Math.max(1, limit - groups.length) },
    ]);

    groups.push(
      ...buildDuplicateAccessSignalGroupsFromRows(
        rows.map((row: any) => ({
          researchEntityId: row._id?.researchEntityId,
          signalType: row._id?.signalType,
          identityField: field,
          identityValue: row._id?.identityValue,
          signalIds: row.signalIds || [],
        })),
      ),
    );
    if (groups.length >= limit) return groups.slice(0, limit);
  }

  return groups;
}

async function loadSignalRecords(groups: DuplicateAccessSignalGroup[]): Promise<DuplicateAccessSignalRecord[]> {
  const signalIds = [
    ...new Set(groups.flatMap((group) => group.signalIds || [])),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (signalIds.length === 0) return [];
  return AccessSignal.find({ _id: { $in: signalIds.map(objectId) } }).lean() as Promise<
    DuplicateAccessSignalRecord[]
  >;
}

async function loadPathwayContexts(
  signals: DuplicateAccessSignalRecord[],
): Promise<DuplicateAccessSignalPathwayContext[]> {
  const entryPathwayIds = [
    ...new Set(signals.map((signal) => stringId(signal.entryPathwayId)).filter(Boolean)),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (entryPathwayIds.length === 0) return [];
  const objectIds = entryPathwayIds.map(objectId);
  const pathways = await EntryPathway.find({ _id: { $in: objectIds } })
    .select('_id derivationKey archived review')
    .lean();
  const pathwayById = new Map(pathways.map((pathway: any) => [stringId(pathway._id), pathway]));
  const contexts: DuplicateAccessSignalPathwayContext[] = [];

  for (const entryPathwayId of entryPathwayIds) {
    const object = objectId(entryPathwayId);
    const [activeAccessSignals, activeContactRoutes, activePostedOpportunities] = await Promise.all([
      AccessSignal.countDocuments({ entryPathwayId: object, archived: { $ne: true } }),
      ContactRoute.countDocuments({ entryPathwayId: object, archived: { $ne: true } }),
      PostedOpportunity.countDocuments({ entryPathwayId: object, archived: { $ne: true } }),
    ]);
    const pathway = pathwayById.get(entryPathwayId) as any;
    contexts.push({
      entryPathwayId,
      derivationKey: stringId(pathway?.derivationKey),
      archived: pathway?.archived === true,
      activeAccessSignals,
      activeContactRoutes,
      activePostedOpportunities,
      review: pathway?.review,
    });
  }

  return contexts;
}

function plannedWriteCount(plans: DuplicateAccessSignalRepairPlan[]): number {
  return plans.reduce(
    (sum, plan) => sum + plan.duplicateSignalIds.length + plan.archiveEntryPathwayIds.length,
    0,
  );
}

async function applyPlans(plans: DuplicateAccessSignalRepairPlan[]) {
  const now = new Date();
  const signalIds = plans.flatMap((plan) => plan.duplicateSignalIds);
  const entryPathwayIds = plans.flatMap((plan) => plan.archiveEntryPathwayIds);
  const [signals, pathways] = await Promise.all([
    signalIds.length
      ? AccessSignal.updateMany(
          { _id: { $in: signalIds.map(objectId) }, archived: { $ne: true } },
          { $set: { archived: true, lastMaterializedAt: now } },
        )
      : Promise.resolve({ modifiedCount: 0 }),
    entryPathwayIds.length
      ? EntryPathway.updateMany(
          { _id: { $in: entryPathwayIds.map(objectId) }, archived: { $ne: true } },
          { $set: { archived: true, lastMaterializedAt: now } },
        )
      : Promise.resolve({ modifiedCount: 0 }),
  ]);
  return {
    archivedDuplicateSignals: (signals as any).modifiedCount || 0,
    archivedEntryPathways: (pathways as any).modifiedCount || 0,
  };
}

async function main(): Promise<void> {
  const options = parseRepairDuplicateAccessSignalsArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'access-signals:repair-duplicates',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const groups = await loadDuplicateAccessSignalGroups(options.limit);
  const signals = await loadSignalRecords(groups);
  const pathwayContexts = await loadPathwayContexts(signals);
  const planResult = buildDuplicateAccessSignalRepairPlans(groups, signals, pathwayContexts);
  const plannedWrites = plannedWriteCount(planResult.plans);
  assertDuplicateAccessSignalRepairApplyAllowed({
    apply: options.apply,
    confirmDuplicateAccessSignalRepair: options.confirmDuplicateAccessSignalRepair,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedWrites,
  });

  const applied = options.apply
    ? await applyPlans(planResult.plans)
    : { archivedDuplicateSignals: 0, archivedEntryPathways: 0 };
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
    mode: options.apply ? 'apply' : 'dry-run',
    groupsScanned: groups.length,
    plannedGroups: planResult.plans.length,
    blockedGroups: planResult.blocked.length,
    plannedDuplicateSignals: planResult.plans.reduce(
      (sum, plan) => sum + plan.duplicateSignalIds.length,
      0,
    ),
    plannedEntryPathwayArchives: planResult.plans.reduce(
      (sum, plan) => sum + plan.archiveEntryPathwayIds.length,
      0,
    ),
    plannedWrites,
    plans: planResult.plans,
    blocked: planResult.blocked,
    applied,
  };

  console.log(JSON.stringify(report, null, 2));
  writeDuplicateAccessSignalRepairOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
