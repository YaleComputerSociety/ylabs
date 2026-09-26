/**
 * Pager mechanics for a `dept-faculty-roster` lane, shared by the scraper that
 * reads the roster and the `departments:audit-roster-lanes` audit that measures
 * whether the scraper read all of it.
 *
 * The two must share this module rather than each carrying a pager: an audit
 * running its own walk would measure the audit's pager, not the lane's, and a
 * roster count that disagrees with production is worse than no count at all.
 */
import type { FacultyEntry, FacultyExtractor } from '../sources/departmentRosterScraper';

/** Safety cap on a pagination crawl, in pages. */
export const MAX_PAGES_PER_DEPT = 20;

export function pageUrlForIndex(baseUrl: string, pageIndex: number): string {
  if (pageIndex === 0) return baseUrl;
  try {
    const u = new URL(baseUrl);
    u.searchParams.set('page', String(pageIndex));
    return u.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Identity of a roster row for repeat detection, preferring the profile URL and
 * falling back to the name. A slug-derived placeholder name is not identity, so
 * such a row keys on its URL alone and is dropped when it has neither.
 */
export function rosterEntryIdentityKey(entry: FacultyEntry): string {
  const profileUrl = entry.profileUrl?.trim().toLowerCase().replace(/\/+$/, '');
  if (profileUrl) return `url:${profileUrl}`;
  if (entry.namePlaceholder) return '';
  const name = entry.name?.trim().toLowerCase().replace(/\s+/g, ' ');
  return name ? `name:${name}` : '';
}

/**
 * Order-independent signature of the people a page listed. Two pages carrying
 * the same signature are the same page however the CMS ordered them.
 */
export function rosterPageSignature(entries: FacultyEntry[]): string {
  const keys = entries.map(rosterEntryIdentityKey).filter(Boolean);
  return Array.from(new Set(keys)).sort().join('|');
}

export type RosterPagerStopReason =
  | 'not-paginated'
  | 'empty-page'
  | 'repeated-page'
  | 'no-identifiable-rows'
  | 'page-cap'
  | 'fetch-failed'
  | 'extractor-error';

export interface RosterLanePage {
  pageIndex: number;
  pageUrl: string;
  entries: FacultyEntry[];
}

export interface RosterLaneWalk {
  pages: RosterLanePage[];
  stopReason: RosterPagerStopReason;
  /** Pages actually fetched, including the one that triggered the stop. */
  pagesFetched: number;
  /** Distinct people across every page, by `rosterEntryIdentityKey`. */
  distinctEntries: FacultyEntry[];
  error?: string;
}

export interface RosterLaneWalkRequest {
  url: string;
  paginated?: boolean;
  extractor: FacultyExtractor;
  fetchHtml: (pageUrl: string) => Promise<string>;
  maxPages?: number;
}

/**
 * Number of consecutive already-seen pages that ends a walk.
 *
 * It is deliberately not 1. A single repeat does NOT mean the end, because some
 * Yale pagers are 1-based: `architecture.yale.edu` serves the same first page
 * for `?page=0` and `?page=1` and then continues normally, so stopping on the
 * first repeat read 24 of its 107 people. Two in a row is the signal, which
 * still costs an out-of-range pager only 2 wasted fetches instead of 19.
 */
const CONSECUTIVE_REPEATED_PAGES_TO_STOP = 2;

/**
 * Walks a lane's pager, skipping pages it has already seen and stopping once two
 * arrive in a row.
 *
 * Drupal re-serves page 0 for an out-of-range `?page=N`, so a walk that waits
 * for an empty page runs to the cap and re-reads page 0 every time. Both stop
 * conditions are kept because they are different sites: some pagers do end with
 * an empty page, and `repeated-page` is what catches the ones that never do.
 */
export async function walkRosterLanePages(request: RosterLaneWalkRequest): Promise<RosterLaneWalk> {
  const maxPages = request.paginated ? (request.maxPages ?? MAX_PAGES_PER_DEPT) : 1;
  const pages: RosterLanePage[] = [];
  const seenSignatures = new Set<string>();
  const distinctByKey = new Map<string, FacultyEntry>();
  let pagesFetched = 0;
  let consecutiveRepeats = 0;

  const finish = (stopReason: RosterPagerStopReason, error?: string): RosterLaneWalk => ({
    pages,
    stopReason,
    pagesFetched,
    distinctEntries: Array.from(distinctByKey.values()),
    ...(error ? { error } : {}),
  });

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const pageUrl = pageUrlForIndex(request.url, pageIndex);
    let html: string;
    try {
      html = await request.fetchHtml(pageUrl);
    } catch (error) {
      return finish('fetch-failed', String(error));
    }
    pagesFetched++;

    let entries: FacultyEntry[];
    try {
      entries = request.extractor(html, { pageUrl });
    } catch (error) {
      return finish('extractor-error', String(error));
    }

    if (entries.length === 0) return finish('empty-page');

    const signature = rosterPageSignature(entries);
    // A page whose every row is an unnamed placeholder with no profile URL
    // cannot be compared against the next page, so repeat detection is blind
    // here and the walk stops rather than reading the cap on a guess.
    if (!signature) {
      pages.push({ pageIndex, pageUrl, entries });
      for (const entry of entries) distinctByKey.set(`anon:${distinctByKey.size}`, entry);
      return finish('no-identifiable-rows');
    }
    if (seenSignatures.has(signature)) {
      consecutiveRepeats++;
      if (consecutiveRepeats >= CONSECUTIVE_REPEATED_PAGES_TO_STOP) return finish('repeated-page');
      continue;
    }
    consecutiveRepeats = 0;
    seenSignatures.add(signature);

    pages.push({ pageIndex, pageUrl, entries });
    for (const entry of entries) {
      const key = rosterEntryIdentityKey(entry);
      if (key && !distinctByKey.has(key)) distinctByKey.set(key, entry);
    }

    if (!request.paginated) return finish('not-paginated');
  }

  return finish('page-cap');
}
