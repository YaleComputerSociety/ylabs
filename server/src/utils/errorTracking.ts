import * as Sentry from '@sentry/node';
import { Request } from 'express';

type ErrorTrackingConfig = {
  dsn?: string;
  environment: string;
  release?: string;
};

const DATA_COLLECTION: Sentry.NodeOptions['dataCollection'] = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

const URL_CREDENTIALS_PATTERN = /\/\/[^/\s:@]+:[^/\s@]+@/g;

const scrubUrlCredentials = (text: string): string =>
  text.replace(URL_CREDENTIALS_PATTERN, '//[Filtered]@');

const reportedTag = (event: Sentry.ErrorEvent, name: string): string | undefined => {
  const value = event.tags?.[name];
  return typeof value === 'string' ? value : undefined;
};

export const scrubServerEvent = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  const method = reportedTag(event, 'method') ?? event.request?.method;
  const route = reportedTag(event, 'path');

  return {
    ...event,
    user: undefined,
    request: method ? { method } : undefined,
    transaction: method && route ? `${method} ${route}` : undefined,
    breadcrumbs: undefined,
    exception: event.exception && {
      ...event.exception,
      values: event.exception.values?.map((exception) => ({
        ...exception,
        value: exception.value ? scrubUrlCredentials(exception.value) : exception.value,
      })),
    },
  };
};

const dropBreadcrumb = (): null => null;

export const buildErrorTrackingOptions = (
  config: ErrorTrackingConfig & { dsn: string },
): Sentry.NodeOptions => ({
  dsn: config.dsn,
  environment: config.environment,
  release: config.release,
  dataCollection: DATA_COLLECTION,
  includeLocalVariables: false,
  attachStacktrace: false,
  // The global error handler is the only capture path: it reports the matched
  // route template and skips the errors it answers itself. Express's own capture
  // would fire first, and the dedupe integration would then drop this report.
  integrations: [Sentry.expressIntegration({ shouldHandleError: false })],
  beforeSend: scrubServerEvent,
  beforeBreadcrumb: dropBreadcrumb,
});

export const getErrorTrackingConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ErrorTrackingConfig => ({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
  release: env.SENTRY_RELEASE || env.RENDER_GIT_COMMIT || undefined,
});

export const initializeErrorTracking = (config = getErrorTrackingConfig()) => {
  if (!config.dsn) {
    return false;
  }

  if (!Sentry.isInitialized()) {
    Sentry.init(buildErrorTrackingOptions({ ...config, dsn: config.dsn }));
  }

  return true;
};

const UNMATCHED_ROUTE = 'unmatched';

const COUNTABLE_TEMPLATE = /^[^*?()+{}]*$/;

const pathSegments = (path: string): string[] => path.split('/').filter(Boolean);

// Express clears `req.baseUrl` once a request leaves its router, so the global
// error handler sees an empty one. The mount is recovered from the leading
// request segments, which is safe only because every router is mounted at a
// static path: mounting one at a param path would put its value into reports.
const mountPathOf = (req: Request, template: string): string => {
  if (typeof req.baseUrl === 'string' && req.baseUrl) return req.baseUrl;
  if (!COUNTABLE_TEMPLATE.test(template) || typeof req.originalUrl !== 'string') return '';

  const requestSegments = pathSegments(req.originalUrl.split('?')[0] ?? '');
  const mountSegmentCount = requestSegments.length - pathSegments(template).length;
  return mountSegmentCount > 0 ? `/${requestSegments.slice(0, mountSegmentCount).join('/')}` : '';
};

// A concrete request path can carry a netid, because routes such as
// `/users/:netid` declare one as a param, so reports quote the matched route
// template instead. The session principal carries a netid and nothing else
// that identifies the caller (`AuthenticatedSessionUser` in passport.ts), and
// no stable non-reversible account handle exists to stand in for it, so no
// user identity is sent to the error-reporting provider at all.
export const errorReportRoute = (req: Request): string => {
  const template = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof template !== 'string' || template.length === 0) {
    return UNMATCHED_ROUTE;
  }

  return `${mountPathOf(req, template)}${template === '/' ? '' : template}` || '/';
};

const PLATFORM_REQUEST_ID_HEADER = 'rndr-id';
const PLATFORM_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export const platformRequestId = (req: Request): string | undefined => {
  const value = req.headers?.[PLATFORM_REQUEST_ID_HEADER];
  return typeof value === 'string' && PLATFORM_REQUEST_ID_PATTERN.test(value) ? value : undefined;
};

export const captureServerError = (error: Error, req: Request) => {
  if (!initializeErrorTracking()) {
    return;
  }

  const session = req.user as { userType?: string } | undefined;
  const route = errorReportRoute(req);
  const rndrId = platformRequestId(req);

  Sentry.captureException(error, {
    tags: {
      method: req.method,
      path: route,
      authenticated: session ? 'true' : 'false',
      userType: session?.userType || 'unknown',
      ...(rndrId ? { rndrId } : {}),
    },
    contexts: {
      request: {
        path: route,
        method: req.method,
      },
    },
  });
};

export type DegradedSignal =
  | 'mongo_topology_lost'
  | 'embedding_breaker_open'
  | 'corpus_snapshot_failed'
  | 'gate_refresh_failed';

export const captureServerWarning = (signal: DegradedSignal) => {
  if (!initializeErrorTracking()) {
    return;
  }

  Sentry.captureMessage(signal, {
    level: 'warning',
    fingerprint: [signal],
    tags: { signal },
  });
};

export const captureStartupError = async (error: unknown) => {
  if (!initializeErrorTracking()) {
    return;
  }

  Sentry.captureException(error);
  await Sentry.flush(2000);
};
