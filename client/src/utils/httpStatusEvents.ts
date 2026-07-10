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
