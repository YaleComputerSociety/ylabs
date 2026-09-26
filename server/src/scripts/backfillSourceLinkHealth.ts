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
  ResolverCircuitBreaker,
  ResolverUnhealthyError,
} from '../scrapers/utils/resolverCircuitBreaker';
import {
  collectSourceLinkHealthCandidates,
  resolveSourceLinkHealthEntry,
  storedSourceLinkHealthByUrl,
  type StoredSourceLinkHealthEntry,
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
  /**
   * How many URLs kept a decisive stored verdict because the fresh probe was
   * inconclusive. A large number means the pass did not verify what `checked`
   * implies, usually because a host throttled it (#2762).
   */
  preservedDecisiveVerdicts: number;
  byStatus: Record<string, number>;
  samples: Array<{
    slug: string;
    url: string;
    healthStatus: string;
    httpStatusCode?: number;
  }>;
}

export const DEFAULT_SOURCE_LINK_HEALTH_HOST_CONCURRENCY = 4;
export const DEFAULT_SOURCE_LINK_HEALTH_PACE_DELAY_MS = 250;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Probes every not-yet-cached URL, serially within a host and in parallel only
 * ACROSS hosts, mirroring `verifyOfficialProfileLinks` (#2292).
 *
 * Without this the walk probed in entity order, so consecutive rows from one
 * department hit that department's host back to back for the whole run and the run
 * rate-limited itself. Measured on Development: a full pass produced 389 `UNKNOWN`
 * verdicts against 131 stored, dominated by `403` on one host, and five of those
 * `403` URLs each returned `200` when re-probed individually two seconds apart. So
 * roughly 400 verdicts were degrading on request pattern alone, and `UNAVAILABLE`
 * fell 206 to 66, which would have un-suppressed genuinely dead links now that
 * #2638 holds a card whose every citation is a known 404 (#2664).
 *
 * Pacing counts REQUESTS, not candidates: an already-cached URL costs nothing and
 * must not consume a host's delay.
 */
export async function probeUncachedUrlsByHost(
  urls: readonly string[],
  healthCache: Map<string, SourceLinkHealth>,
  deps: {
    checkLink: (url: string) => Promise<SourceLinkHealth>;
    hostConcurrency: number;
    paceDelayMs: number;
    sleep: (ms: number) => Promise<void>;
    result: { checked: number; errors: number };
    /**
     * Halts the pass when our own resolver, rather than the corpus, is what is
     * failing. Omit only in tests that are not exercising that path (#2782).
     */
    resolverBreaker?: ResolverCircuitBreaker;
  },
): Promise<void> {
  const byHost = new Map<string, string[]>();
  const queued = new Set<string>();
  for (const url of urls) {
    if (healthCache.has(url) || queued.has(url)) continue;
    queued.add(url);
    const host = hostOf(url);
    const bucket = byHost.get(host);
    if (bucket) bucket.push(url);
    else byHost.set(host, [url]);
  }
  if (byHost.size === 0) return;

  const buckets = [...byHost.values()];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < buckets.length) {
      const bucket = buckets[cursor];
      cursor += 1;
      for (const [index, url] of bucket.entries()) {
        // Stop before the next probe rather than after it, so a tripped breaker
        // cannot record one more death on its way out.
        deps.resolverBreaker?.assertHealthy();
        if (index > 0 && deps.paceDelayMs > 0) await deps.sleep(deps.paceDelayMs);
        try {
          const health = await deps.checkLink(url);
          healthCache.set(url, health);
          deps.result.checked += 1;
          // A verdict of UNAVAILABLE carrying no HTTP status is the shape a
          // resolution failure takes, and it is the only shape #2775 mis-recorded.
          if (health.healthStatus === 'UNAVAILABLE' && health.httpStatusCode === undefined) {
            deps.resolverBreaker?.recordFailure(hostOf(url));
          } else {
            deps.resolverBreaker?.recordSuccess(hostOf(url));
          }
        } catch (error) {
          if (error instanceof ResolverUnhealthyError) throw error;
          deps.result.errors += 1;
          console.error('source-link-health probe failed:', sanitizeLogValue(error));
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(deps.hostConcurrency, buckets.length)) }, worker),
  );
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
  hostConcurrency?: number;
  paceDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  resolverBreaker?: ResolverCircuitBreaker;
}): Promise<SourceLinkHealthBackfillResult> {
  const checkLink = options.checkLink ?? checkSourceLinkHealth;
  const resolverBreaker = options.resolverBreaker ?? new ResolverCircuitBreaker();
  const hostConcurrency = options.hostConcurrency ?? DEFAULT_SOURCE_LINK_HEALTH_HOST_CONCURRENCY;
  const paceDelayMs = options.paceDelayMs ?? DEFAULT_SOURCE_LINK_HEALTH_PACE_DELAY_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  const result: SourceLinkHealthBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    skippedFresh: 0,
    skippedAlreadyRechecked: 0,
    checked: 0,
    updated: 0,
    errors: 0,
    preservedDecisiveVerdicts: 0,
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
      {
        _id: 1,
        slug: 1,
        websiteUrl: 1,
        website: 1,
        sourceUrls: 1,
        // Projected because it carries citations the gate judges (#2666); omitting it
        // would leave the widened candidate set silently inert.
        fieldProvenance: 1,
        sourceLinkHealth: 1,
      },
    )
      .sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .lean()) as unknown as Array<Record<string, unknown>>;
    if (page.length === 0) break;
    lastSeenId = page[page.length - 1]._id;

    // Phase 1, no network: decide which entities are in scope and what each one
    // needs probed.
    const plans: Array<{ entity: Record<string, unknown>; candidates: string[] }> = [];
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
        plans.push({ entity, candidates });
      } catch (error) {
        result.errors += 1;
        console.error(
          `source-link-health backfill failed for ${String(entity.slug ?? entity._id)}:`,
          sanitizeLogValue(error),
        );
      }
    }

    await probeUncachedUrlsByHost(
      plans.flatMap((plan) => plan.candidates),
      healthCache,
      { checkLink, hostConcurrency, paceDelayMs, sleep, result, resolverBreaker },
    );

    // Phase 3, no network: every verdict is cached, so assembling and writing a
    // row cannot pace anything.
    for (const { entity, candidates } of plans) {
      try {
        const now = new Date();
        const storedByUrl = storedSourceLinkHealthByUrl(entity.sourceLinkHealth);
        const sourceLinkHealth: StoredSourceLinkHealthEntry[] = [];
        for (const url of candidates) {
          const health = healthCache.get(url);
          if (!health) continue;
          const resolved = resolveSourceLinkHealthEntry(url, health, storedByUrl.get(url), now);
          if (resolved.preservedDecisiveVerdict) result.preservedDecisiveVerdicts += 1;
          // Tally what is STORED, not what the probe returned, or the report claims
          // to have written verdicts the run deliberately declined to write (#2762).
          result.byStatus[resolved.entry.healthStatus] =
            (result.byStatus[resolved.entry.healthStatus] ?? 0) + 1;
          sourceLinkHealth.push(resolved.entry);
          if (result.samples.length < 25 && resolved.entry.healthStatus !== 'HEALTHY') {
            result.samples.push({
              slug: String(entity.slug ?? ''),
              url,
              healthStatus: resolved.entry.healthStatus,
              ...(typeof resolved.entry.httpStatusCode === 'number'
                ? { httpStatusCode: resolved.entry.httpStatusCode }
                : {}),
            });
          }
        }
        if (sourceLinkHealth.length === 0) continue;

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
