import { isRefusedBeforeSending } from './httpFetch';
import { ALLOW_ALL_ROBOTS_POLICY, parseRobotsTxt, type RobotsPolicy } from './robotsTxt';

export const ROBOTS_POLICY_TTL_MS = 24 * 60 * 60_000;
export const ROBOTS_UNAVAILABLE_TTL_MS = 60 * 60_000;

export type RobotsTxtFetchOutcome = { status: number; body: string } | { error: unknown };

/** Fetches `https://<host>/robots.txt` once; injected so this module sends nothing itself. */
export type RobotsTxtFetcher = (host: string) => Promise<RobotsTxtFetchOutcome>;

interface CachedPolicy {
  policy: RobotsPolicy;
  expiresAt: number;
}

/**
 * Each host's robots.txt policy, read at most once a day. Process-local; `robotsFetchHook.ts`
 * reads it from the single fetch-hook install point and records the Crawl-delay into the shared
 * per-host budget (#6168, #6193, #6213).
 */
const cache = new Map<string, CachedPolicy>();
const pending = new Map<string, Promise<RobotsPolicy>>();

/**
 * A robots.txt that answered with content is read. One that is missing (4xx) allows everything,
 * as RFC 9309 says. Any other failure (a 5xx, 429, timeout or refused connection) is not a
 * refusal of the site: it falls back to allowing everything at default pacing, and is asked again
 * in an hour rather than a day.
 */
function policyFromOutcome(outcome: RobotsTxtFetchOutcome): {
  policy: RobotsPolicy;
  ttlMs: number;
} {
  if ('error' in outcome) {
    return {
      policy: { ...ALLOW_ALL_ROBOTS_POLICY, unavailable: true },
      ttlMs: ROBOTS_UNAVAILABLE_TTL_MS,
    };
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    return { policy: parseRobotsTxt(outcome.body), ttlMs: ROBOTS_POLICY_TTL_MS };
  }
  if (outcome.status >= 400 && outcome.status < 500 && outcome.status !== 429) {
    return { policy: ALLOW_ALL_ROBOTS_POLICY, ttlMs: ROBOTS_POLICY_TTL_MS };
  }
  return {
    policy: { ...ALLOW_ALL_ROBOTS_POLICY, unavailable: true },
    ttlMs: ROBOTS_UNAVAILABLE_TTL_MS,
  };
}

export async function robotsPolicyFor(
  host: string,
  fetchRobotsTxt: RobotsTxtFetcher,
  now: () => number = Date.now,
): Promise<RobotsPolicy> {
  const key = host.trim().toLowerCase().replace(/\.$/, '');
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return cached.policy;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const read = (async () => {
    let outcome: RobotsTxtFetchOutcome;
    try {
      outcome = await fetchRobotsTxt(host);
    } catch (error) {
      outcome = { error };
    }
    if ('error' in outcome && isRefusedBeforeSending(outcome.error)) throw outcome.error;
    const { policy, ttlMs } = policyFromOutcome(outcome);
    cache.set(key, { policy, expiresAt: now() + ttlMs });
    return policy;
  })().finally(() => pending.delete(key));
  pending.set(key, read);
  return read;
}

export function resetRobotsPolicyCacheForTests(): void {
  cache.clear();
  pending.clear();
}
