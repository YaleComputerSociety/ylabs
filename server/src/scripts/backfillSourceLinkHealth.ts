import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import { isOnExcludedHost, normalizeExcludedHost } from '../utils/excludedHosts';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { checkSourceLinkHealth, type SourceLinkHealth } from '../services/sourceLinkHealth';
import { recomputeBrowseRankForEntities } from '../services/researchEntityBrowseRankService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { activeHostPause, describeHostPauses, type HostPause } from '../scrapers/utils/hostPause';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  ResolverCircuitBreaker,
  ResolverUnhealthyError,
  type ResolverBreakerStats,
  type ResolverControlProbe,
} from '../scrapers/utils/resolverCircuitBreaker';
import { probeResolverControl } from '../scrapers/utils/resolverControlProbe';
import {
  HOST_THROTTLE_OVERRIDES,
  HostConcurrencyLimiter,
  type HostSlotLimiter,
  type HostThrottle,
} from '../scrapers/utils/hostConcurrencyLimiter';
import {
  carryForwardSourceLinkHealthEntry,
  collectSourceLinkHealthCandidates,
  planSourceLinkReprobe,
  resolveSourceLinkHealthEntry,
  tlsFallbackCandidates,
  httpsSpellingProbes,
  verifiedHttpsSpelling,
  storedSourceLinkHealthByUrl,
  isStoredUnresolvableVerdict,
  tallySourceLinkVerdictTransition,
  sourceLinkVerdictSignature,
  type SourceLinkVerdictTransitionSample,
  type StoredSourceLinkHealthEntry,
  needsRecheckSince,
  needsSourceLinkHealthRefresh,
  isUnreachedProbe,
} from './backfillSourceLinkHealthCore';
import {
  defaultSourceLinkProbeCachePath,
  readSourceLinkProbeCache,
  writeSourceLinkProbeCache,
  type CachedSourceLinkProbe,
} from './sourceLinkProbeCache';
import { installScraperFetchHooks } from '../scrapers/utils/scraperFetchHooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export interface SourceLinkHealthBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  staleOnly: boolean;
  httpWebsitesOnly: boolean;
  reprobeHealthyAfterDays?: number;
  checkedBefore?: Date;
  excludeHosts: string[];
  /** A file naming the only links this run probes, one per line, probed in file order. */
  urlFile?: string;
  /** Statuses that end probing of a host for the rest of the run; 403 and 429 by default. */
  stopOnStatuses: number[];
  /** Probe at most this many due links per host; a dry run defaults to a sample. */
  samplePerHost?: number;
  /** A dry run that sweeps every due link instead of sampling. */
  fullDryRun: boolean;
  /** How old a cached probe a dry run may reuse; a dry run defaults to 24 hours. */
  reuseProbesWithinHours?: number;
  noProbeReuse: boolean;
  output?: string;
}

/**
 * What the run prints. Both sample lists pair a row slug with a judgement about its
 * links, and stdout is routinely pasted into logs and reports, so they appear here as
 * counts only; the full lists go to the local `--output` file.
 */
export function sourceLinkHealthBackfillStdoutSummary(result: SourceLinkHealthBackfillResult): Omit<
  SourceLinkHealthBackfillResult,
  'samples' | 'lostVerdictSamples' | 'probesByHost' | 'stoppedHosts'
> & {
  sampleCount: number;
  lostVerdictSampleCount: number;
  hostsProbed: number;
  maxProbesOnOneHost: number;
  stoppedHostCount: number;
} {
  const { samples, lostVerdictSamples, probesByHost, stoppedHosts, ...counts } = result;
  const probeCounts = Object.values(probesByHost);
  return {
    ...counts,
    sampleCount: samples.length,
    lostVerdictSampleCount: lostVerdictSamples.length,
    hostsProbed: probeCounts.length,
    maxProbesOnOneHost: probeCounts.length > 0 ? Math.max(...probeCounts) : 0,
    stoppedHostCount: stoppedHosts.length,
  };
}

