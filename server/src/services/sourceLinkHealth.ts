import axios from 'axios';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../utils/ssrfGuard';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  isDepartmentRosterProvenanceUrl,
  isSharedPeopleRosterUrl,
} from '../utils/researchHomeWebsiteUrl';

export const sourceLinkHealthStatuses = [
  'HEALTHY',
  'REDIRECTED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;
export type SourceLinkHealthStatus = (typeof sourceLinkHealthStatuses)[number];

export interface SourceLinkHealth {
  healthStatus: SourceLinkHealthStatus;
  httpStatusCode?: number;
}

export interface SourceLinkProbeResult {
  status?: number;
  errorCode?: string;
  requestedUrl?: string;
  finalUrl?: string;
}

const DEAD_LINK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * Only a status that asserts the resource is gone retires a link. Every other
 * 4xx/5xx is a statement about the request or the server, not about whether the
 * page exists: 401/403 are access control, 429 is throttling, 5xx is an outage.
 * Recording those as UNAVAILABLE let a WAF or a bad afternoon retire a live
 * citation, which is the inverse of the standing rule that 403/429/5xx/timeout
 * are inconclusive and never retire a link or license a replacement (#2473).
 */
const RESOURCE_GONE_HTTP_STATUS_CODES = new Set([404, 410]);

/**
 * How long a probe verdict stays usable as a positive assertion of liveness. A
 * stale HEALTHY is worse than a missing one: serve-time suppression keys off
 * UNAVAILABLE, so an absent record fails open while a stale HEALTHY actively
 * asserts a now-404 page is fine. Past the horizon a verdict stops counting as
 * verification and the URL becomes eligible for a re-probe, but it is NOT
 * treated as dead - staleness means unknown, not gone.
 */
export const SOURCE_LINK_HEALTH_FRESHNESS_DAYS = 30;

const MILLISECONDS_PER_DAY = 86_400_000;

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_RETRY_DELAY_MS = 1_000;

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
  'ERR_REQUEST_FAILED',
]);

const comparablePath = (url: URL): string => url.pathname.replace(/\/+$/, '').toLowerCase() || '/';

const comparableHost = (url: URL): string => url.hostname.replace(/^www\./i, '').toLowerCase();

const parseProbeUrl = (value: string | undefined): URL | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

/**
 * A soft 404: the request returned 2xx, but the CMS answered a missing page by
 * redirecting somewhere that is not the requested resource instead of by status
 * code. `seas.yale.edu/faculty-research/faculty-directory/<person>` 200s and
 * lands on the engineering faculty-directory root - the person is gone, and
 * status alone reports the citation as live.
 *
 * Only a landing that loses the requested resource counts. An http-to-https
 * upgrade, a `www.` change, or a trailing-slash normalization is not a redirect
 * away from the page, and a genuine per-person move (`/people/<name>` to
 * `/profile/<name>`) still names the person, so neither is treated as dead.
 *
 * A landing on a bare host root only counts when it is the SAME host. Measured on
 * live data, requiring the same host is what separates deletion from migration:
 * 12 of the first 15 detections were research homes that had moved to their own
 * domain and were wrongly called dead - `www.yale.edu/lamoreauxgroup/` to
 * `lamoreauxgroup.yale.edu`, `www.yale.edu/pollard_lab/` to
 * `pollardlab.yale.edu`, `faculty.som.yale.edu/<person>` to a personal
 * `github.io` site. Those are the corpus catching up with a move, not a page
 * that stopped existing, and suppressing them hides a live research home.
 *
 * The shared-roster arm deliberately stays cross-host, because landing on a
 * roster is evidence about the PERSON rather than about the site: it is what
 * a CMS does when the individual is gone but the department is not.
 */
