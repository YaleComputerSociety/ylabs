import { sanitizeLogValue } from '../utils/logSanitizer';
import type { SearchRerankCacheLookup } from './searchRerankCache';
import type { ResearchGroupFilterInput } from './researchGroupFilters';

export const SEARCH_RERANK_LIVE_MISS_CALLER = 'search-rerank-live-miss';
export const SEARCH_RERANK_LIVE_MISS_QUEUE_LIMIT = 500;
export const SEARCH_RERANK_LIVE_MISS_MAX_QUERY_CHARACTERS = 100;
export const SEARCH_RERANK_LIVE_MISS_MAX_QUERY_WORDS = 10;
export const SEARCH_RERANK_LIVE_MISS_MAX_PER_IP_PER_HOUR = 20;
export const SEARCH_RERANK_LIVE_MISS_MAX_PER_SESSION_PER_DAY = 60;
export const SEARCH_RERANK_LIVE_MISS_DAILY_SPEND_CEILING_USD = 1;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CLIENT_COUNTER_PRUNE_SIZE = 5000;

export type SearchRerankLiveMissMode = 'shadow' | 'serve';

export const isSearchRerankLiveMissEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.SEARCH_RERANK_LIVE_MISS_ENABLED === 'true';

export const searchRerankLiveMissMode = (
  env: NodeJS.ProcessEnv = process.env,
): SearchRerankLiveMissMode => (env.SEARCH_RERANK_LIVE_MISS_MODE === 'serve' ? 'serve' : 'shadow');

