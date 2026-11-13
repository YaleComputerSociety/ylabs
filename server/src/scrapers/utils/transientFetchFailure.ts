import { DEFAULT_RETRYABLE_STATUSES, HttpStatusError } from './httpFetch';

const TRANSIENT_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
  'ERR_REQUEST_FAILED',
]);

const TRANSIENT_ERROR_NAMES: ReadonlySet<string> = new Set([
  'DevWriteLeaseHeldError',
  'DevWriteLeaseStoppedError',
  'DevWriteLeaseTimeoutError',
]);

const PERMANENTLY_BLOCKED_STATUS = 403;

const responseStatus = (error: unknown): number | undefined => {
  if (error instanceof HttpStatusError) return error.status;
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Whether a fetch failed for a reason that says nothing about the page: a throttle or server
 * error that outlasted its retries, a timeout or dropped connection, or a Development host lease
 * another run holds. A page that answered 403, 404 or 410, refused the connection, was unreachable
 * or refused TLS is gone rather than failing, because a later run would meet the same refusal.
 */
export function isTransientFetchFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (TRANSIENT_ERROR_NAMES.has((error as Error).name)) return true;
  const status = responseStatus(error);
  if (status !== undefined) return status !== PERMANENTLY_BLOCKED_STATUS && DEFAULT_RETRYABLE_STATUSES.has(status);
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_TRANSPORT_CODES.has(code);
}