export function landsAwayFromRequestedResource(
  requestedUrl: string | undefined,
  finalUrl: string | undefined,
): boolean {
  const requested = parseProbeUrl(requestedUrl);
  const final = parseProbeUrl(finalUrl);
  if (!requested || !final) return false;

  const requestedPath = comparablePath(requested);
  const finalPath = comparablePath(final);
  const sameHost = comparableHost(requested) === comparableHost(final);
  if (requestedPath === finalPath && sameHost) return false;
  if (requestedPath === '/') return false;

  if (finalPath === '/') return sameHost;
  if (
    isSharedPeopleRosterUrl(final.toString()) ||
    isDepartmentRosterProvenanceUrl(final.toString())
  ) {
    return !isSharedPeopleRosterUrl(requested.toString());
  }
  return false;
}

export function classifySourceLinkHealth(probe: SourceLinkProbeResult): SourceLinkHealth {
  const { status, errorCode, requestedUrl, finalUrl } = probe;
  if (typeof status === 'number' && Number.isFinite(status)) {
    if (status >= 200 && status < 300) {
      if (landsAwayFromRequestedResource(requestedUrl, finalUrl)) {
        return { healthStatus: 'UNAVAILABLE', httpStatusCode: status };
      }
      return { healthStatus: 'HEALTHY', httpStatusCode: status };
    }
    if (status >= 300 && status < 400) {
      return { healthStatus: 'REDIRECTED', httpStatusCode: status };
    }
    if (RESOURCE_GONE_HTTP_STATUS_CODES.has(status)) {
      return { healthStatus: 'UNAVAILABLE', httpStatusCode: status };
    }
    return { healthStatus: 'UNKNOWN', httpStatusCode: status };
  }
  if (errorCode && DEAD_LINK_ERROR_CODES.has(errorCode)) {
    return { healthStatus: 'UNAVAILABLE' };
  }
  return { healthStatus: 'UNKNOWN' };
}

export function isLikelyUnavailableSourceLink(health: SourceLinkHealth | undefined): boolean {
  if (!health) return false;
  if (health.healthStatus === 'UNAVAILABLE') return true;
  return (
    typeof health.httpStatusCode === 'number' &&
    RESOURCE_GONE_HTTP_STATUS_CODES.has(health.httpStatusCode)
  );
}

export interface DatedSourceLinkHealth extends SourceLinkHealth {
  checkedAt?: Date | string | null;
}

/**
 * The key a stored verdict is looked up by. Scheme, `www.`, host case, and a
 * trailing slash are cosmetic; path and query are not. Mirrors
 * `sourceLinkCandidateKey` in the backfill lane so a verdict written under one
 * spelling is found under the other, which is the whole reason a shared key
 * exists rather than a per-caller comparison.
 */
