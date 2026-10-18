export const HTTP_AUTH_REQUIRED_EVENT = 'ylabs:http-auth-required';
export const HTTP_RATE_LIMITED_EVENT = 'ylabs:http-rate-limited';

export interface HttpRateLimitDetail {
  message: string;
  retryAfterSeconds?: number;
}

export const dispatchAuthRequired = () => {
  window.dispatchEvent(new CustomEvent(HTTP_AUTH_REQUIRED_EVENT));
};

export const dispatchRateLimited = (detail: HttpRateLimitDetail) => {
  window.dispatchEvent(new CustomEvent(HTTP_RATE_LIMITED_EVENT, { detail }));
};

export const dispatchHttpStatusEvent = (
  status: number | undefined,
  retryAfterHeader: string | null | undefined,
  data?: { error?: string; retryAfterSeconds?: number },
) => {
  if (typeof window === 'undefined') return;
  if (status === 401) dispatchAuthRequired();
  if (status === 429) {
    const retryAfterSeconds =
      retryAfterHeader != null && Number.isFinite(Number(retryAfterHeader))
        ? Number(retryAfterHeader)
        : data?.retryAfterSeconds;
    dispatchRateLimited({ message: data?.error || 'Too many requests.', retryAfterSeconds });
  }
};
