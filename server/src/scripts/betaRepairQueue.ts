import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import {
  runVisibilityRepairQueue,
  type VisibilityRepairMode,
  type VisibilityRepairQueueOptions,
} from '../services/visibilityRepairQueueService';
import type {
  VisibilityReleaseQueueCollection,
  VisibilityRepairStage,
} from '../models/visibilityReleaseQueueItem';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

export interface BetaRepairQueueCliOptions extends VisibilityRepairQueueOptions {
  confirmBetaRepairQueueApply?: boolean;
  output?: string;
  applyFrom?: string;
  includeBlockedPatches?: boolean;
}

export interface BetaRepairQueueApplyArtifactValidation {
  recordIds: string[];
  queueItemIds: string[];
  retryBlocked?: boolean;
  suppressUnsafe?: boolean;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseBetaRepairQueueArgs(argv: string[]): BetaRepairQueueCliOptions {
  const options: BetaRepairQueueCliOptions = {
    mode: 'dry-run',
    collection: 'all',
    confirmBetaRepairQueueApply: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode=apply' || arg === '--apply') {
      options.mode = 'apply';
    } else if (arg === '--mode=dry-run' || arg === '--dry-run') {
      options.mode = 'dry-run';
    } else if (arg === '--collection=research' || arg === '--collection=programs') {
      options.collection = arg.slice('--collection='.length) as VisibilityReleaseQueueCollection;
    } else if (arg === '--collection=all') {
      options.collection = 'all';
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--record-id') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--record-id requires a value');
      options.recordIds = [...(options.recordIds || []), next.trim()];
      i += 1;
    } else if (arg.startsWith('--record-id=')) {
      const recordId = arg.slice('--record-id='.length).trim();
      if (!recordId || recordId.startsWith('--')) throw new Error('--record-id requires a value');
      options.recordIds = [...(options.recordIds || []), recordId];
    } else if (arg.startsWith('--stage=')) {
      options.stage = arg.slice('--stage='.length) as VisibilityRepairStage;
    } else if (arg === '--suppress-unsafe') {
      options.suppressUnsafe = true;
    } else if (arg === '--retry-blocked') {
      options.retryBlocked = true;
    } else if (arg === '--include-blocked-patches') {
      options.includeBlockedPatches = true;
    } else if (arg === '--confirm-beta-repair-queue-apply') {
      options.confirmBetaRepairQueueApply = true;
    } else if (arg.startsWith('--confirm-beta-repair-queue-apply=')) {
      throw new Error('--confirm-beta-repair-queue-apply does not accept a value');
    } else if (arg === '--apply-from') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--apply-from requires a path');
      options.applyFrom = next;
      i += 1;
    } else if (arg.startsWith('--apply-from=')) {
      const applyFrom = arg.slice('--apply-from='.length).trim();
      if (!applyFrom || applyFrom.startsWith('--')) throw new Error('--apply-from requires a path');
      options.applyFrom = applyFrom;
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const output = arg.slice('--output='.length).trim();
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.mode = options.mode as VisibilityRepairMode;
  if (options.recordIds) {
    options.recordIds = Array.from(new Set(options.recordIds.map((id) => id.trim()).filter(Boolean)));
  }
  return options;
}

export function assertBetaRepairQueueApplyReviewedArtifact(
  options: BetaRepairQueueCliOptions,
): void {
  if (options.mode === 'apply' && !options.applyFrom) {
    throw new Error(
      '--apply-from is required when --apply is set for beta:repair-queue; review a fresh Beta dry-run artifact before applying repairs.',
    );
  }
  if (options.mode === 'apply' && !options.confirmBetaRepairQueueApply) {
    throw new Error(
      '--confirm-beta-repair-queue-apply is required when --apply is set for beta:repair-queue.',
    );
  }
}

