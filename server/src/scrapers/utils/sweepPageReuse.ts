// The reuse store must never be persisted to Mongo: a full sweep writing its fetches to
// `scrape_snapshots` filled the Development quota (#3536). It lives in the sweep broker
// process and dies with it (#3568).
import { AsyncLocalStorage } from 'async_hooks';
import net from 'net';
import { promisify } from 'util';
import zlib from 'zlib';
import axios, {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type AxiosResponseTransformer,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ScraperFetchMetrics, ScraperResult } from '../types';
import { lineReader, writeLine } from './brokerWire';
import { HOST_THROTTLE_OVERRIDES } from './hostConcurrencyLimiter';
import { SCRAPER_HOST_SLOT_BROKER_ENV } from './hostSlotBroker';
import {
  CALLER_OWNED_REQUEST_HEADERS,
  TEXTUAL_RESPONSE_TYPES,
  isTextualContentType,
  plainHeaders,
  responseFinalUrl,
} from './httpValidatorCache';
import { SWEEP_PAGE_REUSE_HIT_KEY, isSweepPageReuseHit } from './sweepPageReuseHit';
import type { SweepPageBrokerMessage, SweepPageRecord } from './sweepPageStore';

export const SCRAPER_SWEEP_PAGE_REUSE_ENV = 'SCRAPER_SWEEP_PAGE_REUSE';
export const SCRAPER_SWEEP_PAGE_REUSE_MAX_MB_ENV = 'SCRAPER_SWEEP_PAGE_REUSE_MAX_MB';
export const SWEEP_PAGE_REUSE_RESPONSE_HEADER = 'x-ylabs-sweep-reused-fetched-at';

const MEBIBYTE = 1024 * 1024;
export const DEFAULT_SWEEP_PAGE_REUSE_MAX_BYTES = 1024 * MEBIBYTE;
export const SWEEP_PAGE_REUSE_MAX_PAGE_BYTES = 8 * MEBIBYTE;
export const SWEEP_PAGE_REUSE_LOOKUP_TIMEOUT_MS = 5_000;

export const SWEEP_PAGE_REUSE_HOSTS: readonly string[] = Object.keys(HOST_THROTTLE_OVERRIDES);

const PERMANENT_REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 308]);

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export function resolveSweepPageReuseMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env[SCRAPER_SWEEP_PAGE_REUSE_MAX_MB_ENV]);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed * MEBIBYTE)
    : DEFAULT_SWEEP_PAGE_REUSE_MAX_BYTES;
}

export function sweepPageReuseKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function keyHost(key: string): string {
  return new URL(key).hostname.toLowerCase();
}

export interface SweepPageReuseStats {
  lookups: number;
  reused: number;
  bytesReused: number;
  offered: number;
}

export const emptySweepPageReuseStats = (): SweepPageReuseStats => ({
  lookups: 0,
  reused: 0,
  bytesReused: 0,
  offered: 0,
});

const statsStorage = new AsyncLocalStorage<SweepPageReuseStats>();
const readStorage = new AsyncLocalStorage<{ pagesReused: number }>();
const bypassStorage = new AsyncLocalStorage<true>();

export async function withSweepPageReuseScope<T>(
  run: () => Promise<T>,
): Promise<{ value: T; stats: SweepPageReuseStats }> {
  const stats = emptySweepPageReuseStats();
  const value = await statsStorage.run(stats, run);
  return { value, stats };
}

export async function observeSweepPageReuse<T>(
  run: () => Promise<T>,
): Promise<{ value: T; pagesReused: number }> {
  const observed = { pagesReused: 0 };
  const value = await readStorage.run(observed, run);
  return { value, pagesReused: observed.pagesReused };
}

export function withoutSweepPageReuse<T>(run: () => Promise<T>): Promise<T> {
  return bypassStorage.run(true, run);
}

export function withSweepPageReuseFetchMetrics(
  result: ScraperResult,
  stats: SweepPageReuseStats,
): ScraperResult {
  if (stats.lookups === 0 && stats.offered === 0) return result;
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
  return { ...result, fetchMetrics: { ...fetchMetrics, sweepPageReuse: stats } };
}

export interface SweepPageSource {
  lookup(key: string): Promise<SweepPageRecord | null>;
  offer(key: string, permanentRedirect: boolean, page: SweepPageRecord): void;
}

interface PendingLookup {
  resolve: (page: SweepPageRecord | null) => void;
  timer: NodeJS.Timeout;
}

export class BrokeredSweepPageClient implements SweepPageSource {
  private socket?: net.Socket;
  private connected = false;
  private failed = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingLookup>();
  private queued: object[] = [];

