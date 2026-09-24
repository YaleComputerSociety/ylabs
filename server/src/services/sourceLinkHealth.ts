import axios from 'axios';
import { assertPublicHttpUrl, SsrfBlockedError, ssrfSafeAgents } from '../utils/ssrfGuard';
import { DEFAULT_RETRYABLE_STATUSES } from '../scrapers/utils/httpFetch';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  isDepartmentRosterProvenanceUrl,
  isSharedPeopleRosterUrl,
} from '../utils/researchHomeWebsiteUrl';
import {
  sourceLinkHealthStatuses,
  type SourceLinkHealthStatus,
} from '../models/storedVocabularies';

export { sourceLinkHealthStatuses, type SourceLinkHealthStatus };

export interface SourceLinkHealth {
  healthStatus: SourceLinkHealthStatus;
  httpStatusCode?: number;
  /**
   * The host resolves only into private address space, so nothing outside Yale's
   * network can route to it. A SECOND axis, deliberately independent of
   * `healthStatus`: the page may well exist and answer, and we never fetched it,
   * so the status axis stays `UNKNOWN`. Collapsing the two is what made a link a
   * student cannot open read as a verified way in (#2556).
   */
  privateAddressHost?: boolean;
}

export interface SourceLinkProbeResult {
  status?: number;
  errorCode?: string;
  requestedUrl?: string;
  finalUrl?: string;
  /** `Retry-After` the host asked for, when it sent one. Never a verdict input. */
  retryAfterMs?: number;
  privateAddressHost?: boolean;
}

/**
 * A transport error retires a link only when it asserts the resource is gone, the
 * same test `RESOURCE_GONE_HTTP_STATUS_CODES` applies to status codes.
 *
 * `ERR_TLS_CERT_ALTNAME_INVALID` deliberately is NOT here. A certificate that does
 * not cover the requested hostname describes how the server presents itself on
 * port 443, never whether the page exists, and no retry can change that. It was
 * listed, and on Development it retired six live Yale vanity hosts that answer
 * `200` over plain HTTP and redirect to a canonical HTTPS page, three of them on
 * `student_ready` rows (#2751).
 *
 * The three reachability codes that remain say a host did not accept a connection
 * on this attempt, which can be a retired service or a bad minute, so they are in
 * `RETRYABLE_ERROR_CODES` and only reach this set once a second attempt agrees -
 * the same confirm-before-recording rule #2725 established for DNS.
 */
const DEAD_LINK_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

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

/**
 * A throttled response arrives as a STATUS, not an error code, so the transport
 * retry above never saw it: the first 403 became the verdict. One sustained wave
 * from a single host turned 353 verdicts into UNKNOWN in one pass (#2762), and the
 * pass reported success having learned nothing about them (#2766).
 *
 * `DEFAULT_RETRYABLE_STATUSES` is reused rather than restated so the probe and the
 * scraper fetch cannot drift on which statuses mean "ask again".
 *
 * This deliberately does NOT route through `fetchPageWithPolicy`, which the issue
 * originally proposed: that helper throws on any non-2xx, discarding the status,
 * and this probe needs 404 as DATA to classify a page as gone. What was missing
 * was the retry policy, not the request.
 */
const PROBE_MAX_STATUS_RETRIES = 3;
const PROBE_STATUS_BACKOFF_BASE_MS = 1_000;
const PROBE_STATUS_BACKOFF_MAX_MS = 8_000;

