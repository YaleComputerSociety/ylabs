import { DEFAULT_RETRYABLE_STATUSES, HttpStatusError } from './httpFetch';
import { isNotObserved } from './notObserved';

const responseStatus = (error: unknown): number | undefined => {
  if (error instanceof HttpStatusError) return error.status;
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
};

export function isTransientFetchFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (isNotObserved(error)) return true;
  const status = responseStatus(error);
  return status !== undefined && DEFAULT_RETRYABLE_STATUSES.has(status);
}
