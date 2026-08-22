import { describe, expect, it } from 'vitest';
import {
  parseStripDirectoryLoaderSourceUrlsArgs,
  planDirectoryLoaderSourceStrips,
} from '../stripDirectoryLoaderSourceUrls';

describe('parseStripDirectoryLoaderSourceUrlsArgs', () => {
  it('defaults to a dry run', () => {
    const options = parseStripDirectoryLoaderSourceUrlsArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirmStripDirectoryLoaderSources).toBe(false);
    expect(options.limit).toBe(Infinity);
  });

  it('parses apply, confirm, and limit flags', () => {
    const options = parseStripDirectoryLoaderSourceUrlsArgs([
      '--apply',
      '--confirm-strip-directory-loader-sources',
      '--limit=50',
    ]);
    expect(options.apply).toBe(true);
    expect(options.confirmStripDirectoryLoaderSources).toBe(true);
    expect(options.limit).toBe(50);
  });
});

describe('planDirectoryLoaderSourceStrips', () => {
  it('removes directory-loader source rows and keeps real sources (#549)', () => {
    const strips = planDirectoryLoaderSourceStrips([
      {
        _id: 'a'.repeat(24),
        displayName: 'Example Lab',
        sourceUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
          'https://example-computing-lab.example.org/',
        ],
      },
      {
        _id: 'b'.repeat(24),
        name: 'No Loader Entity',
        sourceUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/shruti-puri',
        ],
      },
    ]);
    expect(strips).toHaveLength(1);
    expect(strips[0].label).toBe('Example Lab');
    expect(strips[0].removed).toEqual([
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
    ]);
    expect(strips[0].remainingCount).toBe(1);
  });

  it('ignores entities without a sourceUrls array', () => {
    expect(planDirectoryLoaderSourceStrips([{ _id: 'c'.repeat(24) }])).toEqual([]);
  });
});
