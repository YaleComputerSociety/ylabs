import {
  getResearchGroupDetail,
  normalizeResearchDetailSlug,
  resolveArchivedResearchEntityCanonicalSlug,
} from './researchGroupService';
import { servedResearchEntityTitle } from '../utils/servedResearchEntityTitle';
import type { PageShellHead } from '../utils/pageShellHead';

export const PAGE_SHELL_LOOKUP_TIMEOUT_MS = 1500;

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

export interface PageShellMetadataDependencies {
  readServedResearchEntity: (slug: string) => Promise<ServedResearchShellFields | null>;
  readArchivedCanonicalSlug: (slug: string) => Promise<string | null>;
  lookupTimeoutMs: number;
}

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

  try {
    return await withTimeout(lookup(), dependencies.lookupTimeoutMs);
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
};

export const resolvePageShell = async (
  requestPath: string,
  dependencies: PageShellMetadataDependencies = defaultPageShellMetadataDependencies,
): Promise<PageShellResolution> => {
  const segments = requestPath.split('/').filter(Boolean);
  const normalizedPath = `/${segments.join('/')}`;

  const staticHead = STATIC_PAGE_HEADS[normalizedPath];
  if (staticHead) return { kind: 'page', status: 200, head: staticHead };

  if (segments.length === 2 && segments[0] === 'research') {
    return resolveResearchDetailShell(segments[1], dependencies);
  }

  return UNMODIFIED_SHELL;
};