export const searchRerankLiveMissStaleBefore = (
  env: NodeJS.ProcessEnv = process.env,
): Date | null => {
  const raw = String(env.SEARCH_RERANK_LIVE_MISS_STALE_BEFORE ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export interface SearchRerankLiveMissClient {
  ipKey: string;
  sessionKey: string;
}

export interface SearchRerankLiveMissJobRequest {
  queryKey: string;
  query: string;
  filters: ResearchGroupFilterInput;
}

export type SearchRerankLiveMissGate =
  | 'eligible'
  | 'meili-paged'
  | 'name-query'
  | 'no-query-tokens'
  | 'no-keyword-row'
  | 'too-few-candidates';

const isStale = (scoredAt: Date | null, staleBefore: Date | null): boolean =>
  staleBefore !== null && (scoredAt === null || scoredAt.getTime() < staleBefore.getTime());

export function searchRerankLiveMissWantsEntry(
  lookup: SearchRerankCacheLookup,
  mode: SearchRerankLiveMissMode,
  staleBefore: Date | null,
): boolean {
  switch (lookup.kind) {
    case 'absent':
      return true;
    case 'seeded':
      return false;
    case 'shadow':
      return mode === 'serve' || isStale(lookup.scoredAt, staleBefore);
    case 'served':
      return mode === 'serve' && isStale(lookup.scoredAt, staleBefore);
  }
}

export const searchRerankLiveMissQueryFits = (query: string): boolean => {
  const trimmed = query.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= SEARCH_RERANK_LIVE_MISS_MAX_QUERY_CHARACTERS &&
    trimmed.split(/\s+/).length <= SEARCH_RERANK_LIVE_MISS_MAX_QUERY_WORDS
  );
};

export type SearchRerankLiveMissJobStatus =
  | 'written'
  | 'scored'
  | 'kept-existing'
  | 'not-wanted'
  | 'ineligible'
  | 'no-api-key'
  | 'spend-ceiling'
  | 'spend-unreadable'
  | 'model-failed'
  | 'malformed-output';

export type SearchRerankLiveMissRunner = (
  request: SearchRerankLiveMissJobRequest,
) => Promise<{ status: SearchRerankLiveMissJobStatus }>;

export type SearchRerankLiveMissEnqueueDecision =
  | 'enqueued'
  | 'joined-in-flight'
  | 'query-too-long'
  | 'stopped-for-the-day'
  | 'ip-cap'
  | 'session-cap';

interface WindowCounter {
  windowStart: number;
  count: number;
}

interface SearchRerankLiveMissState {
  pending: SearchRerankLiveMissJobRequest[];
  inFlight: Set<string>;
  byIp: Map<string, WindowCounter>;
  bySession: Map<string, WindowCounter>;
  stoppedUntil: number;
  draining: Promise<void> | null;
}

const freshState = (): SearchRerankLiveMissState => ({
  pending: [],
  inFlight: new Set(),
  byIp: new Map(),
  bySession: new Map(),
  stoppedUntil: 0,
  draining: null,
});

let state = freshState();
let runner: SearchRerankLiveMissRunner | null = null;
let clock: () => number = Date.now;

export function setSearchRerankLiveMissRunner(next: SearchRerankLiveMissRunner | null): void {
  runner = next;
}

export function setSearchRerankLiveMissClock(next: (() => number) | null): void {
  clock = next ?? Date.now;
}

export function resetSearchRerankLiveMissQueue(): void {
  state = freshState();
}

export const searchRerankLiveMissQueueSnapshot = () => ({
  pending: state.pending.map((job) => job.queryKey),
  inFlight: [...state.inFlight],
  stoppedUntil: state.stoppedUntil,
});

const startOfUtcDay = (now: number): number => now - (now % DAY_MS);

const counterWithin = (
  counters: Map<string, WindowCounter>,
  key: string,
  windowStart: number,
): WindowCounter => {
  const existing = counters.get(key);
  if (existing && existing.windowStart === windowStart) return existing;
  if (counters.size >= CLIENT_COUNTER_PRUNE_SIZE) {
    for (const [staleKey, counter] of counters) {
      if (counter.windowStart !== windowStart) counters.delete(staleKey);
    }
  }
  const counter = { windowStart, count: 0 };
  counters.set(key, counter);
  return counter;
};

const stopForTheDay = (queue: SearchRerankLiveMissState, now: number): void => {
  queue.stoppedUntil = startOfUtcDay(now) + DAY_MS;
  for (const job of queue.pending) queue.inFlight.delete(job.queryKey);
  queue.pending = [];
};

export function stopSearchRerankLiveMissForTheDay(now: number = clock()): void {
  stopForTheDay(state, now);
}

const defaultRunner: SearchRerankLiveMissRunner = async (request) => {
  const { runSearchRerankLiveMissJob } = await import('./searchRerankLiveMissJob');
  return runSearchRerankLiveMissJob(request);
};

const logOutcome = (status: string): void => {
  console.info(`[${SEARCH_RERANK_LIVE_MISS_CALLER}] job ${sanitizeLogValue(status)}`);
};

async function drainQueue(queue: SearchRerankLiveMissState): Promise<void> {
  while (queue.pending.length > 0 && queue === state) {
    if (queue.stoppedUntil > clock()) {
      stopForTheDay(queue, clock());
      return;
    }
    const job = queue.pending.shift()!;
    try {
      const { status } = await (runner ?? defaultRunner)(job);
      logOutcome(status);
      if (status === 'spend-ceiling') stopForTheDay(queue, clock());
    } catch (error) {
      console.error(`[${SEARCH_RERANK_LIVE_MISS_CALLER}] job failed:`, sanitizeLogValue(error));
    } finally {
      queue.inFlight.delete(job.queryKey);
    }
  }
}

const startDraining = (queue: SearchRerankLiveMissState): void => {
  if (queue.draining) return;
  queue.draining = new Promise<void>((resolve) => setImmediate(resolve))
    .then(() => drainQueue(queue))
    .finally(() => {
      queue.draining = null;
      if (queue === state && queue.pending.length > 0) startDraining(queue);
    });
};

export async function searchRerankLiveMissIdle(): Promise<void> {
  while (state.draining) await state.draining;
}

export function enqueueSearchRerankLiveMiss(
  request: SearchRerankLiveMissJobRequest,
  client: SearchRerankLiveMissClient,
): SearchRerankLiveMissEnqueueDecision {
  if (!searchRerankLiveMissQueryFits(request.query)) return 'query-too-long';
  const now = clock();
  if (state.stoppedUntil > now) return 'stopped-for-the-day';
  if (state.inFlight.has(request.queryKey)) return 'joined-in-flight';
  const ipCounter = counterWithin(state.byIp, client.ipKey, now - (now % HOUR_MS));
  if (ipCounter.count >= SEARCH_RERANK_LIVE_MISS_MAX_PER_IP_PER_HOUR) return 'ip-cap';
  const sessionCounter = counterWithin(state.bySession, client.sessionKey, startOfUtcDay(now));
  if (sessionCounter.count >= SEARCH_RERANK_LIVE_MISS_MAX_PER_SESSION_PER_DAY) {
    return 'session-cap';
  }
  ipCounter.count += 1;
  sessionCounter.count += 1;
  if (state.pending.length >= SEARCH_RERANK_LIVE_MISS_QUEUE_LIMIT) {
    const dropped = state.pending.shift();
    if (dropped) state.inFlight.delete(dropped.queryKey);
  }
  state.pending.push(request);
  state.inFlight.add(request.queryKey);
  startDraining(state);
  return 'enqueued';
}
