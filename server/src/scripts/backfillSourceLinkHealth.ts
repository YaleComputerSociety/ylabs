import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { checkSourceLinkHealth, type SourceLinkHealth } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  collectSourceLinkHealthCandidates,
  needsRecheckSince,
  needsSourceLinkHealthRefresh,
} from './backfillSourceLinkHealthCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface SourceLinkHealthBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  staleOnly: boolean;
  checkedBefore?: Date;
  output?: string;
}

export function parseSourceLinkHealthBackfillArgs(argv: string[]): SourceLinkHealthBackfillOptions {
  const options: SourceLinkHealthBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
    staleOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-source-link-health') options.confirm = true;
    else if (arg === '--stale-only') options.staleOnly = true;
    else if (arg.startsWith('--checked-before=')) {
      options.checkedBefore = parseCheckedBefore(arg.slice('--checked-before='.length));
    } else if (arg === '--checked-before') {
      options.checkedBefore = parseCheckedBefore(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown source-link-health backfill argument: ${arg}`);
    }
  }
  return options;
}

function parseCheckedBefore(value: string | undefined): Date {
  if (!value || value.startsWith('--')) {
    throw new Error('--checked-before requires an ISO timestamp');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('--checked-before requires an ISO timestamp');
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function assertSourceLinkHealthApplyAllowed(
  options: Pick<SourceLinkHealthBackfillOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-source-link-health.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface SourceLinkHealthRunOptions {
  dryRun: boolean;
  limit?: number;
  staleOnly: boolean;
  checkedBefore?: Date;
}

/**
 * The seam between the parsed CLI flags and the run, so a flag cannot be added to
 * the parser and silently never reach the run.
 */
export function sourceLinkHealthRunOptions(
  options: SourceLinkHealthBackfillOptions,
): SourceLinkHealthRunOptions {
  return {
    dryRun: options.dryRun,
    ...(options.explicitLimit ? { limit: options.limit } : {}),
    staleOnly: options.staleOnly,
    ...(options.checkedBefore ? { checkedBefore: options.checkedBefore } : {}),
  };
}

export interface SourceLinkHealthBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  skippedFresh: number;
  skippedAlreadyRechecked: number;
  checked: number;
  updated: number;
  errors: number;
  byStatus: Record<string, number>;
  samples: Array<{
    slug: string;
    url: string;
    healthStatus: string;
    httpStatusCode?: number;
  }>;
}

export async function runSourceLinkHealthBackfill(options: {
  dryRun: boolean;
  limit?: number;
  staleOnly?: boolean;
  checkedBefore?: Date;
  checkLink?: (url: string) => Promise<SourceLinkHealth>;
  /**
   * Page size, overridable only so a test can cross a page boundary without seeding
   * a full page of rows. Not a CLI flag: an operator has no reason to tune it.
   */
  pageSize?: number;
}): Promise<SourceLinkHealthBackfillResult> {
  const checkLink = options.checkLink ?? checkSourceLinkHealth;

  const result: SourceLinkHealthBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    skippedFresh: 0,
    skippedAlreadyRechecked: 0,
    checked: 0,
    updated: 0,
    errors: 0,
    byStatus: {},
    samples: [],
  };

  const healthCache = new Map<string, SourceLinkHealth>();

  /**
   * Paged by `_id` rather than streamed from one long-lived cursor.
   *
   * A materialized array held the whole corpus in memory for the entire multi-hour
   * run and the OS killed the process partway through. A cursor fixed the memory and
   * introduced a worse failure: this loop does slow network work between advances,
   * so the gap between `getMore` calls exceeds Atlas's idle-cursor lifetime and the
   * run dies with `MongoServerError: cursor id ... not found`. Observed on
   * Development after about 30 minutes.
   *
   * That failure was silent in the worst way. The `getMore` happens at loop advance,
   * outside this body's try/catch, so nothing caught it, the report was never
   * written, and in apply mode the per-entity writes already committed stayed
   * committed with no record of how far the pass reached.
   *
   * Each page is its own short-lived query, so no cursor is held across a probe, and
   * memory stays bounded by the page size (#2539).
   */
  const PAGE_SIZE = options.pageSize && options.pageSize > 0 ? options.pageSize : 200;
  // A paging bug that fails to advance re-reads page one forever. Unbounded, that is
  // an apply-mode data operation spinning silently and rewriting the same rows, which
  // is worse than a crash: throwing makes it loud. The bound is deliberately
  // generous, so only a genuine non-advance can reach it.
  const maxPages = Math.ceil((await ResearchEntity.estimatedDocumentCount()) / PAGE_SIZE) + 2;
  let pagesRead = 0;
  let lastSeenId: unknown;
  for (;;) {
    pagesRead += 1;
    if (pagesRead > maxPages) {
      throw new Error(
        `source-link-health paging read ${pagesRead} pages for a corpus needing at most ${maxPages}: the page cursor is not advancing.`,
      );
    }
    const page = (await ResearchEntity.find(
      {
        archived: { $ne: true },
        ...(lastSeenId ? { _id: { $gt: lastSeenId } } : {}),
      },
      { _id: 1, slug: 1, websiteUrl: 1, website: 1, sourceUrls: 1, sourceLinkHealth: 1 },
    )
      .sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .lean()) as unknown as Array<Record<string, unknown>>;
    if (page.length === 0) break;
    lastSeenId = page[page.length - 1]._id;

    for (const entity of page) {
      if (options.limit && result.scanned >= options.limit) break;
      if (
        options.checkedBefore &&
        !needsRecheckSince(entity.sourceLinkHealth, options.checkedBefore)
      ) {
        result.skippedAlreadyRechecked += 1;
        continue;
      }
      if (options.staleOnly && !needsSourceLinkHealthRefresh(entity.sourceLinkHealth)) {
        result.skippedFresh += 1;
        continue;
      }
      result.scanned += 1;
      try {
        const signalRows = await Signal.find({
          researchEntityId: entity._id,
          type: { $in: accessSignalTypes },
          archived: false,
        })
          .select('sourceUrl')
          .lean();
        const signalSourceUrls = (signalRows as Array<{ sourceUrl?: unknown }>).map(
          (row) => row.sourceUrl,
        );
        const candidates = collectSourceLinkHealthCandidates(entity, signalSourceUrls);
        if (candidates.length === 0) continue;

        const now = new Date();
        const sourceLinkHealth: Array<{
          url: string;
          healthStatus: string;
          httpStatusCode?: number;
          checkedAt: Date;
        }> = [];
        for (const url of candidates) {
          let health = healthCache.get(url);
          if (!health) {
            health = await checkLink(url);
            healthCache.set(url, health);
            result.checked += 1;
          }
          result.byStatus[health.healthStatus] = (result.byStatus[health.healthStatus] ?? 0) + 1;
          sourceLinkHealth.push({
            url,
            healthStatus: health.healthStatus,
            ...(typeof health.httpStatusCode === 'number'
              ? { httpStatusCode: health.httpStatusCode }
              : {}),
            checkedAt: now,
          });
          if (result.samples.length < 25 && health.healthStatus !== 'HEALTHY') {
            result.samples.push({
              slug: String(entity.slug ?? ''),
              url,
              healthStatus: health.healthStatus,
              ...(typeof health.httpStatusCode === 'number'
                ? { httpStatusCode: health.httpStatusCode }
                : {}),
            });
          }
        }

        if (!options.dryRun) {
          await ResearchEntity.updateOne({ _id: entity._id }, { $set: { sourceLinkHealth } });
        }
        result.updated += 1;
      } catch (error) {
        result.errors += 1;
        console.error(
          `source-link-health backfill failed for ${String(entity.slug ?? entity._id)}:`,
          sanitizeLogValue(error),
        );
      }
    }
    if (options.limit && result.scanned >= options.limit) break;
    if (page.length < PAGE_SIZE) break;
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseSourceLinkHealthBackfillArgs(process.argv.slice(2));
  assertSourceLinkHealthApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfill:source-link-health',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const runOptions = sourceLinkHealthRunOptions(options);
    const result = await runSourceLinkHealthBackfill(runOptions);
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: runOptions,
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved source-link-health backfill report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
