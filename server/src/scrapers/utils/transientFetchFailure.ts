import { DEFAULT_RETRYABLE_STATUSES, HttpStatusError } from './httpFetch';
import { isNotObserved } from './notObserved';

const responseStatus = (error: unknown): number | undefined => {
  if (error instanceof HttpStatusError) return error.status;
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Whether a fetch failed for a reason that says nothing about the page being gone: anything
 * `isNotObserved` covers (a request our own code refused, a timeout, a dropped connection, a
 * lease another run holds), or a throttle or server error that outlasted its retries. A 403
 * counts as passing because rate-based WAFs answer throttling with it. A page that answered 404
 * or 410, refused the connection, was unreachable or refused TLS is gone rather than failing,
 * because a later run would meet the same refusal.
 */
export function isTransientFetchFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (isNotObserved(error)) return true;
  const status = responseStatus(error);
  return status !== undefined && DEFAULT_RETRYABLE_STATUSES.has(status);
}
