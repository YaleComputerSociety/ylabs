import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import {
  buildDuplicateAccessSignalGroupsFromRows,
  type DuplicateAccessSignalGroup,
} from '../scrapers/integrityGate';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

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
  signalType?: string;
  sourceEvidenceId?: unknown;
  observationId?: unknown;
  derivationKey?: string | null;
  archived?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  suppression?: {
    reason?: string;
    lockedFields?: string[];
  };
}

export interface DuplicateAccessSignalRepairPlan {
  researchEntityId: string;
  signalType: string;
  canonicalSignalId: string;
  duplicateSignalIds: string[];
  identityFields: Array<{
    identityField: DuplicateAccessSignalGroup['identityField'];
    identityValue: string;
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

const DUPLICATE_ACCESS_SIGNAL_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeDuplicateAccessSignalObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return DUPLICATE_ACCESS_SIGNAL_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
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

function valueForFlag(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
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
      options.output = resolveSafeJsonReportOutputPath(parsed.value);
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
  return serializedDocumentId(value) || '';
}

function objectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeDuplicateAccessSignalObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

function timestamp(value: Date | string | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSuppressionLocked(record?: {
  suppression?: {
    reason?: string;
    lockedFields?: string[];
  };
}): boolean {
  return Boolean(record?.suppression?.reason || record?.suppression?.lockedFields?.length);
}

function groupKey(signalIds: string[]): string {
  return [...signalIds].sort().join('|');
}

function scoreSignal(signal: DuplicateAccessSignalRecord): number {
  return [
    isSuppressionLocked(signal) ? 1000 : 0,
    stringId(signal.derivationKey).startsWith('application-route-backfill:') ? 5 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function sortedSignalsForCanonicalChoice(
  signals: DuplicateAccessSignalRecord[],
): DuplicateAccessSignalRecord[] {
  return [...signals].sort((a, b) => {
    const scoreDelta = scoreSignal(b) - scoreSignal(a);
    if (scoreDelta !== 0) return scoreDelta;
    const createdDelta = timestamp(a.createdAt) - timestamp(b.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return stringId(a._id).localeCompare(stringId(b._id));
  });
}

export function buildDuplicateAccessSignalRepairPlans(
  groups: DuplicateAccessSignalGroup[],
  signals: DuplicateAccessSignalRecord[],
): DuplicateAccessSignalRepairPlanResult {
  const signalById = new Map(signals.map((signal) => [stringId(signal._id), signal]));
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
    const groupSignals = group.signalIds
      .map((id) => signalById.get(id))
      .filter(Boolean) as DuplicateAccessSignalRecord[];
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

    const researchEntityIds = new Set(
      activeSignals.map((signal) => stringId(signal.researchEntityId)),
    );
    const signalTypes = new Set(activeSignals.map((signal) => stringId(signal.signalType)));
    if (researchEntityIds.size !== 1 || signalTypes.size !== 1) {
      result.blocked.push({
        signalIds: group.signalIds,
        identityFields: group.identityFields,
        reason: 'mixed-signal-scope',
      });
      continue;
    }

    const [canonical, ...duplicates] = sortedSignalsForCanonicalChoice(activeSignals);
    const lockedDuplicate = duplicates.find(isSuppressionLocked);
    if (lockedDuplicate) {
      result.blocked.push({
        signalIds: group.signalIds,
        identityFields: group.identityFields,
        reason: `suppression-locked-duplicate-signal:${stringId(lockedDuplicate._id)}`,
      });
      continue;
    }

    result.plans.push({
      researchEntityId: [...researchEntityIds][0],
      signalType: [...signalTypes][0],
      canonicalSignalId: stringId(canonical._id),
      duplicateSignalIds: duplicates.map((signal) => stringId(signal._id)),
      identityFields: group.identityFields,
    });
  }

  return result;
}

export function writeDuplicateAccessSignalRepairOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function loadDuplicateAccessSignalGroups(
  limit: number,
): Promise<DuplicateAccessSignalGroup[]> {
  const fields: DuplicateAccessSignalGroup['identityField'][] = [
    'derivationKey',
    'sourceEvidenceId',
    'observationId',
  ];
  const identityFieldPath: Record<DuplicateAccessSignalGroup['identityField'], string> = {
    derivationKey: 'derivationKey',
    sourceEvidenceId: 'source.evidenceIds',
    observationId: 'source.evidenceIds',
  };
  const groups: DuplicateAccessSignalGroup[] = [];

  for (const field of fields) {
    const fieldPath = identityFieldPath[field];
    const identityExpr =
      field === 'derivationKey'
        ? { $toString: `$${fieldPath}` }
        : { $toString: { $arrayElemAt: [`$${fieldPath}`, 0] } };
    const rows = await Signal.aggregate([
      {
        $match: {
          archived: { $ne: true },
          researchEntityId: { $exists: true, $ne: null },
          type: { $in: [...accessSignalTypes] },
          [fieldPath]: { $exists: true, $ne: null },
        },
      },
      {
        $project: {
          researchEntityId: { $toString: '$researchEntityId' },
          signalType: '$type',
          identityValue: identityExpr,
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

async function loadSignalRecords(
  groups: DuplicateAccessSignalGroup[],
): Promise<DuplicateAccessSignalRecord[]> {
  const signalIds = [...new Set(groups.flatMap((group) => group.signalIds || []))]
    .map((id) => normalizeDuplicateAccessSignalObjectId(id))
    .filter((id): id is string => Boolean(id));
  if (signalIds.length === 0) return [];
  const rows = await Signal.find({
    _id: { $in: signalIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).lean();
  return rows.map((row: any) => ({
    ...row,
    signalType: row.type,
  })) as DuplicateAccessSignalRecord[];
}

function plannedWriteCount(plans: DuplicateAccessSignalRepairPlan[]): number {
  return plans.reduce((sum, plan) => sum + plan.duplicateSignalIds.length, 0);
}

async function applyPlans(plans: DuplicateAccessSignalRepairPlan[]) {
  const now = new Date();
  const signalIds = plans
    .flatMap((plan) => plan.duplicateSignalIds)
    .map((id) => objectId(id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const signals = signalIds.length
    ? await Signal.updateMany(
        { _id: { $in: signalIds }, archived: { $ne: true } },
        { $set: { archived: true, lastMaterializedAt: now } },
      )
    : { modifiedCount: 0 };
  return {
    archivedDuplicateSignals: (signals as any).modifiedCount || 0,
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
  const planResult = buildDuplicateAccessSignalRepairPlans(groups, signals);
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
    : { archivedDuplicateSignals: 0 };
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
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
