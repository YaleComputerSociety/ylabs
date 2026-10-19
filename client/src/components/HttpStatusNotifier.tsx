import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  HTTP_AUTH_REQUIRED_EVENT,
  HTTP_RATE_LIMITED_EVENT,
  PAGE_LOGIN_PROMPT_EVENT,
  type HttpRateLimitDetail,
  type PageLoginPromptDetail,
} from '../utils/httpStatusEvents';

type Notice = { kind: 'auth' } | { kind: 'rate-limit'; message: string };

const HttpStatusNotifier = () => {
  const location = useLocation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pageShowsLoginPrompt, setPageShowsLoginPrompt] = useState(false);

  useEffect(() => {
    const onAuthRequired = () => {
      setNotice({ kind: 'auth' });
    };
    const onRateLimited = (event: Event) => {
      const detail = (event as CustomEvent<HttpRateLimitDetail>).detail;
      const retry =
        detail?.retryAfterSeconds && detail.retryAfterSeconds > 0
          ? ` Try again in about ${detail.retryAfterSeconds} seconds.`
          : '';
      setNotice({
        kind: 'rate-limit',
        message: `${detail?.message || 'Too many requests.'}${retry}`,
      });
    };
    const onPageLoginPrompt = (event: Event) => {
      const shown = (event as CustomEvent<PageLoginPromptDetail>).detail?.shown === true;
      setPageShowsLoginPrompt(shown);
      if (shown) setNotice((current) => (current?.kind === 'auth' ? null : current));
    };

    window.addEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
    window.addEventListener(HTTP_RATE_LIMITED_EVENT, onRateLimited);
    window.addEventListener(PAGE_LOGIN_PROMPT_EVENT, onPageLoginPrompt);
    return () => {
      window.removeEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
      window.removeEventListener(HTTP_RATE_LIMITED_EVENT, onRateLimited);
      window.removeEventListener(PAGE_LOGIN_PROMPT_EVENT, onPageLoginPrompt);
    };
  }, []);

  if (!notice || (notice.kind === 'auth' && pageShowsLoginPrompt)) return null;

  return (
    <div className="mx-auto mt-3 w-full max-w-5xl px-4">
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
      >
        <span>{notice.kind === 'auth' ? 'Your session needs a fresh login.' : notice.message}</span>
        {notice.kind === 'auth' && (
          <Link
            to="/login"
            state={{ from: `${location.pathname}${location.search}` }}
            onClick={() => setNotice(null)}
            className="inline-flex min-h-11 items-center font-semibold underline yr-focus-ring"
          >
            Log in again
          </Link>
        )}
        <button
          type="button"
          className="inline-flex min-h-11 items-center font-semibold underline yr-focus-ring"
          onClick={() => setNotice(null)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default HttpStatusNotifier;
