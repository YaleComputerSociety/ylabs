import { describe, expect, it, vi } from 'vitest';
import type { FacultyEntry, FacultyExtractor } from '../sources/departmentRosterScraper';
import {
  MAX_PAGES_PER_DEPT,
  pageUrlForIndex,
  rosterEntryIdentityKey,
  rosterPageSignature,
  walkRosterLanePages,
} from '../utils/rosterLanePaging';

const entry = (name: string, profileUrl?: string): FacultyEntry => ({
  name,
  ...(profileUrl ? { profileUrl } : {}),
});

/** Extractor that reads a page's people out of a `name|name` body. */
const csvExtractor: FacultyExtractor = (html) =>
  html
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((name) => entry(name, `/profile/${name}`));

describe('pageUrlForIndex', () => {
  it('leaves page 0 alone and sets ?page=N after it', () => {
    expect(pageUrlForIndex('https://example.yale.edu/people', 0)).toBe(
      'https://example.yale.edu/people',
    );
    expect(pageUrlForIndex('https://example.yale.edu/people', 2)).toBe(
      'https://example.yale.edu/people?page=2',
    );
  });

  it('preserves an existing query string', () => {
    expect(pageUrlForIndex('https://example.yale.edu/people?tab=faculty', 1)).toBe(
      'https://example.yale.edu/people?tab=faculty&page=1',
    );
  });
});

describe('rosterEntryIdentityKey', () => {
  it('prefers the profile URL and folds case and a trailing slash', () => {
    expect(rosterEntryIdentityKey(entry('Jane Roe', '/Profile/Jane/'))).toBe(
      rosterEntryIdentityKey(entry('Someone Else', '/profile/jane')),
    );
  });

  it('falls back to the name when there is no profile URL', () => {
    expect(rosterEntryIdentityKey(entry('Jane  Roe'))).toBe('name:jane roe');
  });

  it('refuses a slug placeholder with no URL as identity', () => {
    expect(rosterEntryIdentityKey({ name: 'jane-roe', namePlaceholder: true })).toBe('');
  });
});

describe('rosterPageSignature', () => {
  it('is order-independent', () => {
    expect(rosterPageSignature([entry('A', '/a'), entry('B', '/b')])).toBe(
      rosterPageSignature([entry('B', '/b'), entry('A', '/a')]),
    );
  });

  it('differs when the people differ', () => {
    expect(rosterPageSignature([entry('A', '/a')])).not.toBe(
      rosterPageSignature([entry('B', '/b')]),
    );
  });
});

describe('walkRosterLanePages', () => {
  it('reads one page and stops when the lane is not paginated', async () => {
    const fetchHtml = vi.fn().mockResolvedValue('Ann|Bob');
    const walk = await walkRosterLanePages({
      url: 'https://example.yale.edu/people',
      extractor: csvExtractor,
      fetchHtml,
    });

    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(walk.stopReason).toBe('not-paginated');
    expect(walk.distinctEntries).toHaveLength(2);
  });

  it('stops on a repeated page rather than running to the cap', async () => {
    // A Drupal host that re-serves page 0 for an out-of-range ?page=N.
    const fetchHtml = vi.fn(async (pageUrl: string) => {
      if (pageUrl.includes('page=1')) return 'Cal|Dee';
      return 'Ann|Bob';
    });

    const walk = await walkRosterLanePages({
      url: 'https://example.yale.edu/people',
      paginated: true,
      extractor: csvExtractor,
      fetchHtml,
    });

    expect(walk.stopReason).toBe('repeated-page');
    // Page 0, page 1, then page 2 re-serving page 0 and ending the walk.
    expect(fetchHtml).toHaveBeenCalledTimes(3);
    expect(walk.distinctEntries.map((person) => person.name)).toEqual(['Ann', 'Bob', 'Cal', 'Dee']);
  });

  it('stops on an empty page for a pager that does end', async () => {
    const fetchHtml = vi.fn(async (pageUrl: string) => (pageUrl.includes('page=1') ? '' : 'Ann'));
    const walk = await walkRosterLanePages({
      url: 'https://example.yale.edu/people',
      paginated: true,
      extractor: csvExtractor,
      fetchHtml,
    });

    expect(walk.stopReason).toBe('empty-page');
    expect(walk.distinctEntries).toHaveLength(1);
  });

  it('reports the cap when every page carries new people', async () => {
    let page = 0;
    const fetchHtml = vi.fn(async () => `person-${page++}`);
    const walk = await walkRosterLanePages({
      url: 'https://example.yale.edu/people',
      paginated: true,
      extractor: csvExtractor,
      fetchHtml,
    });

    expect(walk.stopReason).toBe('page-cap');
    expect(walk.pagesFetched).toBe(MAX_PAGES_PER_DEPT);
  });

  it('records a fetch failure without throwing', async () => {
    const walk = await walkRosterLanePages({
      url: 'https://example.yale.edu/people',
      paginated: true,
      extractor: csvExtractor,
      fetchHtml: vi.fn().mockRejectedValue(new Error('403 refused')),
    });

    expect(walk.stopReason).toBe('fetch-failed');
    expect(walk.error).toContain('403 refused');
    expect(walk.distinctEntries).toHaveLength(0);
  });

  it('records an extractor error without throwing', async () => {
    const walk = await walkRosterLanePages({
      url: 'https://example.yale.edu/people',
      extractor: () => {
        throw new Error('selector gone');
      },
      fetchHtml: vi.fn().mockResolvedValue('<html></html>'),
    });

    expect(walk.stopReason).toBe('extractor-error');
    expect(walk.error).toContain('selector gone');
  });

  it('stops when no row on a page can be identified, instead of guessing', async () => {
    const walk = await walkRosterLanePages({
      url: 'https://example.yale.edu/people',
      paginated: true,
      extractor: () => [{ name: 'jane-roe', namePlaceholder: true }],
      fetchHtml: vi.fn().mockResolvedValue('anything'),
    });

    expect(walk.stopReason).toBe('no-identifiable-rows');
    expect(walk.pagesFetched).toBe(1);
  });
});