export function parseSourceLinkHealthBackfillArgs(argv: string[]): SourceLinkHealthBackfillOptions {
  const options: SourceLinkHealthBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
    staleOnly: false,
    httpWebsitesOnly: false,
    excludeHosts: [],
    stopOnStatuses: [...DEFAULT_STOP_ON_STATUSES],
    fullDryRun: false,
    noProbeReuse: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-source-link-health') options.confirm = true;
    else if (arg === '--stale-only') options.staleOnly = true;
    else if (arg === '--http-websites-only') options.httpWebsitesOnly = true;
    else if (arg.startsWith('--reprobe-healthy-after-days=')) {
      options.reprobeHealthyAfterDays = parsePositiveInt(
        arg.slice('--reprobe-healthy-after-days='.length),
        '--reprobe-healthy-after-days',
      );
    } else if (arg.startsWith('--checked-before=')) {
      options.checkedBefore = parseCheckedBefore(arg.slice('--checked-before='.length));
    } else if (arg === '--checked-before') {
      options.checkedBefore = parseCheckedBefore(argv[i + 1]);
      i += 1;
    } else if (arg === '--full-dry-run') {
      options.fullDryRun = true;
    } else if (arg === '--no-probe-reuse') {
      options.noProbeReuse = true;
    } else if (arg.startsWith('--reuse-probes-within-hours=')) {
      options.reuseProbesWithinHours = parsePositiveInt(
        arg.slice('--reuse-probes-within-hours='.length),
        '--reuse-probes-within-hours',
      );
    } else if (arg.startsWith('--sample-per-host=')) {
      options.samplePerHost = parsePositiveInt(
        arg.slice('--sample-per-host='.length),
        '--sample-per-host',
      );
    } else if (arg.startsWith('--url-file=')) {
      options.urlFile = arg.slice('--url-file='.length);
    } else if (arg === '--url-file') {
      options.urlFile = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--stop-on-status=')) {
      options.stopOnStatuses = parseStatusList(arg.slice('--stop-on-status='.length));
    } else if (arg === '--no-stop-on-refusal') {
      options.stopOnStatuses = [];
    } else if (arg.startsWith('--exclude-host=')) {
      options.excludeHosts.push(parseExcludedHost(arg.slice('--exclude-host='.length)));
    } else if (arg === '--exclude-host') {
      options.excludeHosts.push(parseExcludedHost(argv[i + 1]));
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
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
  if (options.fullDryRun && !options.dryRun) {
    throw new Error(
      '--full-dry-run applies to a dry run only; an apply always probes every due link.',
    );
  }
  if (options.samplePerHost !== undefined && !options.dryRun) {
    throw new Error('--sample-per-host applies to a dry run only.');
  }
  if (options.reuseProbesWithinHours !== undefined && !options.dryRun) {
    throw new Error(
      '--reuse-probes-within-hours applies to a dry run only; an apply always probes afresh.',
    );
  }
  if (options.reuseProbesWithinHours !== undefined && options.noProbeReuse) {
    throw new Error('--reuse-probes-within-hours and --no-probe-reuse are alternatives; pass one.');
  }
  if (options.staleOnly && options.reprobeHealthyAfterDays !== undefined) {
    throw new Error(
      '--stale-only and --reprobe-healthy-after-days are alternative scopes; pass one.',
    );
  }
  return options;
}

function parseStatusList(value: string): number[] {
  const statuses = value.split(',').map((part) => Number(part.trim()));
  if (
    statuses.length === 0 ||
    statuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)
  ) {
    throw new Error('--stop-on-status takes HTTP statuses such as 403,429');
  }
  return statuses;
}

/**
 * Reads a `--url-file`: one link per line, blank lines and `#` lines ignored, order kept so a
 * pass can put the links it must not lose first.
 */
export function readSourceLinkUrlFile(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')),
    ),
  ];
}

function parseExcludedHost(value: string | undefined): string {
  const host = normalizeExcludedHost(value ?? '');
  if (!host || host.startsWith('-') || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) {
    throw new Error('--exclude-host requires a host name such as economics.yale.edu');
  }
  return host;
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

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
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
  httpWebsitesOnly?: boolean;
  reprobeHealthyAfterDays?: number;
  checkedBefore?: Date;
  excludeHosts?: string[];
  urlScope?: string[];
  stopOnStatuses?: number[];
  samplePerHost?: number;
  reuseProbesWithinMs?: number;
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
    ...(options.httpWebsitesOnly ? { httpWebsitesOnly: true } : {}),
    ...(options.reprobeHealthyAfterDays !== undefined
      ? { reprobeHealthyAfterDays: options.reprobeHealthyAfterDays }
      : {}),
    ...(options.checkedBefore ? { checkedBefore: options.checkedBefore } : {}),
    ...(options.excludeHosts.length > 0
      ? { excludeHosts: [...new Set(options.excludeHosts)] }
      : {}),
    ...(options.stopOnStatuses.length > 0 ? { stopOnStatuses: options.stopOnStatuses } : {}),
    ...(options.dryRun && !options.fullDryRun
      ? { samplePerHost: options.samplePerHost ?? DEFAULT_DRY_RUN_SAMPLE_PER_HOST }
      : {}),
    ...(options.dryRun && !options.noProbeReuse
      ? {
          reuseProbesWithinMs:
            (options.reuseProbesWithinHours ?? DEFAULT_DRY_RUN_PROBE_REUSE_HOURS) * 60 * 60_000,
        }
      : {}),
  };
}

/**
 * How old a probe result a dry run reuses instead of requesting the link again. Previews are
 * re-run often while a pass is planned, and each one otherwise re-requests the same links (#6214).
 */
export const DEFAULT_DRY_RUN_PROBE_REUSE_HOURS = 24;

/**
 * A host that refuses one probe is not asked again in the same pass, and its unprobed links keep
 * their stored verdicts; the next pass tries it again (#6214). Probing on after a refusal only
 * spends the host's patience, which is how one pass lengthened a school site's rate limit (#6166).
 */
