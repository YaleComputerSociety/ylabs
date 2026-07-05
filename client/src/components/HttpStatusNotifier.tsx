/**
 * App-wide notification surface for HTTP conditions that need consistent UX.
 */
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';

import { RATE_LIMIT_EVENT, RateLimitEvent } from '../utils/httpStatusEvents';

const formatRetryAfter = (seconds?: number) => {
  if (!seconds) return undefined;
  if (seconds < 60) return `Try again in about ${seconds} second${seconds === 1 ? '' : 's'}.`;

  const minutes = Math.ceil(seconds / 60);
  return `Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
};

const HttpStatusNotifier = () => {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleRateLimit = (event: Event) => {
      const detail = (event as RateLimitEvent).detail;
      const retryMessage = formatRetryAfter(detail.retryAfterSeconds);
      setMessage([detail.message, retryMessage].filter(Boolean).join(' '));
    };

    window.addEventListener(RATE_LIMIT_EVENT, handleRateLimit as EventListener);
    return () => {
      window.removeEventListener(RATE_LIMIT_EVENT, handleRateLimit as EventListener);
    };
  }, []);

  return (
    <Snackbar
      open={Boolean(message)}
      autoHideDuration={9000}
      onClose={() => setMessage(null)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert severity="warning" variant="filled" onClose={() => setMessage(null)}>
        {message}
      </Alert>
    </Snackbar>
  );
};

export default HttpStatusNotifier;
