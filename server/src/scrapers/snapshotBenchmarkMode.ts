/**
 * Capture and replay of the pages a lane fetches, so a lane can be scored on a frozen
 * input (#3526).
 *
 * Capture forces every `getCached` read to miss, so the lane fetches live, and records
 * every `setCached` payload instead of writing the TTL cache. Replay serves only the
 * captured pages and blocks the default axios instance, the only HTTP client the lanes
 * use, so a page the capture never saw is counted as a miss rather than fetched.
 */
import axios from 'axios';

export interface CapturedPage {
  sourceName: string;
  requestKey: string;
  payload: unknown;
  fetchedAt: Date;
}

export class BenchmarkReplayMissError extends Error {
  constructor(sourceName: string, requestKey: string) {
    super(`benchmark replay has no page for ${sourceName} ${requestKey}`);
    this.name = 'BenchmarkReplayMissError';
  }
}

export class BenchmarkReplayNetworkError extends Error {
  constructor() {
    super('benchmark replay: network requests are disabled');
    this.name = 'BenchmarkReplayNetworkError';
  }
}

interface CaptureMode {
  kind: 'capture';
  pages: Map<string, CapturedPage>;
}

interface ReplayMode {
  kind: 'replay';
  pages: Map<string, unknown>;
  served: Set<string>;
  missed: Set<string>;
  networkBlocks: number;
  interceptorId: number;
}

let mode: CaptureMode | ReplayMode | null = null;

export const benchmarkPageKey = (sourceName: string, requestKey: string): string =>
  `${sourceName}\u0000${requestKey}`;

function assertNoActiveMode(): void {
  if (mode) throw new Error(`a benchmark ${mode.kind} is already active`);
}

export function beginBenchmarkCapture(): void {
  assertNoActiveMode();
  mode = { kind: 'capture', pages: new Map() };
}

export function finishBenchmarkCapture(): CapturedPage[] {
  if (mode?.kind !== 'capture') throw new Error('no benchmark capture is active');
  const pages = [...mode.pages.values()];
  mode = null;
  return pages;
}

export function beginBenchmarkReplay(pages: readonly CapturedPage[]): void {
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
  };
  replay.interceptorId = axios.interceptors.request.use(() => {
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
    throw new BenchmarkReplayMissError(sourceName, requestKey);
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
