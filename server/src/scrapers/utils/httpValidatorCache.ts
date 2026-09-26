// Two constraints shape this cache (#3557). A 304 must be replayed as the stored 200 body
// rather than skipped, because a skipped page leaves no complete-read witness for
// `fieldRetraction.ts` and reproduces the #3332 freeze in `contentHashGate.ts`. And it lives
// on local disk, never in Mongo, because the Mongo `ScrapeSnapshot` cache filled the
// Development quota (#3536).
import { AsyncLocalStorage } from 'async_hooks';
import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import axios, {
  AxiosHeaders,
  type AxiosInstance,
  type AxiosResponse,
  type AxiosResponseTransformer,
  type InternalAxiosRequestConfig,
} from 'axios';
import CachePolicy from 'http-cache-semantics';
import type { ScraperFetchMetrics, ScraperResult } from '../types';

export const DEFAULT_HTTP_CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_HTTP_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const EVICTION_TARGET_RATIO = 0.9;
const ENTRY_FORMAT_VERSION = 1;
const MEBIBYTE = 1024 * 1024;

export interface HttpValidatorCacheStats {
  revalidations: number;
  notModified: number;
  bytesSaved: number;
  bytesDownloaded: number;
  stored: number;
  refetched: number;
  storeErrors: number;
}

export const emptyHttpValidatorCacheStats = (): HttpValidatorCacheStats => ({
  revalidations: 0,
  notModified: 0,
  bytesSaved: 0,
  bytesDownloaded: 0,
  stored: 0,
  refetched: 0,
  storeErrors: 0,
});

export function hasHttpValidatorCacheActivity(stats: HttpValidatorCacheStats): boolean {
  return Object.values(stats).some((value) => value > 0);
}

interface HttpCacheScope {
  stats: HttpValidatorCacheStats;
}

const scopeStorage = new AsyncLocalStorage<HttpCacheScope>();

export async function withHttpValidatorCacheScope<T>(
  run: () => Promise<T>,
): Promise<{ value: T; stats: HttpValidatorCacheStats }> {
  const scope: HttpCacheScope = { stats: emptyHttpValidatorCacheStats() };
  const value = await scopeStorage.run(scope, run);
  return { value, stats: scope.stats };
}

export function withHttpCacheFetchMetrics(
  result: ScraperResult,
  stats: HttpValidatorCacheStats,
): ScraperResult {
  if (!hasHttpValidatorCacheActivity(stats)) return result;
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
  return { ...result, fetchMetrics: { ...fetchMetrics, httpCache: stats } };
}

export interface HttpValidatorCacheConfig {
  enabled: boolean;
  directory: string;
  maxBytes: number;
  maxEntryBytes: number;
}

function defaultCacheRoot(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CACHE_HOME?.trim();
  return xdg ? xdg : path.join(os.homedir(), '.cache');
}

function positiveMebibytes(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed * MEBIBYTE) : fallback;
}

const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);

export function resolveHttpValidatorCacheConfig(
  env: NodeJS.ProcessEnv = process.env,
): HttpValidatorCacheConfig {
  const toggle = env.SCRAPER_HTTP_CACHE?.trim().toLowerCase();
  const directory =
    env.SCRAPER_HTTP_CACHE_DIR?.trim() ||
    path.join(defaultCacheRoot(env), 'ylabs', 'scraper-http-cache');
  const maxBytes = positiveMebibytes(env.SCRAPER_HTTP_CACHE_MAX_MB, DEFAULT_HTTP_CACHE_MAX_BYTES);
  return {
    enabled: !toggle || !DISABLED_VALUES.has(toggle),
    directory,
    maxBytes,
    maxEntryBytes: Math.min(maxBytes, DEFAULT_HTTP_CACHE_MAX_ENTRY_BYTES),
  };
}

