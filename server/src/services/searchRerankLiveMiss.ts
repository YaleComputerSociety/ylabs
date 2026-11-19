import { sanitizeLogValue } from '../utils/logSanitizer';
import type { SearchRerankEntryKind } from './searchRerankCache';
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

export interface SearchRerankLiveMissClient {
  ipKey: string;
  sessionKey: string;
}

export interface SearchRerankLiveMissJobRequest {
  queryKey: string;
  query: string;
  filters: ResearchGroupFilterInput;
  rewriteAcronym?: false;
}

export type SearchRerankLiveMissGate =
  | 'eligible'
  | 'meili-paged'
  | 'name-query'
  | 'name-shaped'
  | 'too-short'
  | 'no-query-tokens'
  | 'no-keyword-row'
  | 'too-few-candidates';

/**
 * `isStale` is read only when staleness alone decides, so a search that would not queue
 * the key anyway never hashes its candidates.
 */
export function searchRerankLiveMissWantsEntry(
  kind: SearchRerankEntryKind,
  mode: SearchRerankLiveMissMode,
  isStale: () => boolean = () => false,
): boolean {
  switch (kind) {
    case 'absent':
      return true;
    case 'seeded':
      return false;
    case 'served':
      return mode === 'serve' && isStale();
    case 'shadow':
      return mode === 'serve' || isStale();
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
  | 'written-still-stale'
  | 'kept-existing'
  | 'not-wanted'
  | 'still-fresh'
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
  | 'failed-today'
  | 'ip-cap'
  | 'session-cap';

interface WindowCounter {
  windowStart: number;
  count: number;
}

interface SearchRerankLiveMissState {
  pending: SearchRerankLiveMissJobRequest[];
  inFlight: Set<string>;
  failedDay: number;
  failedToday: Set<string>;
  byIp: Map<string, WindowCounter>;
  bySession: Map<string, WindowCounter>;
  stoppedUntil: number;
  draining: Promise<void> | null;
}

const freshState = (): SearchRerankLiveMissState => ({
  pending: [],
  inFlight: new Set(),
  failedDay: 0,
  failedToday: new Set(),
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

const OUTCOMES_THAT_WOULD_REPEAT: ReadonlySet<SearchRerankLiveMissJobStatus> = new Set([
  'written-still-stale',
  'still-fresh',
  'ineligible',
  'model-failed',
  'malformed-output',
]);

const failedTodayFor = (queue: SearchRerankLiveMissState, now: number): Set<string> => {
  const today = startOfUtcDay(now);
  if (queue.failedDay !== today) {
    queue.failedDay = today;
    queue.failedToday = new Set();
  }
  return queue.failedToday;
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
      if (OUTCOMES_THAT_WOULD_REPEAT.has(status)) failedTodayFor(queue, clock()).add(job.queryKey);
    } catch (error) {
      console.error(`[${SEARCH_RERANK_LIVE_MISS_CALLER}] job failed:`, sanitizeLogValue(error));
      failedTodayFor(queue, clock()).add(job.queryKey);
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
  if (failedTodayFor(state, now).has(request.queryKey)) return 'failed-today';
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
