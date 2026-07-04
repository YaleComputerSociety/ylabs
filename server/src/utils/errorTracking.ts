import * as Sentry from '@sentry/node';
import { Request } from 'express';

type ErrorTrackingConfig = {
  dsn?: string;
  environment: string;
  release?: string;
};

let initialized = false;

const getErrorTrackingConfig = (): ErrorTrackingConfig => ({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  release: process.env.SENTRY_RELEASE,
});

export const initializeErrorTracking = (config = getErrorTrackingConfig()) => {
  if (!config.dsn) {
    return false;
  }

  if (!initialized) {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
    });
    initialized = true;
  }

  return true;
};

export const captureServerError = (error: Error, req: Request) => {
  if (!initializeErrorTracking()) {
    return;
  }

  const user = req.user as { netId?: string } | undefined;

  Sentry.captureException(error, {
    tags: {
      method: req.method,
      path: req.path,
    },
    user: user?.netId ? { id: user.netId } : undefined,
    contexts: {
      request: {
        url: req.originalUrl,
        method: req.method,
      },
    },
  });
};