export interface StoredHttpResponse {
  v: number;
  url: string;
  storedAt: string;
  policy: CachePolicy.CachePolicyObject;
  body: string;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export class HttpValidatorStore {
  private readonly entriesDir: string;
  private readonly aliasesDir: string;
  private knownBytes: number | null = null;
  private evicting: Promise<void> | null = null;

  constructor(
    readonly directory: string,
    readonly maxBytes: number = DEFAULT_HTTP_CACHE_MAX_BYTES,
  ) {
    this.entriesDir = path.join(directory, 'entries');
    this.aliasesDir = path.join(directory, 'aliases');
  }

  async lookup(requestUrl: string): Promise<StoredHttpResponse | null> {
    const aliased = await this.readText(this.aliasPath(requestUrl));
    const url = aliased?.trim() || requestUrl;
    const raw = await this.readText(this.entryPath(url));
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as StoredHttpResponse;
      if (entry.v !== ENTRY_FORMAT_VERSION || entry.url !== url) return null;
      if (typeof entry.body !== 'string' || !entry.policy) return null;
      return entry;
    } catch {
      return null;
    }
  }

  async save(requestUrl: string, entry: StoredHttpResponse): Promise<void> {
    const serialized = JSON.stringify(entry);
    const written = await this.writeAtomic(this.entryPath(entry.url), serialized);
    if (requestUrl !== entry.url) {
      await this.writeAtomic(this.aliasPath(requestUrl), entry.url);
    } else {
      await fs.rm(this.aliasPath(requestUrl), { force: true });
    }
    await this.account(written);
  }

  async touch(entry: StoredHttpResponse): Promise<void> {
    const now = new Date();
    await fs.utimes(this.entryPath(entry.url), now, now).catch(() => undefined);
  }

  async remove(url: string): Promise<void> {
    await fs.rm(this.entryPath(url), { force: true });
  }

  async totalBytes(): Promise<number> {
    const files = await this.listFiles();
    return files.reduce((sum, file) => sum + file.size, 0);
  }

  private entryPath(url: string): string {
    return path.join(this.entriesDir, `${sha256(url)}.json`);
  }

  private aliasPath(url: string): string {
    return path.join(this.aliasesDir, sha256(url));
  }

  private async readText(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  private async writeAtomic(file: string, contents: string): Promise<number> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(temporary, contents, 'utf8');
    await fs.rename(temporary, file);
    return Buffer.byteLength(contents, 'utf8');
  }

  private async account(writtenBytes: number): Promise<void> {
    if (this.knownBytes === null) this.knownBytes = await this.totalBytes();
    else this.knownBytes += writtenBytes;
    if (this.knownBytes <= this.maxBytes) return;
    this.evicting ??= this.evict().finally(() => {
      this.evicting = null;
    });
    await this.evicting;
  }

  private async evict(): Promise<void> {
    const files = (await this.listFiles()).sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    const target = Math.floor(this.maxBytes * EVICTION_TARGET_RATIO);
    for (const file of files) {
      if (total <= target) break;
      await fs.rm(file.path, { force: true });
      total -= file.size;
    }
    this.knownBytes = total;
  }

  private async listFiles(): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
    const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const dir of [this.entriesDir, this.aliasesDir]) {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.endsWith('.tmp')) continue;
        const file = path.join(dir, name);
        try {
          const stat = await fs.stat(file);
          if (stat.isFile()) files.push({ path: file, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          continue;
        }
      }
    }
    return files;
  }
}

const STATE_KEY = '__scraperHttpValidatorCache';
const SKIP_KEY = '__scraperHttpValidatorCacheSkip';

interface RequestCacheState {
  requestUrl: string;
  requestHeaders: CachePolicy.Headers;
  entry: StoredHttpResponse | null;
  conditional: boolean;
  rawBody?: string;
  originalTransformResponse: InternalAxiosRequestConfig['transformResponse'];
  originalValidateStatus: InternalAxiosRequestConfig['validateStatus'];
}

type ConfigWithCacheState = InternalAxiosRequestConfig & {
  [STATE_KEY]?: RequestCacheState;
  [SKIP_KEY]?: boolean;
};

const TEXTUAL_RESPONSE_TYPES = new Set([undefined, '', 'json', 'text', 'document']);
const CALLER_OWNED_REQUEST_HEADERS = [
  'if-none-match',
  'if-modified-since',
  'if-match',
  'if-unmodified-since',
  'if-range',
  'range',
  'authorization',
  'cookie',
];

function plainHeaders(headers: unknown): CachePolicy.Headers {
  const source =
    headers instanceof AxiosHeaders
      ? (headers.toJSON() as Record<string, unknown>)
      : ((headers ?? {}) as Record<string, unknown>);
  const plain: CachePolicy.Headers = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === false) continue;
    plain[key.toLowerCase()] = Array.isArray(value) ? value.map(String) : String(value);
  }
  return plain;
}

