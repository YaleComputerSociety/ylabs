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

dotenv.config();

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
  const guard = assertBackfillYaleStatusCacheApplyAllowed(options, process.env, process.env.MONGODBURL);
  await initializeConnections();

  const query = ResearchEntity.find({ archived: { $ne: true } }).sort({ name: 1 });
  if (Number.isFinite(options.limit)) query.limit(options.limit);
  const rows = await query.lean();

  const docs: YaleStatusCacheDoc[] = rows.map((row: any) => ({
    ...row,
    id: serializedDocumentId(row._id) || '',
    label: row.displayName || row.name || row.slug || serializedDocumentId(row._id) || '',
  }));

  const plan = planYaleStatusCacheBackfill(docs);

  if (options.apply) {
    for (const target of plan.toUpdate) {
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
    }
    // A heal only resets the status cache. The resulting tier depends on leads
    // and access signals this script does not load, so it is left to
    // `student-visibility:gate` rather than guessed here.
    for (const target of plan.toHeal) {
      await ResearchEntity.updateOne(
        { _id: target.id },
        { $set: { ...CLEARED_RESEARCH_ENTITY_YALE_STATUS } },
      );
    }
    const touchedIds = [
      ...plan.toUpdate.map((target) => target.id),
      ...plan.toHeal.map((target) => target.id),
    ];
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