export const DEFAULT_STOP_ON_STATUSES: readonly number[] = [403, 429];

/**
 * How many due links per host a dry run probes by default. A dry run cannot change stored data,
 * so sweeping a whole host to preview an apply only spends that host's patience: four full dry
 * runs sent one school host about 3,200 requests in five hours (#6182).
 */
export const DEFAULT_DRY_RUN_SAMPLE_PER_HOST = 20;

export interface SourceLinkHealthBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  skippedFresh: number;
  skippedAlreadyRechecked: number;
  /**
   * Row citations whose `HEALTHY` verdict was inside `--reprobe-healthy-after-days`
   * and so were carried forward unprobed.
   */
  carriedFreshHealthy: number;
  /** Rows every one of whose citations was carried forward, so nothing was written. */
  unchangedRows: number;
  checked: number;
  updated: number;
  errors: number;
  /**
   * URLs not probed because their host was pausing this run's requests after refusing them;
   * each keeps its stored verdict and is probed again once the pause ends (#6166).
   */
  deferredPausedHost: number;
  /** Each host that paused this run, with when it resumes (#6166). */
  pausedHosts: string;
  /**
   * How many URLs kept a decisive stored verdict because the fresh probe was
   * inconclusive. A large number means the pass did not verify what `checked`
   * implies, usually because a host throttled it (#2762).
   */
  preservedDecisiveVerdicts: number;
  /**
   * How many URLs kept their whole stored verdict because the probe never reached the
   * host: a private or split-horizon refusal, a timeout or a reset.
   */
  preservedUnreachedVerdicts: number;
  /**
   * How many live verdicts a refused or unroutable connection did not retire because no
   * earlier run had seen it yet; the next run confirms or clears each one (#6116).
   */
  heldConnectionFailures: number;
  /** Stored verdict changes as `<before>-><after>`; a renewed `checkedAt` alone is not one. */
  verdictTransitions: Record<string, number>;
  /** Certificate-failure flags the pass would remove. */
  clearedTlsFlags: number;
  /** Websites of `student_ready` rows that stop being followable (gone, or a certificate failure). */
  servedWebsitesLost: number;
  /**
   * Candidate links on an `--exclude-host` host: never fetched, stored verdict carried
   * forward untouched.
   */
  excludedHostLinks: number;
  /** Candidate links left unprobed (sampled out, a stopped host, or a probe error): stored verdict kept. */
  keptUnobservedLinks: number;
  /**
   * Present when the run sampled: the per-host cap, and how many due links it probed of how many.
   * Every count in this result then describes the sample, and `projectedVerdictTransitions`
   * scales it to every due link.
   */
  dryRunSample?: { perHost: number; dueLinks: number; probedLinks: number; hostsCapped: number };
  /** `verdictTransitions` scaled per host to every due link; a projection, not a measurement. */
  projectedVerdictTransitions?: Record<string, number>;
  /** Links whose verdict came from a cached probe of an earlier run instead of a request. */
  probesReused: number;
  oldestReusedProbeAt?: string;
  /** Probes sent per host. Kept out of stdout because a host can be a personal domain. */
  probesByHost: Record<string, number>;
  /** Hosts whose probing stopped on a `--stop-on-status` status. */
  stoppedHosts: string[];
  /** Each lost or certificate-cleared verdict, for a gate to re-check by hand. */
  lostVerdictSamples: SourceLinkVerdictTransitionSample[];
  indexSyncFailures: number;
  indexSyncDeferred: number;
  /** What the resolver breaker did: control checks run, trips it avoided, trips. */
  resolver: ResolverBreakerStats;
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