function isTextualContentType(contentType: unknown): boolean {
  if (typeof contentType !== 'string') return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime.endsWith('+json') ||
    mime === 'application/xml' ||
    mime.endsWith('+xml')
  );
}

function responseFinalUrl(response: AxiosResponse, fallback: string): string {
  const candidate = (response.request as { res?: { responseUrl?: unknown } } | undefined)?.res
    ?.responseUrl;
  if (typeof candidate !== 'string' || !candidate) return fallback;
  try {
    return new URL(candidate).toString();
  } catch {
    return fallback;
  }
}

function toTransformList(
  transform: InternalAxiosRequestConfig['transformResponse'],
): AxiosResponseTransformer[] {
  if (!transform) return [];
  return Array.isArray(transform) ? transform : [transform];
}

const acceptsDefaultStatus = (status: number): boolean => status >= 200 && status < 300;

export interface HttpValidatorCacheOptions {
  store: HttpValidatorStore;
  maxEntryBytes?: number;
  now?: () => Date;
  onStoreError?: (error: unknown) => void;
}

export interface HttpValidatorCacheHandle {
  detach(): void;
}

export function attachHttpValidatorCache(
  instance: AxiosInstance,
  options: HttpValidatorCacheOptions,
): HttpValidatorCacheHandle {
  const { store } = options;
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_HTTP_CACHE_MAX_ENTRY_BYTES;
  const now = options.now ?? (() => new Date());

  const bump = (field: keyof HttpValidatorCacheStats, amount = 1): void => {
    const scoped = scopeStorage.getStore();
    if (scoped) scoped.stats[field] += amount;
  };

  const reportStoreError = (error: unknown): void => {
    bump('storeErrors');
    options.onStoreError?.(error);
  };

  const requestId = instance.interceptors.request.use(async (config) => {
    const cacheConfig = config as ConfigWithCacheState;
    if (cacheConfig[SKIP_KEY]) return config;
    if ((config.method ?? 'get').toLowerCase() !== 'get') return config;
    if (!TEXTUAL_RESPONSE_TYPES.has(config.responseType)) return config;
    const requestHeaders = plainHeaders(config.headers);
    if (CALLER_OWNED_REQUEST_HEADERS.some((header) => header in requestHeaders)) return config;

    let requestUrl: string;
    try {
      requestUrl = new URL(instance.getUri(config)).toString();
    } catch {
      return config;
    }

    const state: RequestCacheState = {
      requestUrl,
      requestHeaders,
      entry: null,
      conditional: false,
      originalTransformResponse: config.transformResponse,
      originalValidateStatus: config.validateStatus,
    };
    config.transformResponse = [
      (data: unknown) => {
        if (typeof data === 'string') state.rawBody = data;
        else if (Buffer.isBuffer(data)) state.rawBody = data.toString('utf8');
        return data;
      },
      ...toTransformList(state.originalTransformResponse),
    ];

    const entry = await store.lookup(requestUrl).catch(() => null);
    if (entry) {
      const validators = CachePolicy.fromObject(entry.policy).revalidationHeaders({
        url: entry.url,
        method: 'GET',
        headers: requestHeaders,
      });
      const ifNoneMatch = validators['if-none-match'];
      const ifModifiedSince = validators['if-modified-since'];
      if (typeof ifNoneMatch === 'string' || typeof ifModifiedSince === 'string') {
        if (typeof ifNoneMatch === 'string') config.headers.set('If-None-Match', ifNoneMatch);
        if (typeof ifModifiedSince === 'string') {
          config.headers.set('If-Modified-Since', ifModifiedSince);
        }
        state.entry = entry;
        state.conditional = true;
        const original = state.originalValidateStatus;
        config.validateStatus = (status: number) =>
          status === 304 ||
          (original ? original(status) : original === null || acceptsDefaultStatus(status));
        bump('revalidations');
      }
    }

    cacheConfig[STATE_KEY] = state;
    return config;
  });

  const refetchWithoutValidators = (config: ConfigWithCacheState): Promise<AxiosResponse> => {
    const retry: ConfigWithCacheState = {
      ...config,
      headers: AxiosHeaders.from(config.headers),
      [SKIP_KEY]: true,
    };
    return instance.request(retry);
  };

  const replayStoredBody = async (
    response: AxiosResponse,
    state: RequestCacheState,
    entry: StoredHttpResponse,
  ): Promise<AxiosResponse> => {
    const headers = AxiosHeaders.from(entry.policy.resh as Record<string, string>);
    const data = toTransformList(state.originalTransformResponse).reduce<unknown>(
      (current, transform) => transform.call(response.config, current, headers, 200),
      entry.body,
    );
    bump('notModified');
    bump('bytesSaved', Buffer.byteLength(entry.body, 'utf8'));
    await store.touch(entry).catch(reportStoreError);
    return { ...response, status: 200, statusText: 'OK', headers, data };
  };

  const storeFreshBody = async (
    response: AxiosResponse,
    state: RequestCacheState,
    finalUrl: string,
  ): Promise<void> => {
    const body = state.rawBody;
    if (typeof body !== 'string') return;
    const bytes = Buffer.byteLength(body, 'utf8');
    bump('bytesDownloaded', bytes);
    if (bytes > maxEntryBytes) return;
    const responseHeaders = plainHeaders(response.headers);
    delete responseHeaders['set-cookie'];
    if (!isTextualContentType(responseHeaders['content-type'])) return;
    if (!responseHeaders.etag && !responseHeaders['last-modified']) return;
    if (responseHeaders.vary === '*') return;
    const policy = new CachePolicy(
      { url: finalUrl, method: 'GET', headers: state.requestHeaders },
      { status: response.status, headers: responseHeaders },
      { shared: false },
    );
    if (!policy.storable()) {
      if (state.entry) await store.remove(state.entry.url).catch(reportStoreError);
      return;
    }
    await store
      .save(state.requestUrl, {
        v: ENTRY_FORMAT_VERSION,
        url: finalUrl,
        storedAt: now().toISOString(),
        policy: policy.toObject(),
        body,
      })
      .then(() => bump('stored'))
      .catch(reportStoreError);
  };

  const restoreCallerConfig = (
    config: ConfigWithCacheState | undefined,
  ): RequestCacheState | undefined => {
    const state = config?.[STATE_KEY];
    if (!config || !state) return undefined;
    delete config[STATE_KEY];
    config.transformResponse = state.originalTransformResponse;
    config.validateStatus = state.originalValidateStatus;
    if (state.conditional && config.headers instanceof AxiosHeaders) {
      config.headers.delete('If-None-Match');
      config.headers.delete('If-Modified-Since');
    }
    return state;
  };

  const responseId = instance.interceptors.response.use(
    async (response) => {
      const config = response.config as ConfigWithCacheState;
      const state = restoreCallerConfig(config);
      if (!state) return response;
      const finalUrl = responseFinalUrl(response, state.requestUrl);

      if (response.status === 304 && state.conditional && state.entry) {
        if (finalUrl === state.entry.url) return replayStoredBody(response, state, state.entry);
        bump('refetched');
        await store.remove(state.entry.url).catch(reportStoreError);
        return refetchWithoutValidators(config);
      }

      if (response.status === 200) await storeFreshBody(response, state, finalUrl);
      return response;
    },
    (error: unknown) => {
      restoreCallerConfig((error as { config?: ConfigWithCacheState } | undefined)?.config);
      return Promise.reject(error);
    },
  );

  return {
    detach: () => {
      instance.interceptors.request.eject(requestId);
      instance.interceptors.response.eject(responseId);
    },
  };
}

let installedHandle: HttpValidatorCacheHandle | null = null;

export function installScraperHttpValidatorCache(
  env: NodeJS.ProcessEnv = process.env,
): HttpValidatorCacheHandle | null {
  if (installedHandle) return installedHandle;
  const config = resolveHttpValidatorCacheConfig(env);
  if (!config.enabled) return null;
  let warned = false;
  installedHandle = attachHttpValidatorCache(axios, {
    store: new HttpValidatorStore(config.directory, config.maxBytes),
    maxEntryBytes: config.maxEntryBytes,
    onStoreError: (error) => {
      if (warned) return;
      warned = true;
      console.warn(
        `[http-cache] could not write ${config.directory}; fetches continue uncached: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  return installedHandle;
}
