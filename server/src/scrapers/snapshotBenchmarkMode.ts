/**
 * Capture and replay of the pages a lane fetches, so a lane can be scored on a frozen
 * input (#3526).
 *
 * Capture forces every `getCached` read to miss, so the lane fetches live, and records
 * every `setCached` payload instead of writing the TTL cache. Replay serves only the
 * captured pages and blocks the default axios instance, the only HTTP client the lanes
 * use, so a page the capture never saw is counted as a miss and the lane's own fetch of it
 * fails through the lane's normal error path rather than reaching the network. The SSRF
 * guard skips its DNS lookup during replay, because nothing can connect and a live lookup
 * would let the resolver, rather than lane code, decide which targets reach the cache. A host
 * the guard refused during capture is frozen as that refusal, so replay refuses it too rather
 * than letting the lane ask for a page the capture never could.
 *
 * A model call is frozen the same way (#3587). Capture records each chat-completion response
 * keyed by a hash of the exact request body, and replay serves it, so a changed prompt or a
 * changed page-to-prompt step is a counted miss rather than a stale answer. A live-model
 * replay serves the frozen pages but lets model calls through, which measures the model's
 * own run-to-run spread instead of the lane code.
 */
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import crypto from 'crypto';

export interface CapturedPage {
  sourceName: string;
  requestKey: string;
  payload: unknown;
  fetchedAt: Date;
}

export class BenchmarkReplayNetworkError extends Error {
  /**
   * The refused request. Axios hands a request-interceptor rejection to the response error
   * handlers, and the per-host limiter releases its slot from `error.config`, so without it
   * every refused request leaks a slot until the host's budget is gone and replay hangs.
   */
  readonly config?: InternalAxiosRequestConfig;

  constructor(config?: InternalAxiosRequestConfig) {
    super('benchmark replay: network requests are disabled');
    this.name = 'BenchmarkReplayNetworkError';
    this.config = config;
  }
}

export const MODEL_RESPONSE_NAMESPACE = 'model-chat-completion';

const MODEL_ENDPOINT_PREFIX = 'https://api.openai.com/';

interface CaptureMode {
  kind: 'capture';
  pages: Map<string, CapturedPage>;
  requested: Set<string>;
  requestInterceptorId: number;
  responseInterceptorId: number;
}

interface ReplayMode {
  kind: 'replay';
  pages: Map<string, unknown>;
  served: Set<string>;
  missed: Set<string>;
  networkBlocks: number;
  interceptorId: number;
  liveModel: boolean;
}

let mode: CaptureMode | ReplayMode | null = null;

export const benchmarkPageKey = (sourceName: string, requestKey: string): string =>
  `${sourceName}\u0000${requestKey}`;

function assertNoActiveMode(): void {
  if (mode) throw new Error(`a benchmark ${mode.kind} is already active`);
}

const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );

const isModelRequest = (config: InternalAxiosRequestConfig): boolean =>
  (config.method ?? 'get').toLowerCase() === 'post' &&
  typeof config.url === 'string' &&
  config.url.startsWith(MODEL_ENDPOINT_PREFIX);

export function modelRequestKey(url: string, body: unknown): string {
  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  const digest = crypto
    .createHash('sha256')
    .update(`${url}\n${canonicalJson(parsed ?? null)}`)
    .digest('hex');
  return `model-request:v1:${digest}`;
}

const modelRequestKeyByConfig = new WeakMap<object, string>();

export function beginBenchmarkCapture(): void {
  assertNoActiveMode();
  const capture: CaptureMode = {
    kind: 'capture',
    pages: new Map(),
    requested: new Set(),
    requestInterceptorId: -1,
    responseInterceptorId: -1,
  };
  capture.requestInterceptorId = axios.interceptors.request.use((config) => {
    if (isModelRequest(config)) {
      const requestKey = modelRequestKey(config.url as string, config.data);
      modelRequestKeyByConfig.set(config, requestKey);
      capture.requested.add(benchmarkPageKey(MODEL_RESPONSE_NAMESPACE, requestKey));
    }
    return config;
  });
  capture.responseInterceptorId = axios.interceptors.response.use((response: AxiosResponse) => {
    const requestKey = modelRequestKeyByConfig.get(response.config);
    if (requestKey) {
      capture.pages.set(benchmarkPageKey(MODEL_RESPONSE_NAMESPACE, requestKey), {
        sourceName: MODEL_RESPONSE_NAMESPACE,
        requestKey,
        payload: response.data,
        fetchedAt: new Date(),
      });
    }
    return response;
  });
  mode = capture;
}

export function finishBenchmarkCapture(): CapturedPage[] {
  return finishBenchmarkCaptureWithCoverage().pages;
}

/**
 * The captured pages, and how many distinct requests the capture made but could not freeze:
 * a page fetch or a model call that failed while capturing. A replay misses exactly those and
 * nothing else, so any miss beyond this count means the lane now asks for something the
 * benchmark never held, which is a changed prompt or a drifted target set, not a score.
 */