  constructor(
    private readonly socketPath: string,
    private readonly onUnavailable: (reason: string) => void = (reason) =>
      console.warn(`[sweep-page-reuse] ${reason}; every page is fetched from its site`),
    private readonly lookupTimeoutMs: number = SWEEP_PAGE_REUSE_LOOKUP_TIMEOUT_MS,
  ) {}

  lookup(key: string): Promise<SweepPageRecord | null> {
    if (this.failed) return Promise.resolve(null);
    this.ensureSocket();
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, null), this.lookupTimeoutMs);
      this.pending.set(id, { resolve, timer });
      this.holdEventLoopWhileBusy();
      this.write({ t: 'page-get', id, key });
    });
  }

  offer(key: string, permanentRedirect: boolean, page: SweepPageRecord): void {
    if (this.failed) return;
    this.ensureSocket();
    this.write({ t: 'page-put', key, permanentRedirect, page });
  }

  close(): void {
    this.socket?.destroy();
  }

  private write(message: object): void {
    if (this.connected && this.socket) writeLine(this.socket, message);
    else this.queued.push(message);
  }

  private settle(id: number, page: SweepPageRecord | null): void {
    const waiter = this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(page);
    this.holdEventLoopWhileBusy();
  }

  private ensureSocket(): void {
    if (this.socket) return;
    const socket = net.createConnection(this.socketPath);
    this.socket = socket;
    socket.unref();
    socket.on('connect', () => {
      this.connected = true;
      for (const message of this.queued.splice(0)) writeLine(socket, message);
    });
    socket.on(
      'data',
      lineReader((raw) => {
        const message = raw as SweepPageBrokerMessage;
        if (message?.t === 'page' && Number.isInteger(message.id)) {
          this.settle(message.id, message.page ?? null);
        }
      }),
    );
    socket.on('error', (error) =>
      this.failOver(`sweep page broker unavailable (${error.message})`),
    );
    socket.on('close', () => this.failOver('sweep page broker connection closed'));
  }

  private holdEventLoopWhileBusy(): void {
    if (!this.socket || this.failed) return;
    if (this.pending.size > 0) this.socket.ref();
    else this.socket.unref();
  }

  private failOver(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    this.queued = [];
    this.socket?.unref();
    this.onUnavailable(reason);
    for (const id of [...this.pending.keys()]) this.settle(id, null);
  }
}

const STATE_KEY = '__scraperSweepPageReuse';

interface ReuseRequestState {
  key: string;
  rawBody?: string;
  redirectStatuses: number[];
  originalTransformResponse: InternalAxiosRequestConfig['transformResponse'];
  originalBeforeRedirect: InternalAxiosRequestConfig['beforeRedirect'];
}

type ConfigWithReuseState = InternalAxiosRequestConfig & {
  [STATE_KEY]?: ReuseRequestState;
  [SWEEP_PAGE_REUSE_HIT_KEY]?: boolean;
};

function toTransformList(
  transform: InternalAxiosRequestConfig['transformResponse'],
): AxiosResponseTransformer[] {
  if (!transform) return [];
  return Array.isArray(transform) ? transform : [transform];
}

function reusedPageAdapter(page: SweepPageRecord, body: string): AxiosAdapter {
  return async (config) => ({
    data: body,
    status: 200,
    statusText: 'OK',
    headers: AxiosHeaders.from({
      'content-type': page.contentType,
      [SWEEP_PAGE_REUSE_RESPONSE_HEADER]: page.fetchedAt,
    }),
    config,
    request: { res: { responseUrl: page.finalUrl } },
  });
}

async function unpack(page: SweepPageRecord): Promise<string | null> {
  try {
    return (await gunzip(Buffer.from(page.gzipBase64, 'base64'))).toString('utf8');
  } catch {
    return null;
  }
}

export interface SweepPageReuseOptions {
  source: SweepPageSource;
  hosts?: Iterable<string>;
  maxPageBytes?: number;
  now?: () => Date;
}

export interface SweepPageReuseHandle {
  detach(): void;
  settled(): Promise<void>;
}

