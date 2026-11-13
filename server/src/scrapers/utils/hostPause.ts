import { normalizeExcludedHost } from '../../utils/excludedHosts';
import { hostPausedUntil, recordHostBackoff } from './hostPauseState';

/**
 * A host refusing the lane is rate limiting it, never a verdict on the host (owner decision,
 * 2026-11-13): the lane backs off and comes back. Two tiers. A request first spends its own quick
 * retries, which hosts measured to refuse at random need (#4466). A 429 or 503, a refusal that
 * outlasts those retries, or a site's own stated date then pauses the whole host through the one
 * per-host record in `hostPauseState.ts`, while other hosts keep running.
 */
export const HOST_PAUSE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

/**
 * Marks a request the policy fetch sends, so the scrape CLI's axios interceptor leaves recording
 * that response's refusal or success to the policy fetch and a host is never counted twice.
 */
export const HOST_PAUSE_POLICY_FETCH = '__ylabsHostPausePolicyFetch';

export interface HostPause {
  host: string;
  until: Date;
}

const STATED_PAUSE_RE = /\b(?:banned|blocked)\s+(?:up\s+to|until)\b([^<\n]{0,120})/i;
const UNREADABLE_STATED_DATE_DEFAULT_MS = 24 * 60 * 60_000;
const EXPLICIT_ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC)\b)$/i;
const ISO_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/**
 * The date a site's refusal notice gives, read as UTC when it names no zone, because a server's notice is
 * never in this machine's local time. Returns undefined when nothing date-like survives.
 */
function statedDate(raw: string): Date | undefined {
  const text = raw
    .split(/\.\s/)[0]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!]+$/, '')
    .trim();
  if (!text) return undefined;
  const isoLocal = ISO_LOCAL_RE.exec(text);
  const candidate = isoLocal
    ? `${isoLocal[1]}T${isoLocal[2]}Z`
    : EXPLICIT_ZONE_RE.test(text)
      ? text
      : `${text} UTC`;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
const MAX_NOTICE_BODY_CHARS = 4_096;

const headerValue = (headers: unknown, name: string): string | undefined => {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: (key: string) => unknown }).get;
  const direct =
    typeof getter === 'function'
      ? getter.call(headers, name)
      : ((headers as Record<string, unknown>)[name] ??
        (headers as Record<string, unknown>)[name.toLowerCase()]);
  return typeof direct === 'string' ? direct : undefined;
};

function retryAfterUntil(value: string | undefined, now: Date): Date | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  const until = Number.isFinite(seconds)
    ? new Date(now.getTime() + seconds * 1000)
    : new Date(value.trim());
  return Number.isNaN(until.getTime()) ? undefined : until;
}

/** A Retry-After header as milliseconds from now, from either its seconds or its date form. */
export function retryAfterMsFromHeaders(
  headers: unknown,
  now: Date = new Date(),
): number | undefined {
  const until = retryAfterUntil(headerValue(headers, 'retry-after'), now);
  return until ? Math.max(0, until.getTime() - now.getTime()) : undefined;
}

/**
 * The date a refusal says the host will answer again ("banned up to <date>", "blocked until
 * <date>"), read so it fails closed: a recognised notice whose date cannot be read pauses for a
 * day rather than being retried at once. A date already past states nothing.
 */
export function statedPauseUntil(body: unknown, now: Date = new Date()): Date | undefined {
  const text = typeof body === 'string' ? body.slice(0, MAX_NOTICE_BODY_CHARS) : '';
  const notice = STATED_PAUSE_RE.exec(text);
  if (!notice) return undefined;
  const until = statedDate(notice[1]);
  if (!until) return new Date(now.getTime() + UNREADABLE_STATED_DATE_DEFAULT_MS);
  return until > now ? until : undefined;
}

/**
 * Records a response that pauses its host at once: a site's stated date, or a 429 or 503 that
 * asks for longer than the request's own quick retries would wait (`quickRetryWaitMs`). A shorter
 * 429 or 503, and any other refusal, is left to those quick retries and paused only once they run
 * out (`recordTierOneExhausted`). A caller with no quick retries of its own passes no
 * `quickRetryWaitMs`, so every 429 or 503 pauses the host.
 */
export function recordHostRefusal(input: {
  host: string;
  status: number;
  headers?: unknown;
  body?: unknown;
  retryAfterMs?: number;
  quickRetryWaitMs?: number;
}): HostPause | undefined {
  if (!input.host) return undefined;
  const statedUntil = input.status === 403 ? statedPauseUntil(input.body) : undefined;
  const retryAfterMs = input.retryAfterMs ?? retryAfterMsFromHeaders(input.headers);
  const outlastsQuickRetries =
    HOST_PAUSE_STATUSES.has(input.status) &&
    (input.quickRetryWaitMs === undefined || (retryAfterMs ?? 0) > input.quickRetryWaitMs);
  if (!statedUntil && !outlastsQuickRetries) return undefined;
  recordHostBackoff(normalizeExcludedHost(input.host), {
    status: input.status,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(statedUntil ? { statedUntil } : {}),
  });
  return activeHostPause(input.host);
}

export function recordTierOneExhausted(host: string, status: number, retryAfterMs?: number): void {
  if (!host) return;
  recordHostBackoff(normalizeExcludedHost(host), {
    status,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

/**
 * The pause on exactly this host, `www.` and a trailing dot aside. Never a parent's or a
 * subdomain's: each Yale school and department is its own server with its own rate limit, so one
 * throttled host must not stop the others (a parent rule would let one 429 from www.yale.edu pause
 * every school). Only an operator's explicit `--exclude-host` covers subdomains.
 */
export function activeHostPause(host: string | undefined): HostPause | undefined {
  if (!host) return undefined;
  const key = normalizeExcludedHost(host);
  if (!key) return undefined;
  const until = hostPausedUntil(key);
  return until ? { host: key, until } : undefined;
}

export class HostPausedError extends Error {
  constructor(
    readonly pause: HostPause,
    readonly requestSent = false,
  ) {
    super(
      `${pause.host} is pausing this run's requests until ${pause.until.toISOString()} after refusing them; the run comes back to it then.`,
    );
    this.name = 'HostPausedError';
  }
}

/**
 * A follow-redirects `beforeRedirect` hook: a hop into a paused host is not sent, so a redirect
 * cannot carry a request past the pause. Chains an existing hook rather than replacing it.
 */
export function refuseRedirectIntoPausedHost(
  existing?: (options: Record<string, unknown>, responseDetails: unknown) => void,
): (options: Record<string, unknown>, responseDetails: unknown) => void {
  return (options, responseDetails) => {
    const pause = activeHostPause(
      typeof options?.hostname === 'string' ? options.hostname : undefined,
    );
    if (pause) throw new HostPausedError(pause);
    existing?.(options, responseDetails);
  };
}

/** The pause refusal inside an error, which axios wraps twice when a redirect hook threw it. */
export function hostPauseInErrorChain(error: unknown): HostPausedError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof HostPausedError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function describeHostPauses(pauses: Iterable<HostPause>): string {
  const latest = new Map<string, Date>();
  for (const { host, until } of pauses) {
    const known = latest.get(host);
    if (!known || known < until) latest.set(host, until);
  }
  return [...latest]
    .sort(([hostA], [hostB]) => hostA.localeCompare(hostB))
    .map(([host, until]) => `${host} resumes at ${until.toISOString()}`)
    .join(', ');
}
