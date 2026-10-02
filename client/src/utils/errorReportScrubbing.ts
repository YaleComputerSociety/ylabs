import type { Breadcrumb, ErrorEvent, RequestEventData } from '@sentry/react';

// Fails closed: a segment missing from this list reports as `:param`, so a new
// route only loses readability here, never leaks a slug, key, or netid.
const STATIC_PATH_SEGMENTS = new Set([
  'about',
  'account',
  'actions',
  'admin',
  'admin-grants',
  'analytics',
  'api',
  'assets',
  'audit-events',
  'batch',
  'cas',
  'check',
  'config',
  'corpus-quality',
  'correction-reports',
  'dashboard',
  'departments',
  'dev-login',
  'fellowships',
  'filters',
  'funnel',
  'listings',
  'login',
  'login-error',
  'logout',
  'operator-board',
  'person',
  'programs',
  'report',
  'research',
  'research-areas',
  'savedResearchEntities',
  'savedResearchEntityIds',
  'savedResearchEntityPlans',
  'search',
  'search-quality',
  'search-queries',
  'users',
  'watchedProgramIds',
  'watchedProgramPlans',
  'watchedPrograms',
]);

const REDACTED_SEGMENT = ':param';
const REDACTED_VALUE = '[Filtered]';
const RELATIVE_URL_BASE = 'http://relative.invalid';
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const BUNDLED_ASSET_PATH = /^\/assets\/[^/]+$/;

const KEPT_BREADCRUMB_CATEGORIES = new Set(['navigation', 'fetch', 'xhr']);
const BREADCRUMB_URL_KEYS = ['from', 'to', 'url'];
const BREADCRUMB_SCALAR_KEYS = ['method', 'status_code'];
export const KEPT_REQUEST_HEADERS = ['User-Agent'];

export const scrubPath = (path: string): string =>
  path
    .split('/')
    .map((segment) =>
      segment === '' || STATIC_PATH_SEGMENTS.has(segment) ? segment : REDACTED_SEGMENT,
    )
    .join('/');

export const scrubUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value, RELATIVE_URL_BASE);
  } catch {
    return REDACTED_VALUE;
  }

  const query = parsed.search ? `?${REDACTED_VALUE}` : '';
  const scrubbed = `${scrubPath(parsed.pathname)}${query}`;
  return parsed.origin === RELATIVE_URL_BASE ? scrubbed : `${parsed.origin}${scrubbed}`;
};

const isBundledAsset = (value: string): boolean => {
  try {
    const parsed = new URL(value, window.location.origin);
    return (
      parsed.origin === window.location.origin &&
      !parsed.search &&
      !parsed.hash &&
      BUNDLED_ASSET_PATH.test(parsed.pathname)
    );
  } catch {
    return false;
  }
};

const scrubFrameLocation = (value: string | undefined): string | undefined =>
  value && !isBundledAsset(value) ? scrubUrl(value) : value;

const scrubUrlsInText = (text: string): string => text.replace(ABSOLUTE_URL_PATTERN, scrubUrl);

const scrubBreadcrumbData = (data: Breadcrumb['data']): Breadcrumb['data'] => {
  if (!data) return undefined;

  const scrubbed: Record<string, unknown> = {};
  for (const key of BREADCRUMB_URL_KEYS) {
    if (typeof data[key] === 'string') scrubbed[key] = scrubUrl(data[key]);
  }
  for (const key of BREADCRUMB_SCALAR_KEYS) {
    if (typeof data[key] === 'string' || typeof data[key] === 'number') scrubbed[key] = data[key];
  }
  return scrubbed;
};

export const scrubBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb | null => {
  if (!breadcrumb.category || !KEPT_BREADCRUMB_CATEGORIES.has(breadcrumb.category)) {
    return null;
  }

  return {
    type: breadcrumb.type,
    category: breadcrumb.category,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
    data: scrubBreadcrumbData(breadcrumb.data),
  };
};

const scrubRequest = (request: RequestEventData | undefined): RequestEventData | undefined => {
  if (!request) return undefined;

  const headers: Record<string, string> = {};
  for (const name of KEPT_REQUEST_HEADERS) {
    const value = request.headers?.[name];
    if (value) headers[name] = value;
  }

  return {
    url: request.url ? scrubUrl(request.url) : undefined,
    method: request.method,
    headers,
  };
};

const keptBreadcrumbs = (breadcrumbs: Breadcrumb[] | undefined): Breadcrumb[] | undefined =>
  breadcrumbs?.flatMap((breadcrumb) => {
    const scrubbed = scrubBreadcrumb(breadcrumb);
    return scrubbed ? [scrubbed] : [];
  });

export const scrubErrorEvent = (event: ErrorEvent): ErrorEvent => ({
  ...event,
  user: undefined,
  transaction: event.transaction ? scrubUrl(event.transaction) : undefined,
  message: event.message ? scrubUrlsInText(event.message) : undefined,
  request: scrubRequest(event.request),
  breadcrumbs: keptBreadcrumbs(event.breadcrumbs),
  exception: event.exception && {
    ...event.exception,
    values: event.exception.values?.map((exception) => ({
      ...exception,
      value: exception.value ? scrubUrlsInText(exception.value) : exception.value,
      stacktrace: exception.stacktrace && {
        ...exception.stacktrace,
        frames: exception.stacktrace.frames?.map((frame) => ({
          ...frame,
          filename: scrubFrameLocation(frame.filename),
          abs_path: scrubFrameLocation(frame.abs_path),
        })),
      },
    })),
  },
});