function retryAfterMs(headers: unknown): number | undefined {
  const raw = (headers as Record<string, unknown> | undefined)?.['retry-after'];
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function probeStatusBackoffMs(
  attempt: number,
  retryAfter?: number,
  jitter: () => number = Math.random,
): number {
  if (retryAfter !== undefined) return Math.min(retryAfter, PROBE_STATUS_BACKOFF_MAX_MS);
  const exponential = PROBE_STATUS_BACKOFF_BASE_MS * 2 ** attempt;
  return Math.min(
    PROBE_STATUS_BACKOFF_MAX_MS,
    exponential + Math.floor(jitter() * PROBE_STATUS_BACKOFF_BASE_MS),
  );
}

/**
 * The three reachability codes are retried for a different reason than the rest:
 * not because a retry might succeed, but because recording them is destructive.
 * A refused or unreachable host on one attempt is indistinguishable from a
 * retired service, so requiring a second attempt to agree is what keeps a bad
 * minute from retiring a live citation (#2751, the rule #2725 set for DNS).
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
  'ERR_REQUEST_FAILED',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
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

function classifyProbeOutcome(probe: SourceLinkProbeResult): SourceLinkHealth {
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

export function classifySourceLinkHealth(probe: SourceLinkProbeResult): SourceLinkHealth {
  const outcome = classifyProbeOutcome(probe);
  return probe.privateAddressHost ? { ...outcome, privateAddressHost: true } : outcome;
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
    ...(match.privateAddressHost === true ? { privateAddressHost: true } : {}),
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

export function isPrivateAddressOnlySourceLink(health: SourceLinkHealth | undefined): boolean {
  return health?.privateAddressHost === true;
}

/**
 * Whether the corpus positively knows this URL's host resolves only into private
 * address space. Unlike a liveness verdict this never expires and never needs a
 * fetch, because it is a fact about addressing rather than about the page, and
 * unlike `isKnownDeadSourceUrl` it makes no claim that the page is gone.
 */
export function isPrivateAddressOnlySourceUrl(storedHealth: unknown, url: unknown): boolean {
  return isPrivateAddressOnlySourceLink(findSourceLinkHealth(storedHealth, url));
}

/**
 * Whether this citation can be a way in for the audience the product has, which
 * is a student who is not on the Yale network. Two independent facts disqualify
 * one: the corpus knows the page is gone, or it knows nothing off campus can
 * route to the host.
 *
 * Fails open on silence exactly as `isKnownDeadSourceUrl` does, so an unprobed
 * citation still counts and nothing is demoted for want of a measurement.
 */
export function isPubliclyUnreachableSourceUrl(storedHealth: unknown, url: unknown): boolean {
  return (
    isKnownDeadSourceUrl(storedHealth, url) || isPrivateAddressOnlySourceUrl(storedHealth, url)
  );
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

/**
 * The SSRF guard runs before any request, so its refusal is the only signal a
 * non-resolving host ever produces: axios never runs and never raises
 * `ENOTFOUND`. Mapping the guard's `unresolvable` reason onto that code is what
 * makes the existing `DEAD_LINK_ERROR_CODES` branch reachable at all (#2709).
 * Every other refusal stays `ERR_SSRF_BLOCKED` and therefore inconclusive,
 * because a private address is a fact about our network position rather than
 * about whether the page exists.
 *
 * That inconclusiveness is not the whole of what the guard learned, though. A
 * `private-address` refusal is a positive, durable fact about addressing, and
 * discarding it left the verdict indistinguishable from a throttled request, so a
 * host only Yale's network can route to counted as a way in for a student off
 * campus (#2556). It is reported alongside the code rather than instead of it, so
 * the security answer is unchanged.
 */
function probeResultForBlockedUrl(error: unknown): SourceLinkProbeResult {
  const errorCode =
    error instanceof SsrfBlockedError && error.reason === 'unresolvable'
      ? 'ENOTFOUND'
      : 'ERR_SSRF_BLOCKED';
  const privateAddressHost =
    error instanceof SsrfBlockedError && error.reason === 'private-address';
  return { errorCode, ...(privateAddressHost ? { privateAddressHost: true } : {}) };
}

export async function probeSourceLink(url: string): Promise<SourceLinkProbeResult> {
  let safeUrl: URL;
  try {
    safeUrl = await assertPublicHttpUrl(url);
  } catch (error) {
    return probeResultForBlockedUrl(error);
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
        ...(retryAfterMs(response.headers) !== undefined
          ? { retryAfterMs: retryAfterMs(response.headers) }
          : {}),
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
  let result = await attempt();
  if (result.errorCode && RETRYABLE_ERROR_CODES.has(result.errorCode)) {
    await delay(PROBE_RETRY_DELAY_MS);
    result = await attempt();
  }

  // A throttled or transiently failing STATUS is asked again with backoff, honouring
  // Retry-After when the host sends one. A status that asserts the page is gone is
  // never retried, so a 404 still settles on the first answer.
  for (let attemptIndex = 0; attemptIndex < PROBE_MAX_STATUS_RETRIES; attemptIndex += 1) {
    if (result.status === undefined || !DEFAULT_RETRYABLE_STATUSES.has(result.status)) break;
    await delay(probeStatusBackoffMs(attemptIndex, result.retryAfterMs));
    result = await attempt();
  }
  return result;
}

export async function checkSourceLinkHealth(url: string): Promise<SourceLinkHealth> {
  return classifySourceLinkHealth(await probeSourceLink(url));
}

/**
 * Whether an entity retains at least one citation that is not known dead, counting
 * both `sourceUrls` and the provenance fallback the visibility gate relies on.
 *
 * `missing_source_url` is a soft signal because an empty `sourceUrls` is normally a
 * projection gap the materializer closes, with provenance still holding the real
 * source. That premise assumes the provenance source exists, not that it resolves.
 * On Development six `student_ready` rows had zero `sourceUrls` and provenance
 * pointing only at 404s, so the escape hatch published entities with no live
 * evidence anywhere (#2635).
 *
 * Fails OPEN on silence twice over, matching `isKnownDeadSourceUrl`: a citation
 * nobody has probed counts as live, and having no citation at all is the #1802
 * projection gap rather than evidence of death. Only an explicit gone verdict on
 * every citation the entity actually has returns false.
 */
export function hasLiveSourceCitation(entity: {
  sourceUrls?: unknown;
  fieldProvenance?: unknown;
  sourceLinkHealth?: unknown;
}): boolean {
  const stored = Array.isArray(entity.sourceUrls)
    ? entity.sourceUrls.filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    : [];
  const provenance =
    entity.fieldProvenance && typeof entity.fieldProvenance === 'object'
      ? Object.values(entity.fieldProvenance as Record<string, unknown>)
          .map((record) =>
            record && typeof record === 'object'
              ? (record as { sourceUrl?: unknown }).sourceUrl
              : undefined,
          )
          .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
      : [];
  const citations = [...new Set([...stored, ...provenance])];
  // No citation at all is SILENCE, not death. An empty `sourceUrls` with no
  // provenance is the projection gap #1802 relies on, so it must stay soft; only
  // an explicit gone verdict on every citation an entity actually has is evidence
  // that nothing stands behind the card.
  if (citations.length === 0) return true;
  return citations.some((url) => !isKnownDeadSourceUrl(entity.sourceLinkHealth, url));
}