export function measuredHostBudget(host: string): HostThrottle | undefined {
  if (!Object.hasOwn(HOST_THROTTLE_OVERRIDES, host)) return undefined;
  const { concurrency, minIntervalMs } = HOST_THROTTLE_OVERRIDES[host];
  return { concurrency, minIntervalMs };
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const stableUrlRank = (url: string): string => crypto.createHash('sha1').update(url).digest('hex');

/**
 * The order planned probes go out in. A `--url-file` keeps the file's order, so a pass that may
 * stop early on a refusal has already probed the links it must not lose. A sampled dry run orders
 * each host's links by a stable hash, so its sample is seeded and repeatable.
 */
export function orderPlannedProbes(
  urls: readonly string[],
  urlScopeOrder: ReadonlyMap<string, number> | undefined,
  sampled: boolean,
): string[] {
  const unique = [...new Set(urls)];
  if (urlScopeOrder) {
    return unique.sort((a, b) => (urlScopeOrder.get(a) ?? 0) - (urlScopeOrder.get(b) ?? 0));
  }
  if (sampled) return unique.sort((a, b) => stableUrlRank(a).localeCompare(stableUrlRank(b)));
  return unique;
}

/**
 * Scales each sampled host's transitions to every due link on that host. Transitions are counted
 * per row entry, so the scale is too: a link cited by several rows counts once per row on both
 * sides (#6214, which fixes #6200 scaling row entries by unique links). A host probed in full
 * scales by one, so an unsampled run's projection equals its measurement.
 */
export function projectSampledTransitions(
  transitionsByHost: ReadonlyMap<string, Record<string, number>>,
  dueByHost: ReadonlyMap<string, number>,
  observedDueByHost: ReadonlyMap<string, number>,
): Record<string, number> {
  const projected: Record<string, number> = {};
  for (const [host, tally] of transitionsByHost) {
    const observed = observedDueByHost.get(host) ?? 0;
    const scale = observed > 0 ? (dueByHost.get(host) ?? observed) / observed : 1;
    for (const [key, count] of Object.entries(tally)) {
      projected[key] = (projected[key] ?? 0) + count * scale;
    }
  }
  return Object.fromEntries(
    Object.entries(projected).map(([key, value]) => [key, Math.round(value)]),
  );
}

/**
 * The one resolver breaker wiring every link-health pass shares, so a pass cannot
 * be added that trips on distinct failures alone without the control probe (#4865).
 */
export function createSourceLinkResolverBreaker(options: {
  resolverBreaker?: ResolverCircuitBreaker;
  resolverControlProbe?: ResolverControlProbe;
  sleep: (ms: number) => Promise<void>;
}): ResolverCircuitBreaker {
  return (
    options.resolverBreaker ??
    new ResolverCircuitBreaker({
      controlProbe: options.resolverControlProbe ?? (() => probeResolverControl()),
      sleep: options.sleep,
    })
  );
}

export function noteStoredSourceLinkVerdicts(
  resolverBreaker: ResolverCircuitBreaker,
  storedSourceLinkHealth: unknown,
): void {
  for (const [url, stored] of storedSourceLinkHealthByUrl(storedSourceLinkHealth)) {
    resolverBreaker.noteStoredHostVerdict(hostOf(url), isStoredUnresolvableVerdict(stored));
  }
}

export function describeResolverBreakerStats(stats: ResolverBreakerStats): string {
  return `Resolver breaker: ${stats.controlChecks} control check(s), ${stats.tripsAvoided} trip(s) avoided, ${stats.trips} trip(s), ${stats.knownUnresolvableFailuresIgnored} failure(s) on hosts already stored as unresolvable not counted.`;
}

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
 *
 * A host with a measured budget (`hostThrottleFor`) is the one exception to serial:
 * it gets that budget's requests in flight, and every request, a probe's GET fallback
 * and retries included, takes a slot spaced by the larger of the pace and the budget's
 * interval. `medicine.yale.edu` holds 3,529 of the 9,052 URLs a
 * Development pass probes, at about 2 s a probe, so one-at-a-time on that host alone
 * was most of the 110-minute stage (#3568).
 */
export async function probeUncachedUrlsByHost(
  urls: readonly string[],
  healthCache: Map<string, SourceLinkHealth>,
  deps: {
    checkLink: (url: string, requestGate?: HostSlotLimiter) => Promise<SourceLinkHealth>;
    hostConcurrency: number;
    paceDelayMs: number;
    sleep: (ms: number) => Promise<void>;
    result: { checked: number; errors: number; deferredPausedHost?: number };
    /** Collects each pause met, for the run's `pausedHosts` report. */
    pausesSeen?: HostPause[];
    /**
     * Halts the pass when our own resolver, rather than the corpus, is what is
     * failing. Omit only in tests that are not exercising that path (#2782).
     */
    resolverBreaker?: ResolverCircuitBreaker;
    hostThrottleFor?: (host: string) => HostThrottle | undefined;
    /**
     * The most probes this run may send one host, across every call that shares
     * `probesByHost`. A dry run sets it so repeated dry runs cannot sweep a whole host (#6182).
     */
    maxProbesPerHost?: number;
    /** Probes sent so far, by host; shared across calls so the cap covers fallbacks too. */
    probesByHost?: Map<string, number>;
    /** A status that ends this run's probing of a host, for example a 403 or 429. */
    stopOnStatuses?: ReadonlySet<number>;
    /** Hosts this run has stopped probing; shared across calls. */
    stoppedHosts?: Set<string>;
  },
): Promise<void> {
  const probesByHost = deps.probesByHost ?? new Map<string, number>();
  const stoppedHosts = deps.stoppedHosts ?? new Set<string>();
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

  const probe = async (url: string, requestGate?: HostSlotLimiter): Promise<void> => {
    const host = hostOf(url);
    if (stoppedHosts.has(host)) return;
    const knownPause = activeHostPause(host);
    if (knownPause) {
      deps.result.deferredPausedHost = (deps.result.deferredPausedHost ?? 0) + 1;
      deps.pausesSeen?.push(knownPause);
      return;
    }
    const sent = probesByHost.get(host) ?? 0;
    if (deps.maxProbesPerHost !== undefined && sent >= deps.maxProbesPerHost) return;
    probesByHost.set(host, sent + 1);
    try {
      const health = await deps.checkLink(url, requestGate);
      const pauseFound = activeHostPause(hostOf(url));
      if (pauseFound && (health.excludedHost || health.httpStatusCode !== undefined)) {
        deps.result.deferredPausedHost = (deps.result.deferredPausedHost ?? 0) + 1;
        deps.pausesSeen?.push(pauseFound);
        return;
      }
      healthCache.set(url, health);
      deps.result.checked += 1;
      if (
        typeof health.httpStatusCode === 'number' &&
        deps.stopOnStatuses?.has(health.httpStatusCode)
      ) {
        stoppedHosts.add(host);
      }
      // A verdict of UNAVAILABLE carrying no HTTP status is the shape a
      // resolution failure takes, and it is the only shape #2775 mis-recorded.
      if (health.healthStatus === 'UNAVAILABLE' && health.httpStatusCode === undefined) {
        deps.resolverBreaker?.recordFailure(hostOf(url));
      } else {
        deps.resolverBreaker?.recordSuccess(hostOf(url));
      }
      await deps.resolverBreaker?.settle();
    } catch (error) {
      if (error instanceof ResolverUnhealthyError) throw error;
      deps.result.errors += 1;
      console.error('source-link-health probe failed:', sanitizeLogValue(error));
    }
  };

  const probeSerially = async (bucket: string[]): Promise<void> => {
    for (const [index, url] of bucket.entries()) {
      // Stop before the next probe rather than after it, so a tripped breaker
      // cannot record one more death on its way out.
      await deps.resolverBreaker?.settle();
      if (index > 0 && deps.paceDelayMs > 0) await deps.sleep(deps.paceDelayMs);
      await probe(url);
    }
  };

  const probeWithinBudget = async (bucket: string[], budget: HostThrottle): Promise<void> => {
    const requestGate = new HostConcurrencyLimiter(budget.concurrency, {
      minIntervalMs: Math.max(deps.paceDelayMs, budget.minIntervalMs),
      sleep: deps.sleep,
    });
    let next = 0;
    const lane = async (): Promise<void> => {
      while (next < bucket.length) {
        const url = bucket[next];
        next += 1;
        await deps.resolverBreaker?.settle();
        await probe(url, requestGate);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(Math.floor(budget.concurrency), bucket.length) }, lane),
    );
  };

  const buckets = [...byHost.entries()];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < buckets.length) {
      const [host, bucket] = buckets[cursor];
      cursor += 1;
      const budget = deps.hostThrottleFor?.(host);
      if (budget) await probeWithinBudget(bucket, budget);
      else await probeSerially(bucket);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(deps.hostConcurrency, buckets.length)) }, worker),
  );
}

