import { useEffect, useState } from 'react';
import {
  HTTP_AUTH_REQUIRED_EVENT,
  HTTP_RATE_LIMITED_EVENT,
  type HttpRateLimitDetail,
} from '../utils/httpStatusEvents';

const HttpStatusNotifier = () => {
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onAuthRequired = () => {
      setMessage('Your session needs a fresh login.');
    };
    const onRateLimited = (event: Event) => {
      const detail = (event as CustomEvent<HttpRateLimitDetail>).detail;
      const retry =
        detail?.retryAfterSeconds && detail.retryAfterSeconds > 0
          ? ` Try again in about ${detail.retryAfterSeconds} seconds.`
          : '';
      setMessage(`${detail?.message || 'Too many requests.'}${retry}`);
    };

    window.addEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
    window.addEventListener(HTTP_RATE_LIMITED_EVENT, onRateLimited);
    return () => {
      window.removeEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
      window.removeEventListener(HTTP_RATE_LIMITED_EVENT, onRateLimited);
    };
  }, []);

  if (!message) return null;

  return (
    <div className="mx-auto mt-3 w-full max-w-5xl px-4">
      <div
        role="status"
        className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <span>{message}</span>
        <button
          type="button"
          className="ml-3 font-semibold underline"
          onClick={() => setMessage('')}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default HttpStatusNotifier;
