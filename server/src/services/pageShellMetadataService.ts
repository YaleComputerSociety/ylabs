import {
  getResearchGroupDetail,
  normalizeResearchDetailSlug,
  resolveArchivedResearchEntityCanonicalSlug,
} from './researchGroupService';
import { servedResearchEntityTitle } from '../utils/servedResearchEntityTitle';
import type { PageShellHead } from '../utils/pageShellHead';

export const PAGE_SHELL_LOOKUP_TIMEOUT_MS = 1500;
export const PAGE_SHELL_CACHE_TTL_MS = 5 * 60 * 1000;
export const PAGE_SHELL_CACHE_MAX_ENTRIES = 2000;
export const PAGE_SHELL_LOOKUP_WINDOW_MS = 60 * 1000;
export const PAGE_SHELL_LOOKUPS_PER_CLIENT_WINDOW = 60;
export const PAGE_SHELL_LIMITER_MAX_CLIENTS = 10000;

export type PageShellResolution =
  | { kind: 'page'; status: 200 | 404; head: PageShellHead }
  | { kind: 'redirect'; status: 301; location: string };

export interface ServedResearchShellFields {
  name?: unknown;
  displayName?: unknown;
  kind?: unknown;
  entityType?: unknown;
  shortDescription?: unknown;
}

export interface PageShellResolutionCache {
  get: (slug: string) => Promise<PageShellResolution> | undefined;
  track: (slug: string, pending: Promise<PageShellResolution>) => Promise<PageShellResolution>;
}

export interface PageShellLookupLimiter {
  tryAcquire: (clientKey: string) => boolean;
}

export interface PageShellMetadataDependencies {
  readServedResearchEntity: (slug: string) => Promise<ServedResearchShellFields | null>;
  readArchivedCanonicalSlug: (slug: string) => Promise<string | null>;
  lookupTimeoutMs: number;
  cache: PageShellResolutionCache;
  lookupLimiter: PageShellLookupLimiter;
}

const setNewest = <K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void => {
  map.delete(key);
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
};

export const createPageShellResolutionCache = ({
  ttlMs = PAGE_SHELL_CACHE_TTL_MS,
  maxEntries = PAGE_SHELL_CACHE_MAX_ENTRIES,
  now = Date.now,
}: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): PageShellResolutionCache => {
  const settled = new Map<string, { resolution: PageShellResolution; expiresAt: number }>();
  const inFlight = new Map<string, Promise<PageShellResolution>>();

  return {
    get: (slug) => {
      const entry = settled.get(slug);
      if (entry && entry.expiresAt > now()) return Promise.resolve(entry.resolution);
      if (entry) settled.delete(slug);
      return inFlight.get(slug);
    },
    track: (slug, pending) => {
      const tracked = pending.then(
        (resolution) => {
          inFlight.delete(slug);
          setNewest(settled, slug, { resolution, expiresAt: now() + ttlMs }, maxEntries);
          return resolution;
        },
        (error: unknown) => {
          inFlight.delete(slug);
          throw error;
        },
      );
      inFlight.set(slug, tracked);
      return tracked;
    },
  };
};

export const createPageShellLookupLimiter = ({
  windowMs = PAGE_SHELL_LOOKUP_WINDOW_MS,
  maxLookups = PAGE_SHELL_LOOKUPS_PER_CLIENT_WINDOW,
  maxClients = PAGE_SHELL_LIMITER_MAX_CLIENTS,
  now = Date.now,
}: {
  windowMs?: number;
  maxLookups?: number;
  maxClients?: number;
  now?: () => number;
} = {}): PageShellLookupLimiter => {
  const windows = new Map<string, { startedAt: number; lookups: number }>();

  return {
    tryAcquire: (clientKey) => {
      const current = windows.get(clientKey);
      const window =
        current && now() - current.startedAt < windowMs
          ? current
          : { startedAt: now(), lookups: 0 };
      if (window.lookups >= maxLookups) return false;
      setNewest(windows, clientKey, { ...window, lookups: window.lookups + 1 }, maxClients);
      return true;
    },
  };
};