const HTTP_WEBSITE_FILTER = {
  $or: [{ websiteUrl: /^http:\/\//i }, { website: /^http:\/\//i }],
};

export async function runSourceLinkHealthBackfill(options: {
  dryRun: boolean;
  limit?: number;
  staleOnly?: boolean;
  httpWebsitesOnly?: boolean;
  reprobeHealthyAfterDays?: number;
  checkedBefore?: Date;
  excludeHosts?: string[];
  urlScope?: string[];
  stopOnStatuses?: number[];
  samplePerHost?: number;
  reuseProbesWithinMs?: number;
  probeCacheFile?: string;
  checkLink?: (url: string, requestGate?: HostSlotLimiter) => Promise<SourceLinkHealth>;
  /**
   * Page size, overridable only so a test can cross a page boundary without seeding
   * a full page of rows. Not a CLI flag: an operator has no reason to tune it.
   */
  pageSize?: number;
  hostConcurrency?: number;
  paceDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  resolverBreaker?: ResolverCircuitBreaker;
  resolverControlProbe?: ResolverControlProbe;
  hostThrottleFor?: (host: string) => HostThrottle | undefined;
}): Promise<SourceLinkHealthBackfillResult> {
  const excludeHosts = (options.excludeHosts ?? []).map(normalizeExcludedHost).filter(Boolean);
  const urlScopeOrder = options.urlScope
    ? new Map(options.urlScope.map((url, index) => [url, index] as const))
    : undefined;
  const stopOnStatuses = new Set(options.stopOnStatuses ?? []);
  const probesByHost = new Map<string, number>();
  const stoppedHosts = new Set<string>();
  const dueByHost = new Map<string, number>();
  const dueEntriesByHost = new Map<string, number>();
  const observedEntriesByHost = new Map<string, number>();
  const observedDueUrls = new Set<string>();
  const transitionsByHost = new Map<string, Record<string, number>>();
  const probeLimits = {
    probesByHost,
    stoppedHosts,
    ...(stopOnStatuses.size > 0 ? { stopOnStatuses } : {}),
    ...(options.samplePerHost !== undefined ? { maxProbesPerHost: options.samplePerHost } : {}),
  };
  const probeLink =
    options.checkLink ??
    ((url: string, requestGate?: HostSlotLimiter) =>
      checkSourceLinkHealth(url, requestGate, { excludedHosts: excludeHosts }));
  if (!options.dryRun && options.reuseProbesWithinMs) {
    throw new Error(
      'An apply never reuses cached probes; every stored verdict needs a fresh probe.',
    );
  }
  const probeCache =
    options.probeCacheFile && options.dryRun && options.reuseProbesWithinMs
      ? readSourceLinkProbeCache(options.probeCacheFile)
      : new Map<string, CachedSourceLinkProbe>();
  const freshProbes = new Map<string, CachedSourceLinkProbe>();
  let probeCacheWriteFailed = false;
  const probedAtByUrl = new Map<string, Date>();
  const checkLink = async (url: string, requestGate?: HostSlotLimiter) => {
    const health = await probeLink(url, requestGate);
    const probedAt = new Date();
    probedAtByUrl.set(url, probedAt);
    if (!health.excludedHost && !isUnreachedProbe(health)) {
      freshProbes.set(url, { health, probedAt: probedAt.toISOString() });
    }
    return health;
  };
  const hostConcurrency = options.hostConcurrency ?? DEFAULT_SOURCE_LINK_HEALTH_HOST_CONCURRENCY;
  const paceDelayMs = options.paceDelayMs ?? DEFAULT_SOURCE_LINK_HEALTH_PACE_DELAY_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const resolverBreaker = createSourceLinkResolverBreaker({
    resolverBreaker: options.resolverBreaker,
    resolverControlProbe: options.resolverControlProbe,
    sleep,
  });

  const pausesSeen: HostPause[] = [];
  const result: SourceLinkHealthBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    skippedFresh: 0,
    skippedAlreadyRechecked: 0,
    deferredPausedHost: 0,
    pausedHosts: '',
    carriedFreshHealthy: 0,
    unchangedRows: 0,
    checked: 0,
    updated: 0,
    errors: 0,
    preservedDecisiveVerdicts: 0,
    preservedUnreachedVerdicts: 0,
    heldConnectionFailures: 0,
    verdictTransitions: {},
    clearedTlsFlags: 0,
    servedWebsitesLost: 0,
    lostVerdictSamples: [],
    excludedHostLinks: 0,
    keptUnobservedLinks: 0,
    probesReused: 0,
    probesByHost: {},
    stoppedHosts: [],
    indexSyncFailures: 0,
    indexSyncDeferred: 0,
    resolver: resolverBreaker.stats,
    byStatus: {},
    samples: [],
  };

  const healthCache = new Map<string, SourceLinkHealth>();
  const runStartedAt = new Date();
  const reuseCachedProbes = (urls: Iterable<string>): void => {
    if (probeCache.size === 0 || !options.reuseProbesWithinMs) return;
    for (const url of urls) {
      if (healthCache.has(url)) continue;
      const cached = probeCache.get(url);
      if (!cached) continue;
      const probedAt = new Date(cached.probedAt);
      const age = runStartedAt.getTime() - probedAt.getTime();
      if (age < 0 || age > options.reuseProbesWithinMs) continue;
      healthCache.set(url, cached.health);
      probedAtByUrl.set(url, probedAt);
      result.probesReused += 1;
      if (!result.oldestReusedProbeAt || cached.probedAt < result.oldestReusedProbeAt) {
        result.oldestReusedProbeAt = cached.probedAt;
      }
    }
  };

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
        ...(options.httpWebsitesOnly ? HTTP_WEBSITE_FILTER : {}),
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
        fieldValueRefusals: 1,
        sourceLinkHealth: 1,
        studentVisibilityTier: 1,
      },
    )
      .sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .lean()) as unknown as Array<Record<string, unknown>>;
    if (page.length === 0) break;
    lastSeenId = page[page.length - 1]._id;

    // Phase 1, no network: decide which entities are in scope and what each one
    // needs probed.
    const plans: Array<{
      entity: Record<string, unknown>;
      candidates: string[];
      toProbe: string[];
      carried: Map<string, StoredSourceLinkHealthEntry>;
      excluded: Set<string>;
      tlsFallbacks: string[];
      httpsSpellings: Map<string, string>;
    }> = [];
    const planNow = new Date();
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
          researchEntityId: entity._id as mongoose.Types.ObjectId,
          type: { $in: accessSignalTypes },
          archived: false,
        })
          .select('sourceUrl')
          .lean();
        const signalSourceUrls = (signalRows as Array<{ sourceUrl?: unknown }>).map(
          (row) => row.sourceUrl,
        );
        const candidates = collectSourceLinkHealthCandidates(entity, signalSourceUrls);
        if (urlScopeOrder && !candidates.some((url) => urlScopeOrder.has(url))) continue;
        if (candidates.length === 0) continue;
        const { toProbe, carried } =
          options.reprobeHealthyAfterDays === undefined
            ? { toProbe: candidates, carried: new Map<string, StoredSourceLinkHealthEntry>() }
            : planSourceLinkReprobe(
                candidates,
                entity.sourceLinkHealth,
                options.reprobeHealthyAfterDays,
                planNow,
              );
        noteStoredSourceLinkVerdicts(resolverBreaker, entity.sourceLinkHealth);
        const excluded = new Set(
          candidates.filter((url) => {
            const pause = activeHostPause(hostOf(url));
            if (pause) pausesSeen.push(pause);
            return isOnExcludedHost(url, excludeHosts) || pause !== undefined;
          }),
        );
        if (excluded.size > 0) {
          const storedByUrl = storedSourceLinkHealthByUrl(entity.sourceLinkHealth);
          for (const url of excluded) {
            const stored = storedByUrl.get(url);
            if (stored) carried.set(url, stored);
          }
          result.excludedHostLinks += excluded.size;
        }
        plans.push({
          entity,
          candidates,
          toProbe: toProbe.filter((url) => !excluded.has(url)),
          carried,
          excluded,
          tlsFallbacks: [],
          httpsSpellings: new Map(),
        });
      } catch (error) {
        result.errors += 1;
        console.error(
          `source-link-health backfill failed for ${String(entity.slug ?? entity._id)}:`,
          sanitizeLogValue(error),
        );
      }
    }

    const inScope = (url: string): boolean => !urlScopeOrder || urlScopeOrder.has(url);
    const plannedProbes = orderPlannedProbes(
      plans.flatMap((plan) => plan.toProbe).filter(inScope),
      urlScopeOrder,
      options.samplePerHost !== undefined,
    );
    const plannedProbeSet = new Set(plannedProbes);
    for (const url of plannedProbeSet) {
      if (healthCache.has(url)) continue;
      const host = hostOf(url);
      dueByHost.set(host, (dueByHost.get(host) ?? 0) + 1);
    }
    for (const url of plans.flatMap((plan) => plan.toProbe).filter(inScope)) {
      if (healthCache.has(url)) continue;
      const host = hostOf(url);
      dueEntriesByHost.set(host, (dueEntriesByHost.get(host) ?? 0) + 1);
    }
    reuseCachedProbes(plannedProbes);
    await probeUncachedUrlsByHost(plannedProbes, healthCache, {
      checkLink,
      hostConcurrency,
      paceDelayMs,
      sleep,
      result,
      pausesSeen,
      resolverBreaker,
      hostThrottleFor: options.hostThrottleFor ?? measuredHostBudget,
      ...probeLimits,
    });

    for (const plan of plans) {
      plan.tlsFallbacks = tlsFallbackCandidates(plan.candidates.filter(inScope), healthCache);
      plan.httpsSpellings = httpsSpellingProbes(
        [plan.entity.websiteUrl, plan.entity.website].filter(
          (url) => typeof url !== 'string' || inScope(url),
        ),
        healthCache,
      );
    }
    const followUpProbes = [
      ...new Set(plans.flatMap((plan) => [...plan.tlsFallbacks, ...plan.httpsSpellings.values()])),
    ].filter((url) => !isOnExcludedHost(url, excludeHosts));
    reuseCachedProbes(followUpProbes);
    await probeUncachedUrlsByHost(followUpProbes, healthCache, {
      checkLink,
      hostConcurrency,
      paceDelayMs,
      sleep,
      result,
      pausesSeen,
      resolverBreaker,
      hostThrottleFor: options.hostThrottleFor ?? measuredHostBudget,
      ...probeLimits,
    });

    // Phase 3, no network: every verdict is cached, so assembling and writing a
    // row cannot pace anything.
    for (const {
      entity,
      candidates: planned,
      carried,
      excluded,
      tlsFallbacks,
      httpsSpellings,
    } of plans) {
      const candidates = [...planned, ...tlsFallbacks];
      try {
        const storedByUrl = storedSourceLinkHealthByUrl(entity.sourceLinkHealth);
        const sourceLinkHealth: StoredSourceLinkHealthEntry[] = [];
        let probedEntries = 0;
        for (const url of candidates) {
          const probedHealth = healthCache.get(url);
          const httpsSpellingUrl = verifiedHttpsSpelling(httpsSpellings.get(url), healthCache);
          const health =
            probedHealth && httpsSpellingUrl ? { ...probedHealth, httpsSpellingUrl } : probedHealth;
          const carriedEntry = carried.get(url);
          if (health?.excludedHost) {
            result.excludedHostLinks += 1;
            const stored = storedByUrl.get(url);
            if (stored) sourceLinkHealth.push(carryForwardSourceLinkHealthEntry(url, stored));
            continue;
          }
          if (!health && carriedEntry) {
            if (!excluded.has(url)) result.carriedFreshHealthy += 1;
            result.byStatus[carriedEntry.healthStatus] =
              (result.byStatus[carriedEntry.healthStatus] ?? 0) + 1;
            sourceLinkHealth.push(carryForwardSourceLinkHealthEntry(url, carriedEntry));
            continue;
          }
          if (!health) {
            const stored = storedByUrl.get(url);
            if (stored) {
              sourceLinkHealth.push(carryForwardSourceLinkHealthEntry(url, stored));
              result.keptUnobservedLinks += 1;
            }
            continue;
          }
          probedEntries += 1;
          const urlHost = hostOf(url);
          if (plannedProbeSet.has(url)) {
            observedEntriesByHost.set(urlHost, (observedEntriesByHost.get(urlHost) ?? 0) + 1);
            observedDueUrls.add(url);
          }
          const resolved = resolveSourceLinkHealthEntry(
            url,
            health,
            storedByUrl.get(url),
            probedAtByUrl.get(url) ?? new Date(),
            runStartedAt,
          );
          if (resolved.preservedDecisiveVerdict) result.preservedDecisiveVerdicts += 1;
          if (resolved.preservedUnreachedVerdict) result.preservedUnreachedVerdicts += 1;
          if (resolved.heldConnectionFailure) result.heldConnectionFailures += 1;
          const verdictBefore = sourceLinkVerdictSignature(storedByUrl.get(url));
          const verdictAfter = sourceLinkVerdictSignature(resolved.entry);
          if (verdictBefore !== verdictAfter) {
            const hostTally = transitionsByHost.get(urlHost) ?? {};
            const key = `${verdictBefore}->${verdictAfter}`;
            hostTally[key] = (hostTally[key] ?? 0) + 1;
            transitionsByHost.set(urlHost, hostTally);
          }
          tallySourceLinkVerdictTransition(
            result,
            storedByUrl.get(url),
            resolved.entry,
            entity.studentVisibilityTier === 'student_ready' &&
              (url === entity.websiteUrl || url === entity.website),
            String(entity.slug ?? ''),
          );
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
        const storedCount = Array.isArray(entity.sourceLinkHealth)
          ? entity.sourceLinkHealth.length
          : 0;
        if (probedEntries === 0 && sourceLinkHealth.length === storedCount) {
          result.unchangedRows += 1;
          continue;
        }

        if (!options.dryRun) {
          await ResearchEntity.updateOne({ _id: entity._id }, { $set: { sourceLinkHealth } });
          const browseRank = await recomputeBrowseRankForEntities([entity._id]);
          result.indexSyncFailures += browseRank.indexSyncFailures;
          result.indexSyncDeferred += browseRank.indexSyncDeferred ?? 0;
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
    if (options.probeCacheFile && !probeCacheWriteFailed) {
      try {
        writeSourceLinkProbeCache(options.probeCacheFile, freshProbes);
      } catch (error) {
        probeCacheWriteFailed = true;
        console.warn(
          'source-link-health: the probe cache could not be written, so this run continues without it:',
          sanitizeLogValue(error),
        );
      }
      freshProbes.clear();
    }
    if (options.limit && result.scanned >= options.limit) break;
    if (page.length < PAGE_SIZE) break;
  }
  result.resolver = resolverBreaker.stats;
  result.probesByHost = Object.fromEntries([...probesByHost].sort());
  result.stoppedHosts = [...stoppedHosts].sort();
  if (options.samplePerHost !== undefined) {
    const dueLinks = [...dueByHost.values()].reduce((sum, count) => sum + count, 0);
    const probedLinks = observedDueUrls.size;
    result.dryRunSample = {
      perHost: options.samplePerHost,
      dueLinks,
      probedLinks,
      hostsCapped: [...dueByHost.values()].filter((count) => count > options.samplePerHost!).length,
    };
    result.projectedVerdictTransitions = projectSampledTransitions(
      transitionsByHost,
      dueEntriesByHost,
      observedEntriesByHost,
    );
  }
  result.pausedHosts = describeHostPauses(pausesSeen);
  return result;
}

async function main(): Promise<void> {
  installScraperFetchHooks({ validatorCache: false });
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
    const runOptions = {
      ...sourceLinkHealthRunOptions(options),
      probeCacheFile: defaultSourceLinkProbeCachePath(),
      ...(options.urlFile
        ? {
            urlScope: readSourceLinkUrlFile(fs.readFileSync(path.resolve(options.urlFile), 'utf8')),
          }
        : {}),
    };
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
    console.log(JSON.stringify(sourceLinkHealthBackfillStdoutSummary(result), null, 2));
    console.log(describeResolverBreakerStats(result.resolver));
    if (result.indexSyncDeferred > 0) {
      console.log(
        `${result.indexSyncDeferred} updated row(s) were not resynced: index writes are deferred by SEARCH_INDEX_WRITES=deferred; re-sync the index from a checkout that reaches it (docs/data-refresh-runbook.md)`,
      );
    }
    if (result.indexSyncFailures > 0) {
      console.error(
        `${result.indexSyncFailures} updated row(s) were not resynced to Meilisearch, so browse still serves their old order; rebuild the index or rerun.`,
      );
      process.exitCode = 1;
    }
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
