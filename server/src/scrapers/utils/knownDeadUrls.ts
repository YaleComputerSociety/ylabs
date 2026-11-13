import { AsyncLocalStorage } from 'async_hooks';
import mongoose from 'mongoose';
import {
  SOURCE_LINK_HEALTH_FRESHNESS_DAYS,
  sourceLinkHealthKey,
} from '../../services/sourceLinkHealth';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import type { ScraperFetchMetrics, ScraperResult } from '../types';

const MILLISECONDS_PER_DAY = 86_400_000;
const RESOURCE_GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);
const COLLECTIONS_WITH_LINK_HEALTH = ['research_entities', 'fellowships'] as const;

export interface StoredLinkVerdict {
  url?: unknown;
  healthStatus?: unknown;
  httpStatusCode?: unknown;
  checkedAt?: unknown;
}

export interface KnownDeadUrlStats {
  known: number;
  learned: number;
  skipped: number;
  skippedByStoredVerdict: number;
  skippedAsRepeatInRun: number;
  loadFailed?: true;
}

interface KnownDeadUrlScope {
  goneStatusByKey: Map<string, number>;
  learnedKeys: Set<string>;
  stats: KnownDeadUrlStats;
}

const scopeStorage = new AsyncLocalStorage<KnownDeadUrlScope>();

/**
 * `sourceLinkHealthKey` plus the scheme. Only `www.` and a trailing slash are cosmetic here: a
 * plain-HTTP 404 must not skip the `https:` page, which a host often still serves.
 */
export function knownDeadUrlKey(url: unknown): string | null {
  const key = sourceLinkHealthKey(url);
  if (!key || typeof url !== 'string') return null;
  try {
    return `${new URL(url.trim()).protocol}//${key}`;
  } catch {
    return null;
  }
}

const checkedAtMs = (verdict: StoredLinkVerdict): number =>
  new Date(verdict.checkedAt as string | number | Date).getTime();

/**
 * The URLs a recent link-health probe found gone, keyed by `knownDeadUrlKey`.
 *
 * Only a 404 or 410 counts, the two answers that say the resource is gone. 401, 403, 429, 5xx,
 * timeouts and unresolvable hosts are recorded as UNKNOWN or carry no status, so none of them
 * ever reaches this map. A verdict older than `SOURCE_LINK_HEALTH_FRESHNESS_DAYS` means unknown,
 * not gone, and the newest verdict for a URL wins, so a page that came back is fetched again.
 */
export function goneStatusByUrlKey(
  verdicts: Iterable<StoredLinkVerdict>,
  nowMs: number = Date.now(),
): Map<string, number> {
  const horizonMs = nowMs - SOURCE_LINK_HEALTH_FRESHNESS_DAYS * MILLISECONDS_PER_DAY;
  const newest = new Map<string, { atMs: number; goneStatus?: number }>();
  for (const verdict of verdicts) {
    const key = knownDeadUrlKey(verdict.url);
    const atMs = checkedAtMs(verdict);
    if (!key || !Number.isFinite(atMs) || atMs < horizonMs) continue;
    const current = newest.get(key);
    if (current && current.atMs >= atMs) continue;
    const status = verdict.httpStatusCode;
    const gone =
      verdict.healthStatus === 'UNAVAILABLE' &&
      typeof status === 'number' &&
      RESOURCE_GONE_STATUSES.has(status);
    newest.set(key, { atMs, goneStatus: gone ? (status as number) : undefined });
  }
  const goneByKey = new Map<string, number>();
  for (const [key, { goneStatus }] of newest) {
    if (goneStatus !== undefined) goneByKey.set(key, goneStatus);
  }
  return goneByKey;
}

