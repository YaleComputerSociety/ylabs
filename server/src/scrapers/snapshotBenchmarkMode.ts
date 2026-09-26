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
 * would let the resolver, rather than lane code, decide which targets reach the cache.
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
  constructor() {
    super('benchmark replay: network requests are disabled');
    this.name = 'BenchmarkReplayNetworkError';
  }
}

export const MODEL_RESPONSE_NAMESPACE = 'model-chat-completion';

const MODEL_ENDPOINT_PREFIX = 'https://api.openai.com/';

interface CaptureMode {
  kind: 'capture';
  pages: Map<string, CapturedPage>;
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
    requestInterceptorId: -1,
    responseInterceptorId: -1,
  };
  capture.requestInterceptorId = axios.interceptors.request.use((config) => {
    if (isModelRequest(config)) {
      modelRequestKeyByConfig.set(config, modelRequestKey(config.url as string, config.data));
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
  if (mode?.kind !== 'capture') throw new Error('no benchmark capture is active');
  axios.interceptors.request.eject(mode.requestInterceptorId);
  axios.interceptors.response.eject(mode.responseInterceptorId);
  const pages = [...mode.pages.values()];
  mode = null;
  return pages;
}

export const isBenchmarkReplayActive = (): boolean => mode?.kind === 'replay';

export const isBenchmarkModeActive = (): boolean => mode !== null;

export const isLiveModelReplayActive = (): boolean => mode?.kind === 'replay' && mode.liveModel;

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
    replay.networkBlocks += 1;
    throw new BenchmarkReplayNetworkError();
  });
  mode = replay;
}

export function finishBenchmarkReplay(): {
  pagesServed: number;
  pagesMissed: number;
  networkBlocks: number;
} {
  if (mode?.kind !== 'replay') throw new Error('no benchmark replay is active');
  axios.interceptors.request.eject(mode.interceptorId);
  const outcome = {
    pagesServed: mode.served.size,
    pagesMissed: mode.missed.size,
    networkBlocks: mode.networkBlocks,
  };
  mode = null;
  return outcome;
}

export type BenchmarkCacheRead = { handled: false } | { handled: true; payload: unknown };

export function benchmarkCacheRead(sourceName: string, requestKey: string): BenchmarkCacheRead {
  if (!mode) return { handled: false };
  if (mode.kind === 'capture') return { handled: true, payload: null };
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
