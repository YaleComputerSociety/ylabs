import { describe, expect, it } from 'vitest';
import {
  parseStripLegacyListingSourceUrlsArgs,
  planLegacyListingSourceUrlStrips,
} from '../stripLegacyListingSourceUrls';

describe('parseStripLegacyListingSourceUrlsArgs', () => {
  it('defaults to a dry run', () => {
    const options = parseStripLegacyListingSourceUrlsArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirmStripLegacyListingSources).toBe(false);
    expect(options.limit).toBe(Infinity);
  });

  it('parses apply, confirm, and limit flags', () => {
    const options = parseStripLegacyListingSourceUrlsArgs([
      '--apply',
      '--confirm-strip-legacy-listing-sources',
      '--limit=50',
    ]);
    expect(options.apply).toBe(true);
    expect(options.confirmStripLegacyListingSources).toBe(true);
    expect(options.limit).toBe(50);
  });

  it('rejects a value on the confirm flag', () => {
    expect(() =>
      parseStripLegacyListingSourceUrlsArgs(['--confirm-strip-legacy-listing-sources=true']),
    ).toThrow('--confirm-strip-legacy-listing-sources does not accept a value');
  });
});

describe('planLegacyListingSourceUrlStrips', () => {
  it('removes pre-#510 a-to-z/people listing sourceUrls and keeps real sources (#612)', () => {
    const { strips, orphanRisks } = planLegacyListingSourceUrlStrips([
      {
        _id: 'a'.repeat(24),
        displayName: 'Example Lab',
        sourceUrls: [
          'https://medicine.yale.edu/a-to-z-index/',
          'https://medicine.yale.edu/directory/faculty/',
          'https://example-computing-lab.example.org/',
        ],
      },
      {
        _id: 'b'.repeat(24),
        name: 'No Listing Entity',
        sourceUrls: ['https://example-lab.yale.edu/research/'],
      },
    ]);
    expect(orphanRisks).toEqual([]);
    expect(strips).toHaveLength(1);
    expect(strips[0].label).toBe('Example Lab');
    expect(strips[0].removedSourceUrls).toEqual([
      'https://medicine.yale.edu/a-to-z-index/',
      'https://medicine.yale.edu/directory/faculty/',
    ]);
    expect(strips[0].remainingSourceUrlCount).toBe(1);
    expect(strips[0].clearedWebsiteUrl).toBeUndefined();
  });

  it('flags an entity for review instead of stripping when every sourceUrl is disallowed', () => {
    const { strips, orphanRisks } = planLegacyListingSourceUrlStrips([
      {
        _id: 'c'.repeat(24),
        displayName: 'Orphan-Risk Lab',
        sourceUrls: ['https://medicine.yale.edu/people/faculty-directory/'],
      },
    ]);
    expect(strips).toEqual([]);
    expect(orphanRisks).toHaveLength(1);
    expect(orphanRisks[0].label).toBe('Orphan-Risk Lab');
    expect(orphanRisks[0].matchedSourceUrls).toEqual([
      'https://medicine.yale.edu/people/faculty-directory/',
    ]);
  });

  it('clears a websiteUrl that matches the disallowed-source predicate', () => {
    const { strips, orphanRisks } = planLegacyListingSourceUrlStrips([
      {
        _id: 'd'.repeat(24),
        slug: 'example-slug',
        websiteUrl: 'https://medicine.yale.edu/a-to-z-index/',
        sourceUrls: ['https://example-lab.yale.edu/research/'],
      },
    ]);
    expect(orphanRisks).toEqual([]);
    expect(strips).toHaveLength(1);
    expect(strips[0].label).toBe('example-slug');
    expect(strips[0].removedSourceUrls).toEqual([]);
    expect(strips[0].clearedWebsiteUrl).toBe('https://medicine.yale.edu/a-to-z-index/');
  });

  it('ignores entities with no disallowed sourceUrls or websiteUrl', () => {
    const { strips, orphanRisks } = planLegacyListingSourceUrlStrips([
      { _id: 'e'.repeat(24) },
    ]);
    expect(strips).toEqual([]);
    expect(orphanRisks).toEqual([]);
  });
});