async function loadStoredLinkVerdicts(): Promise<StoredLinkVerdict[]> {
  const db = mongoose.connection.readyState === 1 ? mongoose.connection.db : undefined;
  if (!db) return [];
  const verdicts: StoredLinkVerdict[] = [];
  for (const name of COLLECTIONS_WITH_LINK_HEALTH) {
    const rows = await db
      .collection(name)
      .aggregate<StoredLinkVerdict>([
        { $match: { 'sourceLinkHealth.0': { $exists: true } } },
        { $unwind: '$sourceLinkHealth' },
        {
          $project: {
            _id: 0,
            url: '$sourceLinkHealth.url',
            healthStatus: '$sourceLinkHealth.healthStatus',
            httpStatusCode: '$sourceLinkHealth.httpStatusCode',
            checkedAt: '$sourceLinkHealth.checkedAt',
          },
        },
      ])
      .toArray();
    verdicts.push(...rows);
  }
  return verdicts;
}

/**
 * A scrape run that never requests a URL a recent link-health probe found gone (#6210).
 *
 * A dead citation answers the same 404 every time, and on Yale's Drupal department sites a
 * burst of 404s is what an auto-ban rule counts. Re-checking a dead URL is the link-health
 * lane's job alone, and that probe does not route through `fetchPageWithPolicy`.
 */
export async function withKnownDeadUrlScope<T>(
  run: () => Promise<T>,
  loadVerdicts: () => Promise<Iterable<StoredLinkVerdict>> = loadStoredLinkVerdicts,
): Promise<{ value: T; stats: KnownDeadUrlStats }> {
  let loadFailed = false;
  const goneStatusByKey = await loadVerdicts().then(
    (verdicts) => goneStatusByUrlKey(verdicts),
    (error: unknown) => {
      loadFailed = true;
      console.warn(
        `[known-dead-urls] stored link-health verdicts did not load, so this run skips nothing: ${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
      return new Map<string, number>();
    },
  );
  const stats: KnownDeadUrlStats = {
    known: goneStatusByKey.size,
    learned: 0,
    skipped: 0,
    skippedByStoredVerdict: 0,
    skippedAsRepeatInRun: 0,
    ...(loadFailed ? { loadFailed: true as const } : {}),
  };
  const value = await scopeStorage.run({ goneStatusByKey, learnedKeys: new Set(), stats }, run);
  return { value, stats };
}

export function knownDeadUrlStatus(url: string): number | undefined {
  const scope = scopeStorage.getStore();
  const key = scope ? knownDeadUrlKey(url) : null;
  return key ? scope?.goneStatusByKey.get(key) : undefined;
}

export function isKnownDeadUrl(url: string): boolean {
  return knownDeadUrlStatus(url) !== undefined;
}

export function recordKnownDeadUrlSkip(url: string): number | undefined {
  const status = knownDeadUrlStatus(url);
  const scope = scopeStorage.getStore();
  if (status === undefined || !scope) return status;
  scope.stats.skipped += 1;
  const key = knownDeadUrlKey(url);
  if (key && scope.learnedKeys.has(key)) scope.stats.skippedAsRepeatInRun += 1;
  else scope.stats.skippedByStoredVerdict += 1;
  return status;
}

/**
 * A URL this run already found gone is not asked again in the same run: the first 404 or 410
 * is the answer, and every later lane or row that cites it would only repeat the request.
 */
export function rememberGoneUrl(url: string, status: number): void {
  const scope = scopeStorage.getStore();
  const key = scope && RESOURCE_GONE_STATUSES.has(status) ? knownDeadUrlKey(url) : null;
  if (!scope || !key || scope.goneStatusByKey.has(key)) return;
  scope.goneStatusByKey.set(key, status);
  scope.learnedKeys.add(key);
  scope.stats.learned += 1;
}

export function withKnownDeadUrlFetchMetrics(
  result: ScraperResult,
  stats: KnownDeadUrlStats,
): ScraperResult {
  if (stats.skipped === 0 && !stats.loadFailed) return result;
  const fetchMetrics: ScraperFetchMetrics = result.fetchMetrics ?? {
    attempts: [],
    summary: {
      total: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      selectorBreakages: 0,
      averageLatencyMs: 0,
      byMode: {},
    },
  };
  return { ...result, fetchMetrics: { ...fetchMetrics, knownDeadUrlSkip: stats } };
}
