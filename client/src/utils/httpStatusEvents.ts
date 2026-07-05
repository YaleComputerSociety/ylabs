/**
 * Browser events emitted by the shared API client for app-wide HTTP handling.
 */
import { AxiosResponse } from 'axios';

export const AUTH_FAILURE_EVENT = 'ylabs:auth-failure';
export const RATE_LIMIT_EVENT = 'ylabs:rate-limit';

export type AuthFailureDetail = {
  status: 401;
  path?: string;
};

export type RateLimitDetail = {
  status: 429;
  message: string;
  retryAfterSeconds?: number;
  path?: string;
};

export type AuthFailureEvent = CustomEvent<AuthFailureDetail>;
export type RateLimitEvent = CustomEvent<RateLimitDetail>;

const getHeader = (response: AxiosResponse, name: string): string | undefined => {
  const headers = response.headers as AxiosResponse['headers'] & {
    get?: (headerName: string) => unknown;
  };
  const value = headers.get?.(name) ?? headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
};

const parseRetryAfterSeconds = (retryAfter?: string): number | undefined => {
  if (!retryAfter) return undefined;

  const retryAfterNumber = Number(retryAfter);
  if (Number.isFinite(retryAfterNumber)) {
    return Math.max(1, Math.ceil(retryAfterNumber));
  }

  const retryAfterDate = Date.parse(retryAfter);
  if (Number.isNaN(retryAfterDate)) return undefined;

  return Math.max(1, Math.ceil((retryAfterDate - Date.now()) / 1000));
};

export const getRateLimitDetail = (response: AxiosResponse): RateLimitDetail => {
  const data = response.data as {
    error?: unknown;
    message?: unknown;
    retryAfterSeconds?: unknown;
  };
  const retryAfterHeader = getHeader(response, 'retry-after');
  const bodyRetryAfter =
    typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : undefined;

  return {
    status: 429,
    message:
      (typeof data?.error === 'string' && data.error) ||
      (typeof data?.message === 'string' && data.message) ||
      'Too many requests. Please try again later.',
    retryAfterSeconds: bodyRetryAfter ?? parseRetryAfterSeconds(retryAfterHeader),
    path: response.config?.url,
  };
};

export const dispatchAuthFailure = (detail: AuthFailureDetail) => {
  window.dispatchEvent(new CustomEvent<AuthFailureDetail>(AUTH_FAILURE_EVENT, { detail }));
};

export const dispatchRateLimit = (detail: RateLimitDetail) => {
  window.dispatchEvent(new CustomEvent<RateLimitDetail>(RATE_LIMIT_EVENT, { detail }));
};
