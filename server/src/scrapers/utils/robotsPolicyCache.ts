import { isSsrfGuardRefusal } from '../../utils/ssrfGuard';
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

export const robotsPolicyHostKey = (host: string): string =>
  host.trim().toLowerCase().replace(/\.$/, '');

/**
 * The policy already read for a host, without reading it again. For a request that must not send
 * a robots.txt read of its own, such as a subresource of a render that already holds the host's
 * only slot (#6340): the render's seed check read the policy before it took that slot.
 */
export function cachedRobotsPolicy(
  host: string,
  now: () => number = Date.now,
): RobotsPolicy | undefined {
  const cached = cache.get(robotsPolicyHostKey(host));
  return cached && cached.expiresAt > now() ? cached.policy : undefined;
}

export async function robotsPolicyFor(
  host: string,
  fetchRobotsTxt: RobotsTxtFetcher,
  now: () => number = Date.now,
): Promise<RobotsPolicy> {
  const key = robotsPolicyHostKey(host);
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
    // A pause, budget or slot refusal would refuse the page too, so the page takes it. An SSRF
    // refusal of the robots.txt read only means robots.txt could not be read: the page's own SSRF
    // guard still decides the page, so it falls back to default pacing like any unreadable file.
    if (
      'error' in outcome &&
      isRefusedBeforeSending(outcome.error) &&
      !isSsrfGuardRefusal(outcome.error)
    ) {
      throw outcome.error;
    }
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
