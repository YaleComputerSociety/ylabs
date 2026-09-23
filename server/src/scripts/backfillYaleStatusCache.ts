import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { serializedDocumentId } from '../utils/idSerialization';
import { CLEARED_RESEARCH_ENTITY_YALE_STATUS } from '../utils/researchEntityYaleStatus';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';
import {
  planYaleStatusCacheBackfill,
  type YaleStatusCacheDoc,
} from './backfillYaleStatusCacheCore';

if (process.env.YLABS_SKIP_LOCAL_DOTENV !== 'true') {
  dotenv.config();
}

const SCRIPT_NAME = 'research:backfill-yale-status-cache';

export interface BackfillYaleStatusCacheCliOptions {
  apply: boolean;
  confirmYaleStatusCacheBackfill: boolean;
  limit: number;
  output?: string;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function parseBackfillYaleStatusCacheArgs(
  argv: string[],
): BackfillYaleStatusCacheCliOptions {
  const options: BackfillYaleStatusCacheCliOptions = {
    apply: false,
    confirmYaleStatusCacheBackfill: false,
    limit: Infinity,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-yale-status-cache-backfill') {
      options.confirmYaleStatusCacheBackfill = true;
      continue;
    }
    if (arg.startsWith('--confirm-yale-status-cache-backfill=')) {
      throw new Error('--confirm-yale-status-cache-backfill does not accept a value');
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return options;
}

export function assertDevelopmentTarget(mongoUrl: string | undefined): void {
  let database = '';
  try {
    database = new URL(mongoUrl || '').pathname.replace(/^\//, '');
  } catch {
    database = '';
  }
  if (database.toLowerCase() !== 'development') {
    throw new Error(
      `${SCRIPT_NAME} only applies against the Development database; refusing target "${database || '(unknown)'}".`,
    );
  }
}

export function assertBackfillYaleStatusCacheApplyAllowed(
  options: Pick<
    BackfillYaleStatusCacheCliOptions,
    'apply' | 'confirmYaleStatusCacheBackfill' | 'limit'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error(`--limit is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (options.apply && !options.confirmYaleStatusCacheBackfill) {
    throw new Error(
      `--confirm-yale-status-cache-backfill is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  if (options.apply) {
    assertDevelopmentTarget(mongoUrl);
  }
  return assertScriptApplyAllowed({ apply: options.apply, scriptName: SCRIPT_NAME, mongoUrl, env });
}

async function main() {
  const options = parseBackfillYaleStatusCacheArgs(process.argv.slice(2));
  const guard = assertBackfillYaleStatusCacheApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();

  // No `.sort()`: sorting 4,756 whole documents on an unindexed `name` exceeded
  // Mongo's 32MB in-memory sort limit, so every invocation of this command failed
  // before reading a row, which is why the one row #2684 found stayed unrepaired.
  // The order only makes the report and the bounded apply deterministic, so it is
  // taken in Node from the same label the report prints.
  const rows = await ResearchEntity.find({ archived: { $ne: true } }).lean();

  const docs: YaleStatusCacheDoc[] = rows
    .map((row: any) => ({
      ...row,
      id: serializedDocumentId(row._id) || '',
      label: row.displayName || row.name || row.slug || serializedDocumentId(row._id) || '',
    }))
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    );

  const plan = planYaleStatusCacheBackfill(docs);

  // `--limit` bounds the WRITES, not the scan. It used to bound the query, so a
  // bounded apply planned from the first N rows by name and could not reach a row
  // further down the corpus however many times it ran: the blast-radius bound and
  // the population were the same number. The plan is now always whole-corpus and
  // the cap decides how much of it is written.
  const plannedWrites: Array<{ kind: 'update' | 'heal'; label: string; id: string }> = [
    ...plan.toUpdate.map((target) => ({
      kind: 'update' as const,
      label: target.label,
      id: target.id,
    })),
    ...plan.toHeal.map((target) => ({ kind: 'heal' as const, label: target.label, id: target.id })),
  ].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const writeBudget = Number.isFinite(options.limit) ? options.limit : plannedWrites.length;
  const writes = plannedWrites.slice(0, writeBudget);
  const updatesById = new Map(plan.toUpdate.map((target) => [target.id, target]));

  if (options.apply) {
    for (const write of writes) {
      const target = updatesById.get(write.id);
      if (write.kind === 'update' && target) {
        await ResearchEntity.updateOne(
          { _id: target.id },
          {
            $set: {
              yaleStatusCache: 'departed',
              activeAtYaleCache: false,
              studentVisibilityTier: target.nextStudentVisibilityTier,
              studentVisibilityComputedTier: target.nextStudentVisibilityComputedTier,
              studentVisibilityReasons: target.nextStudentVisibilityReasons,
              studentVisibilityComputedAt: new Date(),
            },
          },
        );
        continue;
      }
      // A heal only resets the status cache. The resulting tier depends on leads
      // and access signals this script does not load, so it is left to
      // `student-visibility:gate` rather than guessed here.
      await ResearchEntity.updateOne(
        { _id: write.id },
        { $set: { ...CLEARED_RESEARCH_ENTITY_YALE_STATUS } },
      );
    }
    const touchedIds = writes.map((write) => write.id);
    if (touchedIds.length > 0) {
      const updatedDocs = await ResearchEntity.find({ _id: { $in: touchedIds } }).lean();
      await syncEntities('researchEntity', updatedDocs);
    }
  }

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scanned: plan.scanned,
    gainingCacheValue: plan.toUpdate.length,
    countsByReason: plan.countsByReason,
    flipToSuppressedCount: plan.flipToSuppressedCount,
    manuallyLockedSkipped: plan.manuallyLockedSkipped,
    healingStaleInactiveCache: plan.toHeal.length,
    healingSuppressedOnlyByInactiveAtYale: plan.toHeal.filter(
      (target) => target.suppressedOnlyByInactiveAtYale,
    ).length,
    plannedWrites: plannedWrites.length,
    writtenThisRun: options.apply ? writes.length : 0,
    deferredByWriteLimit: plannedWrites.length - writes.length,
    nextStep:
      plan.toHeal.length > 0
        ? 'Run student-visibility:gate --apply to recompute tiers for the healed rows.'
        : undefined,
    sample: plan.toUpdate.slice(0, 50),
    healSample: plan.toHeal.slice(0, 50),
    options,
  };

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill Yale status cache:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
