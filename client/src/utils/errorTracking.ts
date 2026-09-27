import * as Sentry from '@sentry/react';

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
): Sentry.BrowserOptions => ({
  dsn: config.dsn,
  environment: config.environment,
  release: config.release,
  sendDefaultPii: false,
  beforeSend: scrubErrorEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

export const initializeErrorTracking = (config = getErrorTrackingConfig()) => {
  if (!config.dsn) {
    return false;
  }

  Sentry.init(buildErrorTrackingOptions({ ...config, dsn: config.dsn }));

  return true;
};

export const captureClientError = (error: unknown, componentStack?: string) => {
  Sentry.captureException(error, {
    contexts: componentStack
      ? {
          react: {
            componentStack,
          },
        }
      : undefined,
  });
};