export function sourceLinkHealthKey(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

/** The stored verdict for one URL, or undefined when the URL was never probed. */
export function findSourceLinkHealth(
  storedHealth: unknown,
  url: unknown,
): DatedSourceLinkHealth | undefined {
  const key = sourceLinkHealthKey(url);
  if (!key || !Array.isArray(storedHealth)) return undefined;
  const match = storedHealth.find(
    (entry) => sourceLinkHealthKey((entry as { url?: unknown })?.url) === key,
  ) as Record<string, unknown> | undefined;
  if (!match || typeof match.healthStatus !== 'string') return undefined;
  return {
    healthStatus: match.healthStatus as SourceLinkHealthStatus,
    ...(typeof match.httpStatusCode === 'number' ? { httpStatusCode: match.httpStatusCode } : {}),
    ...(match.checkedAt
      ? { checkedAt: match.checkedAt as DatedSourceLinkHealth['checkedAt'] }
      : {}),
  };
}

/**
 * Whether the corpus positively knows this URL is gone. Absence of a verdict is
 * not evidence of death, so an unprobed URL is never treated as dead - this
 * gates a way-in, and failing closed on silence would demote every entity whose
 * links have not been probed yet.
 */
export function isKnownDeadSourceUrl(storedHealth: unknown, url: unknown): boolean {
  return isLikelyUnavailableSourceLink(findSourceLinkHealth(storedHealth, url));
}

export function sourceLinkHealthAgeDays(
  health: DatedSourceLinkHealth | undefined,
  now: Date = new Date(),
): number | undefined {
  if (!health?.checkedAt) return undefined;
  const checkedAt =
    health.checkedAt instanceof Date ? health.checkedAt : new Date(health.checkedAt);
  const elapsed = now.getTime() - checkedAt.getTime();
  if (!Number.isFinite(elapsed)) return undefined;
  return elapsed / MILLISECONDS_PER_DAY;
}

/**
 * A verdict with no `checkedAt` is stale by definition: it cannot be dated, so
 * it cannot be trusted as current.
 */
export function isStaleSourceLinkHealth(
  health: DatedSourceLinkHealth | undefined,
  now: Date = new Date(),
): boolean {
  if (!health) return false;
  const ageDays = sourceLinkHealthAgeDays(health, now);
  if (ageDays === undefined) return true;
  return ageDays > SOURCE_LINK_HEALTH_FRESHNESS_DAYS;
}

/**
 * Whether the corpus can currently prove this link resolves. Requires a
 * reachable verdict AND a fresh one, so nothing may cite a months-old probe as
 * evidence that a way in still works. Deliberately not the negation of
 * `isLikelyUnavailableSourceLink`: an inconclusive or stale verdict is neither
 * verified-reachable nor dead, and the two predicates answer different
 * questions - suppress a known-dead CTA versus count a proven route.
 */
export function isVerifiedReachableSourceLink(
  health: DatedSourceLinkHealth | undefined,
  now: Date = new Date(),
): boolean {
  if (!health) return false;
  if (health.healthStatus !== 'HEALTHY' && health.healthStatus !== 'REDIRECTED') return false;
  return !isStaleSourceLinkHealth(health, now);
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function probeSourceLink(url: string): Promise<SourceLinkProbeResult> {
  let safeUrl: URL;
  try {
    safeUrl = await assertPublicHttpUrl(url);
  } catch {
    return { errorCode: 'ERR_SSRF_BLOCKED' };
  }

  const requestedUrl = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const request = (method: 'HEAD' | 'GET') =>
    axios.request({
      url: requestedUrl,
      method,
      maxRedirects: 5,
      timeout: PROBE_TIMEOUT_MS,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      responseType: method === 'GET' ? 'stream' : 'json',
      validateStatus: () => true,
    });

  // `responseUrl`, lower-case `u`, is what `follow-redirects` sets on the Node
  // IncomingMessage. `responseURL` is the browser XHR spelling and is ALWAYS
  // undefined here, which silently made soft-404 detection inert on real data:
  // every probe reported no landing url, so `landsAwayFromRequestedResource`
  // could never fire and 0 soft-404s were found corpus-wide. Do not "correct"
  // this back to the upper-case spelling.
  const resolvedUrl = (response: unknown): string | undefined => {
    const typed = response as {
      request?: {
        res?: { responseUrl?: unknown };
        _redirectable?: { _currentUrl?: unknown };
      };
    };
    const candidates = [
      typed?.request?.res?.responseUrl,
      typed?.request?._redirectable?._currentUrl,
    ];
    return candidates.find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
    );
  };

  const attempt = async (): Promise<SourceLinkProbeResult> => {
    try {
      let response = await request('HEAD');
      if (response.status >= 400) {
        response = await request('GET');
        if (response.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
      }
      return {
        status: response.status,
        requestedUrl,
        ...(resolvedUrl(response) ? { finalUrl: resolvedUrl(response) } : {}),
      };
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      void sanitizeLogValue(error);
      return {
        errorCode: typeof code === 'string' ? code : 'ERR_REQUEST_FAILED',
        requestedUrl,
      };
    }
  };

  // A single 7s attempt turned slow legacy academic hosts into UNKNOWN verdicts
  // that a direct probe showed were live, so a transport failure is retried once
  // before it is recorded (#2473).
  const first = await attempt();
  if (!first.errorCode || !RETRYABLE_ERROR_CODES.has(first.errorCode)) return first;
  await delay(PROBE_RETRY_DELAY_MS);
  return attempt();
}

export async function checkSourceLinkHealth(url: string): Promise<SourceLinkHealth> {
  return classifySourceLinkHealth(await probeSourceLink(url));
}
