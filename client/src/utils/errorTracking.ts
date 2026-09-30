import type * as SentryModule from '@sentry/react';

import { scrubBreadcrumb, scrubErrorEvent } from './errorReportScrubbing';

type ErrorTrackingConfig = {
  dsn?: string;
  environment: string;
  release?: string;
};

const getErrorTrackingConfig = (): ErrorTrackingConfig => ({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development',
  release: import.meta.env.VITE_SENTRY_RELEASE,
});

export const buildErrorTrackingOptions = (
  config: ErrorTrackingConfig & { dsn: string },
): SentryModule.BrowserOptions => ({
  dsn: config.dsn,
  environment: config.environment,
  release: config.release,
  sendDefaultPii: false,
  beforeSend: scrubErrorEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

// The SDK is about 30 KB gzip and does nothing without a DSN, so it is fetched
// only once one is configured (#3947). A capture raised before the fetch settles
// waits on it rather than being dropped.
let loadingSentry: Promise<typeof SentryModule> | null = null;

export const initializeErrorTracking = (config = getErrorTrackingConfig()) => {
  if (!config.dsn) {
    return false;
  }

  const dsn = config.dsn;
  loadingSentry = import('@sentry/react').then((sentry) => {
    sentry.init(buildErrorTrackingOptions({ ...config, dsn }));
    return sentry;
  });

  return true;
};

export const captureClientError = async (error: unknown, componentStack?: string) => {
  if (!loadingSentry) return;
  const sentry = await loadingSentry;
  sentry.captureException(error, {
    contexts: componentStack
      ? {
          react: {
            componentStack,
          },
        }
      : undefined,
  });
};

export const __resetErrorTrackingForTests = () => {
  loadingSentry = null;
};