export function attachSweepPageReuse(
  instance: AxiosInstance,
  options: SweepPageReuseOptions,
): SweepPageReuseHandle {
  const hosts = new Set(
    Array.from(options.hosts ?? SWEEP_PAGE_REUSE_HOSTS, (host) => host.toLowerCase()),
  );
  const maxPageBytes = options.maxPageBytes ?? SWEEP_PAGE_REUSE_MAX_PAGE_BYTES;
  const now = options.now ?? (() => new Date());

  const bump = (field: keyof SweepPageReuseStats, amount = 1): void => {
    const stats = statsStorage.getStore();
    if (stats) stats[field] += amount;
  };

  const eligibleKey = (config: InternalAxiosRequestConfig): string | null => {
    if (bypassStorage.getStore()) return null;
    if ((config.method ?? 'get').toLowerCase() !== 'get') return null;
    if (!TEXTUAL_RESPONSE_TYPES.has(config.responseType)) return null;
    const headers = plainHeaders(config.headers);
    if (CALLER_OWNED_REQUEST_HEADERS.some((header) => header in headers)) return null;
    let key: string | null;
    try {
      key = sweepPageReuseKey(instance.getUri(config));
    } catch {
      return null;
    }
    return key && hosts.has(keyHost(key)) ? key : null;
  };

  const requestId = instance.interceptors.request.use(async (config) => {
    const key = eligibleKey(config);
    if (!key) return config;
    const reuseConfig = config as ConfigWithReuseState;
    bump('lookups');
    const page = await options.source.lookup(key).catch(() => null);
    const body = page ? await unpack(page) : null;
    if (page && body !== null) {
      reuseConfig[SWEEP_PAGE_REUSE_HIT_KEY] = true;
      config.adapter = reusedPageAdapter(page, body);
      bump('reused');
      bump('bytesReused', Buffer.byteLength(body, 'utf8'));
      const read = readStorage.getStore();
      if (read) read.pagesReused += 1;
      return config;
    }

    const state: ReuseRequestState = {
      key,
      redirectStatuses: [],
      originalTransformResponse: config.transformResponse,
      originalBeforeRedirect: config.beforeRedirect,
    };
    config.transformResponse = [
      (data: unknown) => {
        if (typeof data === 'string') state.rawBody = data;
        else if (Buffer.isBuffer(data)) state.rawBody = data.toString('utf8');
        return data;
      },
      ...toTransformList(state.originalTransformResponse),
    ];
    config.beforeRedirect = (redirectOptions, responseDetails, requestDetails) => {
      state.redirectStatuses.push(responseDetails.statusCode);
      state.originalBeforeRedirect?.(redirectOptions, responseDetails, requestDetails);
    };
    reuseConfig[STATE_KEY] = state;
    return config;
  });

  const restoreCallerConfig = (
    config: ConfigWithReuseState | undefined,
  ): ReuseRequestState | undefined => {
    const state = config?.[STATE_KEY];
    if (!config || !state) return undefined;
    delete config[STATE_KEY];
    config.transformResponse = state.originalTransformResponse;
    config.beforeRedirect = state.originalBeforeRedirect;
    return state;
  };

  const offerFreshPage = async (response: AxiosResponse, state: ReuseRequestState) => {
    const body = state.rawBody;
    if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > maxPageBytes) return;
    const headers = plainHeaders(response.headers);
    const contentType = headers['content-type'];
    if (typeof contentType !== 'string' || !isTextualContentType(contentType)) return;
    if (/\bno-store\b/i.test(String(headers['cache-control'] ?? ''))) return;
    const finalUrl = sweepPageReuseKey(responseFinalUrl(response, state.key));
    if (!finalUrl || !hosts.has(keyHost(finalUrl))) return;
    const permanentRedirect =
      finalUrl !== state.key &&
      state.redirectStatuses.length > 0 &&
      state.redirectStatuses.every((status) => PERMANENT_REDIRECT_STATUSES.has(status));
    const packed = await gzip(Buffer.from(body, 'utf8'));
    options.source.offer(state.key, permanentRedirect, {
      finalUrl,
      contentType,
      fetchedAt: now().toISOString(),
      gzipBase64: packed.toString('base64'),
    });
    bump('offered');
  };

  const responseId = instance.interceptors.response.use(
    async (response) => {
      if (isSweepPageReuseHit(response.config)) return response;
      const state = restoreCallerConfig(response.config as ConfigWithReuseState);
      if (state && response.status === 200) await offerFreshPage(response, state).catch(() => {});
      return response;
    },
    (error: unknown) => {
      restoreCallerConfig((error as { config?: ConfigWithReuseState } | undefined)?.config);
      return Promise.reject(error);
    },
  );

  return {
    detach: () => {
      instance.interceptors.request.eject(requestId);
      instance.interceptors.response.eject(responseId);
    },
    settled: () => options.source.lookup('').then(() => undefined),
  };
}

export function isSweepPageReuseEnabledForChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[SCRAPER_SWEEP_PAGE_REUSE_ENV]?.trim() === '1' &&
    Boolean(env[SCRAPER_HOST_SLOT_BROKER_ENV]?.trim())
  );
}

let installedHandle: SweepPageReuseHandle | null = null;

export function installSweepPageReuse(
  env: NodeJS.ProcessEnv = process.env,
): SweepPageReuseHandle | null {
  if (installedHandle) return installedHandle;
  if (!isSweepPageReuseEnabledForChild(env)) return null;
  const socketPath = String(env[SCRAPER_HOST_SLOT_BROKER_ENV]).trim();
  installedHandle = attachSweepPageReuse(axios, {
    source: new BrokeredSweepPageClient(socketPath),
  });
  return installedHandle;
}
