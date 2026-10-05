import { sanitizeLogValue } from '../../utils/logSanitizer';

export function fetchFailureStatusCode(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

export function fetchFailureMessage(err: unknown): string {
  return sanitizeLogValue(err instanceof Error ? err.message : err);
}
