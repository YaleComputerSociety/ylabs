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

const UNMATCHED_ROUTE = 'unmatched';

// A concrete request path can carry a netid, because routes such as
// `/users/:netid` declare one as a param, so reports quote the matched route
// template instead. The session principal carries a netid and nothing else
// that identifies the caller (`AuthenticatedSessionUser` in passport.ts), and
// no stable non-reversible account handle exists to stand in for it, so no
// user identity is sent to the error-reporting provider at all.
const errorReportRoute = (req: Request): string => {
  const template = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof template !== 'string' || template.length === 0) {
    return UNMATCHED_ROUTE;
  }

  const mountPath = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  return `${mountPath}${template === '/' ? '' : template}` || '/';
};

export const captureServerError = (error: Error, req: Request) => {
  if (!initializeErrorTracking()) {
    return;
  }

  const session = req.user as { userType?: string } | undefined;
  const route = errorReportRoute(req);

  Sentry.captureException(error, {
    tags: {
      method: req.method,
      path: route,
      authenticated: session ? 'true' : 'false',
      userType: session?.userType || 'unknown',
    },
    contexts: {
      request: {
        path: route,
        method: req.method,
      },
    },
  });
};

export const captureStartupError = async (error: unknown) => {
  if (!initializeErrorTracking()) {
    return;
  }

  Sentry.captureException(error);
  await Sentry.flush(2000);
};