const APPLY_FROM_MAX_AGE_HOURS = 48;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function validateBetaRepairQueueApplyArtifact(
  artifact: Record<string, unknown>,
  options: BetaRepairQueueCliOptions,
  now = new Date(),
): BetaRepairQueueApplyArtifactValidation {
  if (textValue(artifact.environment).toLowerCase() !== 'beta') {
    throw new Error('Apply-from artifact must target beta.');
  }
  if (textValue(artifact.mode) !== 'dry-run') {
    throw new Error('Apply-from artifact must be a dry-run report.');
  }

  const generatedAt = new Date(textValue(artifact.generatedAt));
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error('Apply-from artifact is missing a valid generatedAt timestamp.');
  }
  const ageHours = (now.getTime() - generatedAt.getTime()) / (60 * 60 * 1000);
  if (ageHours < 0 || ageHours > APPLY_FROM_MAX_AGE_HOURS) {
    throw new Error('Apply-from artifact is stale; regenerate the dry-run before apply.');
  }

  const artifactOptions = objectValue(artifact.options);
  if (textValue(artifactOptions.collection) !== textValue(options.collection || 'all')) {
    throw new Error('Apply-from artifact collection does not match requested apply options.');
  }
  if (textValue(artifactOptions.stage) !== textValue(options.stage)) {
    throw new Error('Apply-from artifact stage does not match requested apply options.');
  }

  const recordIds: string[] = [];
  const queueItemIds: string[] = [];
  for (const attempt of arrayValue(artifact.attempts)) {
    const attemptRecord = objectValue(attempt);
    if (attemptRecord.applied !== true) continue;
    const status = textValue(attemptRecord.status);
    const hasPatchSummary = arrayValue(attemptRecord.patchSummary).some((summary) =>
      Boolean(textValue(summary)),
    );
    if (
      status !== 'repaired' &&
      !(options.includeBlockedPatches === true && status === 'blocked' && hasPatchSummary)
    ) {
      continue;
    }
    const plan = objectValue(attemptRecord.plan);
    const recordId = textValue(plan.recordId);
    const queueItemId = textValue(plan.queueItemId);
    if (recordId) recordIds.push(recordId);
    if (queueItemId) queueItemIds.push(queueItemId);
  }

  if (recordIds.length === 0) {
    throw new Error('Apply-from artifact contains no dry-run-positive repair attempts.');
  }

  return {
    recordIds: Array.from(new Set(recordIds)),
    queueItemIds: Array.from(new Set(queueItemIds)),
    ...(artifactOptions.retryBlocked === true ? { retryBlocked: true } : {}),
    ...(artifactOptions.suppressUnsafe === true ? { suppressUnsafe: true } : {}),
  };
}

export function buildApplyFromArtifactOptions(
  validation: BetaRepairQueueApplyArtifactValidation,
  options: BetaRepairQueueCliOptions,
): VisibilityRepairQueueOptions {
  return {
    mode: 'apply',
    collection: options.collection,
    stage: options.stage,
    retryBlocked: options.retryBlocked ?? validation.retryBlocked,
    suppressUnsafe: options.suppressUnsafe ?? validation.suppressUnsafe,
    recordIds: validation.recordIds,
    queueItemIds: validation.queueItemIds,
    limit: validation.recordIds.length,
  };
}

export function writeBetaRepairQueueOutput(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildBetaRepairQueueOutput(
  target: { environment: string; db: string; options?: BetaRepairQueueCliOptions },
  report: Record<string, unknown>,
  now = new Date(),
): Record<string, unknown> {
  const blockedReasonCounts = summarizeBlockedReasonCounts(report.attempts);
  return {
    generatedAt: now.toISOString(),
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...(blockedReasonCounts.length > 0 ? { blockedReasonCounts } : {}),
    ...report,
  };
}

function summarizeBlockedReasonCounts(
  attempts: unknown,
): Array<{ reason: string; count: number }> {
  if (!Array.isArray(attempts)) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== 'object') continue;
    const record = attempt as Record<string, unknown>;
    if (record.applied === true && textValue(record.status) === 'repaired') continue;

    for (const reason of blockedReasonsForAttempt(record)) {
      if (typeof reason !== 'string' || !reason.trim()) continue;
      const normalized = reason.trim();
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function blockedReasonsForAttempt(record: Record<string, unknown>): unknown[] {
  if (Array.isArray(record.remainingBlockers)) {
    return record.remainingBlockers;
  }

  if (record.plan && typeof record.plan === 'object') {
    const plan = record.plan as Record<string, unknown>;
    if (Array.isArray(plan.blockerReasons)) {
      return plan.blockerReasons;
    }
  }

  return [];
}

async function main() {
  const options = parseBetaRepairQueueArgs(process.argv.slice(2));
  assertBetaRepairQueueApplyReviewedArtifact(options);
  const guard = assertScriptApplyAllowed({
    apply: options.mode === 'apply',
    scriptName: 'betaRepairQueue',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  let runOptions: VisibilityRepairQueueOptions = options;
  if (options.applyFrom) {
    if (options.mode !== 'apply') {
      throw new Error('--apply-from can only be used with --mode=apply or --apply');
    }
    const artifact = JSON.parse(fs.readFileSync(options.applyFrom, 'utf8'));
    const validation = validateBetaRepairQueueApplyArtifact(artifact, options);
    runOptions = buildApplyFromArtifactOptions(validation, options);
  }
  const report = await runVisibilityRepairQueue(runOptions);

  const outputReport = buildBetaRepairQueueOutput(
    { environment: guard.environment, db: guard.dbLabel, options },
    report as unknown as Record<string, unknown>,
  );

  console.log(JSON.stringify(outputReport, null, 2));
  writeBetaRepairQueueOutput(outputReport, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run beta repair queue:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