const STATIC_PAGE_HEADS: Record<string, PageShellHead> = {
  '/': { canonicalPath: '/' },
  '/research': { title: 'Research', canonicalPath: '/research' },
  '/programs': { title: 'Programs & Fellowships', canonicalPath: '/programs' },
  '/about': { title: 'About', canonicalPath: '/about' },
};

const UNMODIFIED_SHELL: PageShellResolution = { kind: 'page', status: 200, head: {} };
const NOT_FOUND_SHELL: PageShellResolution = { kind: 'page', status: 404, head: {} };

const CONTACT_DATA_PATTERNS = [
  /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i,
  /\bmailto:/i,
  /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
];

const carriesContactData = (text: string): boolean =>
  CONTACT_DATA_PATTERNS.some((pattern) => pattern.test(text));

const servedShareDescription = (fields: ServedResearchShellFields): string | undefined => {
  if (typeof fields.shortDescription !== 'string') return undefined;
  const description = fields.shortDescription.trim();
  if (!description || carriesContactData(description)) return undefined;
  return description;
};

export const researchDetailShellHead = (
  slug: string,
  fields: ServedResearchShellFields,
): PageShellHead => {
  const title = servedResearchEntityTitle(fields).trim();
  return {
    ...(title ? { title } : {}),
    description: servedShareDescription(fields),
    canonicalPath: `/research/${encodeURIComponent(slug)}`,
  };
};

const decodePathSegment = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('page shell lookup timed out')), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const resolveResearchDetailShell = async (
  rawSlug: string,
  clientKey: string,
  dependencies: PageShellMetadataDependencies,
): Promise<PageShellResolution> => {
  const decoded = decodePathSegment(rawSlug);
  const slug = decoded === undefined ? undefined : normalizeResearchDetailSlug(decoded);
  if (!slug) return NOT_FOUND_SHELL;

  const lookup = async (): Promise<PageShellResolution> => {
    const fields = await dependencies.readServedResearchEntity(slug);
    if (fields) {
      return { kind: 'page', status: 200, head: researchDetailShellHead(slug, fields) };
    }
    const canonicalSlug = await dependencies.readArchivedCanonicalSlug(slug);
    if (canonicalSlug) {
      return {
        kind: 'redirect',
        status: 301,
        location: `/research/${encodeURIComponent(canonicalSlug)}`,
      };
    }
    return NOT_FOUND_SHELL;
  };

  const pending =
    dependencies.cache.get(slug) ??
    (dependencies.lookupLimiter.tryAcquire(clientKey)
      ? dependencies.cache.track(slug, withTimeout(lookup(), dependencies.lookupTimeoutMs))
      : undefined);
  if (!pending) return UNMODIFIED_SHELL;

  try {
    return await pending;
  } catch {
    return UNMODIFIED_SHELL;
  }
};

const readServedResearchEntity = async (
  slug: string,
): Promise<ServedResearchShellFields | null> => {
  const detail = await getResearchGroupDetail(slug);
  return detail ? detail.researchEntity : null;
};

export const defaultPageShellMetadataDependencies: PageShellMetadataDependencies = {
  readServedResearchEntity,
  readArchivedCanonicalSlug: resolveArchivedResearchEntityCanonicalSlug,
  lookupTimeoutMs: PAGE_SHELL_LOOKUP_TIMEOUT_MS,
  cache: createPageShellResolutionCache(),
  lookupLimiter: createPageShellLookupLimiter(),
};

export const resolvePageShell = async (
  requestPath: string,
  clientKey: string,
  dependencies: PageShellMetadataDependencies = defaultPageShellMetadataDependencies,
): Promise<PageShellResolution> => {
  const segments = requestPath.split('/').filter(Boolean);
  const normalizedPath = `/${segments.join('/')}`;

  const staticHead = STATIC_PAGE_HEADS[normalizedPath];
  if (staticHead) return { kind: 'page', status: 200, head: staticHead };

  if (segments.length === 2 && segments[0] === 'research') {
    return resolveResearchDetailShell(segments[1], clientKey, dependencies);
  }

  return UNMODIFIED_SHELL;
};
