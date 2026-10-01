const MAX_CLIENT_ERROR_MESSAGE_LENGTH = 160;
const PRINTABLE_CLIENT_ERROR_RE = /^[A-Za-z0-9][A-Za-z0-9 .,'":;!?()/_-]{0,159}$/;
const SENSITIVE_CLIENT_ERROR_RE =
  /(?:https?:\/\/|mongodb(?:\+srv)?:\/\/|bearer\s+|token|secret|password|authorization|cookie|set-cookie|[A-Fa-f0-9]{24}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:^|\n)\s*at\s+\S+\s+\()/i;

const safeClientErrorText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLIENT_ERROR_MESSAGE_LENGTH) return '';
  if (!PRINTABLE_CLIENT_ERROR_RE.test(trimmed)) return '';
  if (SENSITIVE_CLIENT_ERROR_RE.test(trimmed)) return '';
  return trimmed;
};

type ErrorResponse = { status?: unknown; data?: Record<string, unknown> };

const isServerErrorStatus = (status: unknown): boolean =>
  typeof status === 'number' && status >= 500;

/**
 * Whether the server said the request failed because a dependency is unavailable
 * and the same request is worth retrying shortly. The server answers 503 for a
 * database it could not reach (#4188), which is a different thing from a broken
 * request and must not be presented as an empty result.
 */
export const isRetryableUnavailableError = (error: unknown): boolean =>
  (error as { response?: ErrorResponse })?.response?.status === 503;

export const clientErrorMessage = (error: unknown, fallback: string): string => {
  const errorResponse = (error as { response?: ErrorResponse })?.response;
  if (isServerErrorStatus(errorResponse?.status)) return fallback;
  const responseData = errorResponse?.data;
  return (
    safeClientErrorText(responseData?.error) ||
    safeClientErrorText(responseData?.message) ||
    fallback
  );
};