export function finishBenchmarkCaptureWithCoverage(): {
  pages: CapturedPage[];
  unfrozenRequestCount: number;
} {
  if (mode?.kind !== 'capture') throw new Error('no benchmark capture is active');
  axios.interceptors.request.eject(mode.requestInterceptorId);
  axios.interceptors.response.eject(mode.responseInterceptorId);
  const pages = [...mode.pages.values()];
  const frozen = new Set(mode.pages.keys());
  const unfrozenRequestCount = [...mode.requested].filter((key) => !frozen.has(key)).length;
  mode = null;
  return { pages, unfrozenRequestCount };
}

export const isBenchmarkReplayActive = (): boolean => mode?.kind === 'replay';

export const isBenchmarkModeActive = (): boolean => mode !== null;

export const isLiveModelReplayActive = (): boolean => mode?.kind === 'replay' && mode.liveModel;

export function refuseBenchmarkReplayNetwork(config?: InternalAxiosRequestConfig): never {
  if (mode?.kind === 'replay') mode.networkBlocks += 1;
  throw new BenchmarkReplayNetworkError(config);
}

function serveFrozenModelResponse(
  config: InternalAxiosRequestConfig,
  payload: unknown,
): InternalAxiosRequestConfig {
  config.adapter = async () => ({
    data: payload,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
  return config;
}

export function beginBenchmarkReplay(
  pages: readonly CapturedPage[],
  options: { liveModel?: boolean } = {},
): void {
  assertNoActiveMode();
  const replay: ReplayMode = {
    kind: 'replay',
    pages: new Map(
      pages.map((page) => [benchmarkPageKey(page.sourceName, page.requestKey), page.payload]),
    ),
    served: new Set(),
    missed: new Set(),
    networkBlocks: 0,
    interceptorId: -1,
    liveModel: options.liveModel === true,
  };
  replay.interceptorId = axios.interceptors.request.use((config) => {
    if (isModelRequest(config)) {
      if (replay.liveModel) return config;
      const key = benchmarkPageKey(
        MODEL_RESPONSE_NAMESPACE,
        modelRequestKey(config.url as string, config.data),
      );
      if (replay.pages.has(key)) {
        replay.served.add(key);
        return serveFrozenModelResponse(config, replay.pages.get(key));
      }
      replay.missed.add(key);
    }
    return refuseBenchmarkReplayNetwork(config);
  });
  mode = replay;
}

export function finishBenchmarkReplay(): {
  pagesServed: number;
  pagesMissed: number;
  networkBlocks: number;
  servedByNamespace: Record<string, number>;
} {
  if (mode?.kind !== 'replay') throw new Error('no benchmark replay is active');
  axios.interceptors.request.eject(mode.interceptorId);
  const servedByNamespace: Record<string, number> = {};
  for (const key of mode.served) {
    const namespace = key.slice(0, key.indexOf('\u0000'));
    servedByNamespace[namespace] = (servedByNamespace[namespace] ?? 0) + 1;
  }
  const outcome = {
    pagesServed: mode.served.size,
    pagesMissed: mode.missed.size,
    networkBlocks: mode.networkBlocks,
    servedByNamespace,
  };
  mode = null;
  return outcome;
}

export type BenchmarkCacheRead = { handled: false } | { handled: true; payload: unknown };

/** A frozen value read without counting it as a served or missed page, for capture metadata. */
export function benchmarkFrozenMetadata(sourceName: string, requestKey: string): unknown {
  if (mode?.kind !== 'replay') return undefined;
  return mode.pages.get(benchmarkPageKey(sourceName, requestKey));
}

export function benchmarkCacheRead(sourceName: string, requestKey: string): BenchmarkCacheRead {
  if (!mode) return { handled: false };
  if (mode.kind === 'capture') {
    mode.requested.add(benchmarkPageKey(sourceName, requestKey));
    return { handled: true, payload: null };
  }
  const key = benchmarkPageKey(sourceName, requestKey);
  if (!mode.pages.has(key)) {
    mode.missed.add(key);
    return { handled: true, payload: null };
  }
  mode.served.add(key);
  return { handled: true, payload: mode.pages.get(key) };
}

export function benchmarkCacheWrite(
  sourceName: string,
  requestKey: string,
  payload: unknown,
): boolean {
  if (!mode) return false;
  if (mode.kind === 'capture') {
    mode.pages.set(benchmarkPageKey(sourceName, requestKey), {
      sourceName,
      requestKey,
      payload,
      fetchedAt: new Date(),
    });
  }
  return true;
}

export const SSRF_HOST_REFUSAL_NAMESPACE = 'ssrf-host-refusal';

const hostRefusalKey = (hostname: string): string => hostname.trim().toLowerCase();

export function freezeHostRefusal(hostname: string, reason: string): void {
  if (mode?.kind !== 'capture') return;
  benchmarkCacheWrite(SSRF_HOST_REFUSAL_NAMESPACE, hostRefusalKey(hostname), { refusedAs: reason });
}

export function frozenHostRefusal(hostname: string): string | undefined {
  const frozen = benchmarkFrozenMetadata(SSRF_HOST_REFUSAL_NAMESPACE, hostRefusalKey(hostname)) as
    { refusedAs?: unknown } | undefined;
  return typeof frozen?.refusedAs === 'string' ? frozen.refusedAs : undefined;
}
