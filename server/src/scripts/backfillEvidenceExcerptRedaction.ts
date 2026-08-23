import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REDACTION_MARKER_RE = /\[(?:email|phone) redacted\]/i;
const EXCERPT_FIELD = 'source.excerpt';

export interface BackfillEvidenceExcerptRedactionCliOptions {
  apply: boolean;
  confirmEvidenceExcerptRedaction: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
}

export interface EvidenceExcerptSignalRecord {
  _id: unknown;
  type?: string;
  source?: {
    excerpt?: string;
  };
  review?: {
    status?: string;
    lockedFields?: string[];
  };
}

export interface EvidenceExcerptRedactionPlan {
  signalId: string;
  type: string;
  before: string;
  after: string;
}

export interface BlockedEvidenceExcerptRedaction {
  signalId: string;
  type: string;
  reason: string;
}

export interface EvidenceExcerptRedactionPlanResult {
  plans: EvidenceExcerptRedactionPlan[];
  blocked: BlockedEvidenceExcerptRedaction[];
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

export function parseBackfillEvidenceExcerptRedactionArgs(
  argv: string[],
): BackfillEvidenceExcerptRedactionCliOptions {
  const options: BackfillEvidenceExcerptRedactionCliOptions = {
    apply: false,
    confirmEvidenceExcerptRedaction: false,
    limit: 1000,
    limitProvided: false,
    maxApply: 50,
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
    if (arg === '--confirm-evidence-excerpt-redaction') {
      options.confirmEvidenceExcerptRedaction = true;
      continue;
    }
    if (arg.startsWith('--confirm-evidence-excerpt-redaction=')) {
      throw new Error('--confirm-evidence-excerpt-redaction does not accept a value');
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

    throw new Error(`Unknown access-signals:backfill-excerpt-redaction argument: ${arg}`);
  }

  return options;
}

export function assertBackfillEvidenceExcerptRedactionApplyAllowed(args: {
  apply: boolean;
  confirmEvidenceExcerptRedaction?: boolean;
  limitProvided?: boolean;
  plannedWrites: number;
  maxApply: number;
}): void {
  if (!args.apply) return;
  if (!args.limitProvided) {
    throw new Error(
      '--limit is required when --apply is set for access-signals:backfill-excerpt-redaction',
    );
  }
  if (!args.confirmEvidenceExcerptRedaction) {
    throw new Error(
      '--confirm-evidence-excerpt-redaction is required when --apply is set for access-signals:backfill-excerpt-redaction',
    );
  }
  if (args.plannedWrites > args.maxApply) {
    throw new Error(`Apply would modify ${args.plannedWrites} signals, above --max-apply.`);
  }
}

function isExcerptReviewLocked(record?: EvidenceExcerptSignalRecord): boolean {
  return Boolean(record?.review?.lockedFields?.includes(EXCERPT_FIELD));
}

export function buildEvidenceExcerptRedactionPlans(
  records: EvidenceExcerptSignalRecord[],
): EvidenceExcerptRedactionPlanResult {
  const result: EvidenceExcerptRedactionPlanResult = { plans: [], blocked: [] };

  for (const record of records) {
    const signalId = serializedDocumentId(record._id) || '';
    const type = record.type || '';
    const before = String(record.source?.excerpt || '');
    if (!REDACTION_MARKER_RE.test(before)) continue;

    if (isExcerptReviewLocked(record)) {
      result.blocked.push({ signalId, type, reason: 'review-locked-excerpt' });
      continue;
    }

    const after = sanitizeEvidenceExcerpt(before);
    if (after === before) continue;

    result.plans.push({ signalId, type, before, after });
  }

  return result;
}

export function writeBackfillEvidenceExcerptRedactionOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function loadMarkerBearingAccessSignals(
  limit: number,
): Promise<EvidenceExcerptSignalRecord[]> {
  return (await Signal.find({
    archived: { $ne: true },
    type: { $in: [...accessSignalTypes] },
    'source.excerpt': { $regex: REDACTION_MARKER_RE },
  })
    .select('type source.excerpt review.status review.lockedFields')
    .limit(Math.max(1, limit))
    .lean()) as unknown as EvidenceExcerptSignalRecord[];
}

async function applyPlans(plans: EvidenceExcerptRedactionPlan[]): Promise<number> {
  const now = new Date();
  let modified = 0;
  for (const plan of plans) {
    const id = new mongoose.Types.ObjectId(plan.signalId);
    const outcome = await Signal.updateOne(
      { _id: id },
      { $set: { 'source.excerpt': plan.after, lastMaterializedAt: now } },
    );
    modified += (outcome as { modifiedCount?: number }).modifiedCount || 0;
  }
  return modified;
}

async function main(): Promise<void> {
  const options = parseBackfillEvidenceExcerptRedactionArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'access-signals:backfill-excerpt-redaction',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const records = await loadMarkerBearingAccessSignals(options.limit);
  const planResult = buildEvidenceExcerptRedactionPlans(records);
  const plannedWrites = planResult.plans.length;
  assertBackfillEvidenceExcerptRedactionApplyAllowed({
    apply: options.apply,
    confirmEvidenceExcerptRedaction: options.confirmEvidenceExcerptRedaction,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedWrites,
  });

  const modifiedSignals = options.apply ? await applyPlans(planResult.plans) : 0;
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
    mode: options.apply ? 'apply' : 'dry-run',
    signalsScanned: records.length,
    plannedWrites,
    blockedSignals: planResult.blocked.length,
    plans: planResult.plans,
    blocked: planResult.blocked,
    applied: { modifiedSignals },
  };

  console.log(JSON.stringify(report, null, 2));
  writeBackfillEvidenceExcerptRedactionOutput(report, options.output);
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
