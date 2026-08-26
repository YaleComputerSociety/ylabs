import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Signal } from '../models/signal';
import { deriveAccessArtifactsForResearchGroup } from '../scrapers/accessMaterializer';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'access-signals:reconcile-not-currently-available';

export interface ReconcileNotCurrentlyAvailableArgs {
  apply: boolean;
  confirmReconcileNotCurrentlyAvailable: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
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

export function parseReconcileNotCurrentlyAvailableArgs(
  argv: string[],
): ReconcileNotCurrentlyAvailableArgs {
  const options: ReconcileNotCurrentlyAvailableArgs = {
    apply: false,
    confirmReconcileNotCurrentlyAvailable: false,
    limit: 1000,
    limitProvided: false,
    maxApply: 200,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-reconcile-not-currently-available') {
      options.confirmReconcileNotCurrentlyAvailable = true;
      continue;
    }
    if (arg.startsWith('--confirm-reconcile-not-currently-available=')) {
      throw new Error('--confirm-reconcile-not-currently-available does not accept a value');
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

    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return options;
}

export function assertReconcileNotCurrentlyAvailableApplyAllowed(args: {
  apply: boolean;
  confirmReconcileNotCurrentlyAvailable?: boolean;
  limitProvided?: boolean;
  plannedWrites: number;
  maxApply: number;
}): void {
  if (!args.apply) return;
  if (!args.limitProvided) {
    throw new Error(`--limit is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (!args.confirmReconcileNotCurrentlyAvailable) {
    throw new Error(
      `--confirm-reconcile-not-currently-available is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  if (args.plannedWrites > args.maxApply) {
    throw new Error(`Apply would modify ${args.plannedWrites} signals, above --max-apply.`);
  }
}

function assertConnectedToDevelopment(mongoUrl: string | undefined): void {
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertOperatorEnvironmentMatchesDatabase('development', databaseNameFromMongoUrl(mongoUrl));
}

function isReviewLocked(signal: {
  review?: { status?: string; lockedFields?: string[] };
}): boolean {
  const status = signal?.review?.status || 'unreviewed';
  return status !== 'unreviewed' || Boolean(signal?.review?.lockedFields?.length);
}

interface StaleSignalPlan {
  researchEntityId: string;
  signalId: string;
  excerpt?: string;
}

interface ReconcilePlanResult {
  plans: StaleSignalPlan[];
  lockedSkipped: StaleSignalPlan[];
  stillValid: StaleSignalPlan[];
}

async function buildReconcilePlan(limit: number): Promise<ReconcilePlanResult> {
  const liveSignals = await Signal.find({
    type: 'NOT_CURRENTLY_AVAILABLE',
    archived: { $ne: true },
  })
    .limit(limit)
    .lean();

  const plans: StaleSignalPlan[] = [];
  const lockedSkipped: StaleSignalPlan[] = [];
  const stillValid: StaleSignalPlan[] = [];

  for (const signal of liveSignals as any[]) {
    const researchEntityId = serializedDocumentId(signal.researchEntityId);
    const signalId = serializedDocumentId(signal._id);
    if (!researchEntityId || !signalId) continue;

    const derivation = await deriveAccessArtifactsForResearchGroup({ researchEntityId });
    const stillDerived = derivation.artifacts.accessSignals.some(
      (candidate) => candidate.type === 'NOT_CURRENTLY_AVAILABLE',
    );
    const entry: StaleSignalPlan = {
      researchEntityId,
      signalId,
      excerpt: signal.source?.excerpt,
    };

    if (stillDerived) {
      stillValid.push(entry);
      continue;
    }
    if (isReviewLocked(signal)) {
      lockedSkipped.push(entry);
      continue;
    }
    plans.push(entry);
  }

  return { plans, lockedSkipped, stillValid };
}

async function applyPlans(plans: StaleSignalPlan[]): Promise<{ archivedSignals: number }> {
  if (plans.length === 0) return { archivedSignals: 0 };
  const now = new Date();
  const ids = plans.map((plan) => new mongoose.Types.ObjectId(plan.signalId));
  const result = await Signal.updateMany(
    { _id: { $in: ids }, archived: { $ne: true } },
    { $set: { archived: true, lastMaterializedAt: now } },
  );
  return { archivedSignals: result.modifiedCount || 0 };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const options = parseReconcileNotCurrentlyAvailableArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGODBURL;
  assertConnectedToDevelopment(mongoUrl);

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  assertOperatorEnvironmentMatchesDatabase('development', db.databaseName);

  const { plans, lockedSkipped, stillValid } = await buildReconcilePlan(options.limit);

  assertReconcileNotCurrentlyAvailableApplyAllowed({
    apply: options.apply,
    confirmReconcileNotCurrentlyAvailable: options.confirmReconcileNotCurrentlyAvailable,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedWrites: plans.length,
  });

  const affectedEntityIds = plans.map((plan) => plan.researchEntityId);

  const applied = options.apply ? await applyPlans(plans) : { archivedSignals: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    databaseName: db.databaseName,
    options,
    mode: options.apply ? 'apply' : 'dry-run',
    liveNotCurrentlyAvailableSignalsScanned:
      plans.length + lockedSkipped.length + stillValid.length,
    stillValidUnderFixedClassifier: stillValid.length,
    staleOverFiredSignals: plans.length,
    reviewLockedSkipped: lockedSkipped.length,
    plannedWrites: plans.length,
    applied,
    staleEntityIds: affectedEntityIds,
    lockedSkippedEntityIds: lockedSkipped.map((plan) => plan.researchEntityId),
  };

  console.log(JSON.stringify(report, null, 2));
  writeOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(`Failed to run ${SCRIPT_NAME}:`, sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
