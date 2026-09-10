import { describe, expect, it } from 'vitest';
import {
  collectSourceLinkHealthCandidates,
  needsSourceLinkHealthRefresh,
} from '../backfillSourceLinkHealthCore';

describe('collectSourceLinkHealthCandidates', () => {
  it('gathers entity website, website, source URLs, and extra signal URLs', () => {
    const candidates = collectSourceLinkHealthCandidates(
      {
        websiteUrl: 'https://lab.example.yale.edu/',
        website: 'https://old.example.yale.edu/lab',
        sourceUrls: ['https://example.yale.edu/join'],
      },
      ['https://example.yale.edu/apply'],
    );

    expect(candidates).toEqual([
      'https://lab.example.yale.edu/',
      'https://old.example.yale.edu/lab',
      'https://example.yale.edu/join',
      'https://example.yale.edu/apply',
    ]);
  });

  it('drops non-HTTP values and blanks', () => {
    const candidates = collectSourceLinkHealthCandidates({
      websiteUrl: 'javascript:alert(1)',
      website: '',
      sourceUrls: ['data:text/html,x', 'https://safe.example.edu/source', '   '],
    });

    expect(candidates).toEqual(['https://safe.example.edu/source']);
  });

  it('collapses scheme, www, and trailing-slash duplicates onto one probe', () => {
    const candidates = collectSourceLinkHealthCandidates(
      {
        websiteUrl: 'https://lab.example.yale.edu/research',
        sourceUrls: ['http://www.lab.example.yale.edu/research/'],
      },
      ['https://www.lab.example.yale.edu/research'],
    );

    expect(candidates).toEqual(['https://lab.example.yale.edu/research']);
  });

  it('keeps distinct query identifiers apart', () => {
    const candidates = collectSourceLinkHealthCandidates({
      sourceUrls: [
        'https://www.nsf.gov/awardsearch/showAward?AWD_ID=1',
        'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2',
      ],
    });

    expect(candidates).toHaveLength(2);
  });
});

describe('needsSourceLinkHealthRefresh', () => {
  const NOW = new Date('2026-09-10T00:00:00.000Z');
  const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

  it('needs a probe when the entity has never been probed', () => {
    expect(needsSourceLinkHealthRefresh(undefined, NOW)).toBe(true);
    expect(needsSourceLinkHealthRefresh([], NOW)).toBe(true);
  });

  it('skips a row whose every verdict is fresh', () => {
    expect(
      needsSourceLinkHealthRefresh(
        [
          { url: 'https://a.yale.edu/lab', healthStatus: 'HEALTHY', checkedAt: daysAgo(2) },
          { url: 'https://b.yale.edu/lab', healthStatus: 'UNAVAILABLE', checkedAt: daysAgo(3) },
        ],
        NOW,
      ),
    ).toBe(false);
  });

  it('re-probes the whole row when any verdict is stale, because the lane replaces the array', () => {
    expect(
      needsSourceLinkHealthRefresh(
        [
          { url: 'https://a.yale.edu/lab', healthStatus: 'HEALTHY', checkedAt: daysAgo(2) },
          { url: 'https://b.yale.edu/lab', healthStatus: 'HEALTHY', checkedAt: daysAgo(400) },
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it('re-probes an undated verdict, the shape that asserted liveness with no way to age it', () => {
    expect(
      needsSourceLinkHealthRefresh(
        [{ url: 'https://a.yale.edu/lab', healthStatus: 'HEALTHY' }],
        NOW,
      ),
    ).toBe(true);
  });

  it('re-probes a malformed entry rather than trusting it', () => {
    expect(needsSourceLinkHealthRefresh([{ url: 'https://a.yale.edu/lab' }], NOW)).toBe(true);
  });
});
