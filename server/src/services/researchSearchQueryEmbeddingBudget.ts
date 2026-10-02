/**
 * Spend budget and breaker for the query embedding behind hybrid research search.
 *
 * `POST /api/research/search` is public and every distinct query text is one paid
 * embedding call, so the number of calls a window can hold has to be a bounded
 * number rather than whatever the traffic happens to be. Nothing here ever fails a
 * request: a refusal means the search runs its keyword leg and the response says it
 * is degraded, which is the same reduction the missing-embedder path already serves.
 *
 * The window ceiling is the real bound and the per-client ceiling is a secondary
 * guard. That ordering is deliberate: Yale NATs a large student body behind few
 * egress addresses, so a tight per-client number would take the semantic leg away
 * from a whole cohort for the traffic of one member of it. The per-client number is
 * therefore set well above what a cohort of genuine searchers produces, and the
 * absolute bound on spend comes from the window ceiling instead.
 *
 * The client key is whatever `getPeerIpKey` produces for the request, so an IPv6
 * caller is metered by subnet exactly as it is by every other per-IP limiter here. A
 * per-address key would let one caller on a routed prefix mint a fresh bucket per
 * request and spend the whole window ceiling alone.
 */
const WINDOW_MS = 60_000;

const DEFAULT_MAX_PER_WINDOW = 600;
const DEFAULT_MAX_PER_CLIENT_PER_WINDOW = 120;
const DEFAULT_COOLDOWN_MS = 60_000;
const CONSECUTIVE_FAILURES_BEFORE_COOLDOWN = 5;

// Floored the way `FIRST_CONTACT_RATE_LIMIT_MAX` is floored, so a mistyped or
// zeroed override cannot switch the semantic leg off for everyone.
const MIN_MAX_PER_WINDOW = 60;
const MIN_MAX_PER_CLIENT_PER_WINDOW = 10;
const MIN_COOLDOWN_MS = 1_000;

const flooredPositiveIntegerEnv = (name: string, fallback: number, floor: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(floor, parsed);
};

export interface ResearchSearchQueryEmbeddingBudgetLimits {
  maxPerWindow: number;
  maxPerClientPerWindow: number;
  cooldownMs: number;
  windowMs: number;
}

export const researchSearchQueryEmbeddingBudgetLimits =
  (): ResearchSearchQueryEmbeddingBudgetLimits => ({
    maxPerWindow: flooredPositiveIntegerEnv(
      'RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE',
      DEFAULT_MAX_PER_WINDOW,
      MIN_MAX_PER_WINDOW,
    ),
    maxPerClientPerWindow: flooredPositiveIntegerEnv(
      'RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE',
      DEFAULT_MAX_PER_CLIENT_PER_WINDOW,
      MIN_MAX_PER_CLIENT_PER_WINDOW,
    ),
    cooldownMs: flooredPositiveIntegerEnv(
      'RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS',
      DEFAULT_COOLDOWN_MS,
      MIN_COOLDOWN_MS,
    ),
    windowMs: WINDOW_MS,
  });

export type ResearchSearchQueryEmbeddingSpendDecision =
  | 'allowed'
  | 'window-ceiling'
  | 'client-ceiling'
  | 'cooling-down';

// The client map only gains an entry when a call is allowed, so its size can never
// exceed the window ceiling and the window reset is the whole of its bookkeeping.
let windowStartedAt = 0;
let spentInWindow = 0;
const spentByClient = new Map<string, number>();
let cooldownUntil = 0;
let consecutiveFailures = 0;
let reopenOnNextFailure = false;

const rollWindowIfElapsed = (now: number): void => {
  if (now - windowStartedAt < WINDOW_MS) return;
  windowStartedAt = now;
  spentInWindow = 0;
  spentByClient.clear();
};

const openCooldown = (now: number, reason: string): void => {
  const { cooldownMs } = researchSearchQueryEmbeddingBudgetLimits();
  cooldownUntil = now + cooldownMs;
  consecutiveFailures = 0;
  reopenOnNextFailure = true;
  console.warn(
    `Research search query embedding paused for ${cooldownMs}ms (${reason}); serving the keyword leg.`,
  );
};

const normalizedClientKey = (clientKey?: string): string | undefined => {
  if (typeof clientKey !== 'string') return undefined;
  const trimmed = clientKey.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, 64);
};

/**
 * Claims one embedding call, or explains which bound refused it.
 *
 * The claim is taken before the call rather than after it succeeds, because a call
 * that fails has still spent the upstream capacity this exists to ration.
 *
 * The ceilings meter network callers, and the route always supplies a client key, so
 * a caller with no key is an operator-run in-process harness. Those are exempt: a
 * relevance or journey measurement that silently lost its semantic leg reads as a
 * corpus or lane change, which is a worse failure than the spend it would save. The
 * breaker still applies to them, because that tracks upstream health rather than
 * spend.
 */
export const reserveResearchSearchQueryEmbedding = (
  clientKey?: string,
  now: number = Date.now(),
): ResearchSearchQueryEmbeddingSpendDecision => {
  rollWindowIfElapsed(now);
  if (now < cooldownUntil) return 'cooling-down';

  const key = normalizedClientKey(clientKey);
  if (key === undefined) return 'allowed';

  const { maxPerWindow, maxPerClientPerWindow } = researchSearchQueryEmbeddingBudgetLimits();
  if (spentInWindow >= maxPerWindow) return 'window-ceiling';
  if ((spentByClient.get(key) ?? 0) >= maxPerClientPerWindow) return 'client-ceiling';

  spentInWindow += 1;
  spentByClient.set(key, (spentByClient.get(key) ?? 0) + 1);
  return 'allowed';
};

export const recordResearchSearchQueryEmbeddingSuccess = (): void => {
  consecutiveFailures = 0;
  reopenOnNextFailure = false;
};

/**
 * An upstream rejection is a direct instruction to stop, so it opens the cooldown on
 * its own. Any other failure only opens it once it repeats, because a single timeout
 * is not evidence that the next call will fail too. The exception is the first call
 * after a cooldown: until one succeeds, a failure there is the same outage
 * continuing, so it reopens the cooldown at once rather than letting another run of
 * searches each wait out the request timeout.
 */
export const recordResearchSearchQueryEmbeddingFailure = (
  kind: 'upstream-rejected' | 'error',
  now: number = Date.now(),
): void => {
  if (kind === 'upstream-rejected') {
    openCooldown(now, 'upstream rejected the request');
    return;
  }
  if (reopenOnNextFailure) {
    openCooldown(now, 'the first call after a cooldown failed');
    return;
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_COOLDOWN) {
    openCooldown(now, `${CONSECUTIVE_FAILURES_BEFORE_COOLDOWN} consecutive failures`);
  }
};

export const researchSearchQueryEmbeddingBudgetSnapshot = (now: number = Date.now()) => ({
  spentInWindow,
  trackedClients: spentByClient.size,
  coolingDown: now < cooldownUntil,
  consecutiveFailures,
});

export const resetResearchSearchQueryEmbeddingBudget = (): void => {
  windowStartedAt = 0;
  spentInWindow = 0;
  spentByClient.clear();
  cooldownUntil = 0;
  consecutiveFailures = 0;
  reopenOnNextFailure = false;
};
