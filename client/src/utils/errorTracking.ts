import type * as SentryModule from '@sentry/react';

import { KEPT_REQUEST_HEADERS, scrubBreadcrumb, scrubErrorEvent } from './errorReportScrubbing';

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

const DATA_COLLECTION: SentryModule.BrowserOptions['dataCollection'] = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: KEPT_REQUEST_HEADERS }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

export const buildErrorTrackingOptions = (
  config: ErrorTrackingConfig & { dsn: string },
): SentryModule.BrowserOptions => ({
  dsn: config.dsn,
  environment: config.environment,
  release: config.release,
  dataCollection: DATA_COLLECTION,
  attachStacktrace: false,
  beforeSend: scrubErrorEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

// The SDK is about 30 KB gzip and does nothing without a DSN, so it is fetched
// only once one is configured (#3947). A capture raised before the fetch settles
// waits on it rather than being dropped.
let loadingSentry: Promise<typeof SentryModule | null> | null = null;

export const initializeErrorTracking = (config = getErrorTrackingConfig()) => {
  if (!config.dsn) {
    return false;
  }

  const dsn = config.dsn;
  const loading = import('@sentry/react')
    .then((sentry) => {
      sentry.init(buildErrorTrackingOptions({ ...config, dsn }));
      return sentry;
    })
    .catch(() => {
      if (loadingSentry === loading) loadingSentry = null;
      return null;
    });
  loadingSentry = loading;

  return true;
};

export const captureClientError = async (error: unknown, componentStack?: string) => {
  if (!loadingSentry) return;
  const sentry = await loadingSentry;
  if (!sentry) return;
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
