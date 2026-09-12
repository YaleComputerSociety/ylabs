/**
 * Collapses the search events recorded before the episode fold existed.
 *
 * Dry run by default. Applying deletes the superseded snapshots and the
 * `page > 1` rows, keeping one row per episode, which is what the live fold now
 * does to a snapshot it absorbs. The surviving row also takes the episode's first
 * timestamp and its last snapshot time, because the fullest query is often not
 * the episode's first row and search attribution counts only the actions recorded
 * after a search.
 *
 * `analytics_events` is in `NEVER_COPY_COLLECTIONS`, so a promotion does not
 * carry this: it has to run once per environment against that environment's
 * `MONGODBURL`.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  collapseDeleteIds,
  collapseKeepRewrites,
  planSearchEpisodeCollapse,
  type SearchEventRow,
} from './collapseSearchEpisodeHistoryCore';

dotenv.config();

const SCRIPT_NAME = 'analytics:collapse-search-episodes';

export interface CollapseSearchEpisodesCliOptions {
  apply: boolean;
  confirmSearchEpisodeCollapse: boolean;
  snapshot?: string;
  output?: string;
}

export function parseCollapseSearchEpisodesArgs(argv: string[]): CollapseSearchEpisodesCliOptions {
  const options: CollapseSearchEpisodesCliOptions = {
    apply: false,
    confirmSearchEpisodeCollapse: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-search-episode-collapse') {
      options.confirmSearchEpisodeCollapse = true;
      continue;
    }
    if (arg.startsWith('--confirm-search-episode-collapse=')) {
      throw new Error('--confirm-search-episode-collapse does not accept a value');
    }
    if (arg === '--snapshot') {
      options.snapshot = resolveSafeJsonReportOutputPath(argv[i + 1], '--snapshot');
      i += 1;
      continue;
    }
    if (arg.startsWith('--snapshot=')) {
      options.snapshot = resolveSafeJsonReportOutputPath(
        arg.slice('--snapshot='.length),
        '--snapshot',
      );
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
    throw new Error(`Unknown search episode collapse argument: ${arg}`);
  }

  return options;
}

export function writeJsonArtifact(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * A delete has no undo, and this collection is never mirrored anywhere, so the
 * snapshot of every row the script can see is the restore point. Requiring it
 * for `--apply` keeps the restore point verified rather than declared.
 */
export function assertCollapseSearchEpisodesApplyAllowed(
  options: Pick<
    CollapseSearchEpisodesCliOptions,
    'apply' | 'confirmSearchEpisodeCollapse' | 'snapshot'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (options.apply && !options.confirmSearchEpisodeCollapse) {
    throw new Error(
      `--confirm-search-episode-collapse is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  if (options.apply && !options.snapshot) {
    throw new Error(`--snapshot is required when --apply is set for ${SCRIPT_NAME}`);
  }
  return assertScriptApplyAllowed({ apply: options.apply, scriptName: SCRIPT_NAME, mongoUrl, env });
}

const asOptionalDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

async function main() {
  const options = parseCollapseSearchEpisodesArgs(process.argv.slice(2));
  const guard = assertCollapseSearchEpisodesApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();

  const stored = await AnalyticsEvent.find({ eventType: AnalyticsEventType.SEARCH })
    .sort({ netid: 1, timestamp: 1 })
    .lean();

  const rows: SearchEventRow[] = stored.map((row: any) => ({
    id: serializedDocumentId(row._id) || '',
    netid: String(row.netid ?? ''),
    searchQuery: row.searchQuery ?? '',
    metadata: row.metadata,
    timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
    searchEpisodeUpdatedAt: asOptionalDate(row.searchEpisodeUpdatedAt),
  }));

  const plan = planSearchEpisodeCollapse(rows);
  const deleteIds = collapseDeleteIds(plan);
  const keepRewrites = collapseKeepRewrites(plan);

  if (options.apply) {
    writeJsonArtifact(
      { capturedAt: new Date().toISOString(), db: guard.dbLabel, events: stored },
      options.snapshot,
    );
    if (keepRewrites.length > 0) {
      const rewritten = await AnalyticsEvent.bulkWrite(
        keepRewrites.map((rewrite) => ({
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(rewrite.id) },
            update: {
              $set: {
                timestamp: rewrite.timestamp,
                searchEpisodeUpdatedAt: rewrite.searchEpisodeUpdatedAt,
              },
            },
          },
        })),
      );
      if (rewritten.matchedCount !== keepRewrites.length) {
        throw new Error(
          `${SCRIPT_NAME} planned ${keepRewrites.length} surviving-row rewrites but matched ${rewritten.matchedCount}; nothing was deleted and the snapshot at ${options.snapshot} holds every row it read.`,
        );
      }
    }
    const deleted = await AnalyticsEvent.deleteMany({
      _id: { $in: deleteIds.map((id) => new mongoose.Types.ObjectId(id)) },
    });
    if (deleted.deletedCount !== deleteIds.length) {
      throw new Error(
        `${SCRIPT_NAME} planned ${deleteIds.length} deletions but removed ${deleted.deletedCount}; the snapshot at ${options.snapshot} holds every row it read.`,
      );
    }
  }

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    searchEventsBefore: plan.scanned,
    searchEventsAfter: plan.scanned - deleteIds.length,
    supersededSnapshots: deleteIds.length - plan.pagedDeleteIds.length,
    pagedRows: plan.pagedDeleteIds.length,
    survivingRowsRetimed: keepRewrites.length,
    distinctQueriesBefore: plan.distinctQueriesBefore,
    distinctQueriesAfter: plan.distinctQueriesAfter,
    zeroResultRowsBefore: plan.zeroResultRowsBefore,
    zeroResultRowsAfter: plan.zeroResultRowsAfter,
    episodes: plan.episodes,
    snapshot: options.apply ? options.snapshot : undefined,
  };

  console.log(JSON.stringify(report, null, 2));
  writeJsonArtifact(report, options.output);
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    process.exit(1);
  });
}
