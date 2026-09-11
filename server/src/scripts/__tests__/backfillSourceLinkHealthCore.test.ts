import { describe, expect, it } from 'vitest';
import {
  collectSourceLinkHealthCandidates,
  needsRecheckSince,
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

describe('needsRecheckSince', () => {
  const CUTOFF = new Date('2026-09-10T21:00:00.000Z');
  const at = (iso: string) => new Date(iso);

  it('needs a re-probe when every verdict predates the cutoff', () => {
    expect(
      needsRecheckSince(
        [
          {
            url: 'https://a.yale.edu/lab',
            healthStatus: 'HEALTHY',
            checkedAt: at('2026-09-05T18:00:00.000Z'),
          },
          {
            url: 'https://b.yale.edu/lab',
            healthStatus: 'HEALTHY',
            checkedAt: at('2026-08-22T18:00:00.000Z'),
          },
        ],
        CUTOFF,
      ),
    ).toBe(true);
  });

  it('skips a row the interrupted run already re-probed', () => {
    expect(
      needsRecheckSince(
        [
          {
            url: 'https://a.yale.edu/lab',
            healthStatus: 'HEALTHY',
            checkedAt: at('2026-09-11T02:00:00.000Z'),
          },
        ],
        CUTOFF,
      ),
    ).toBe(false);
  });

  it('uses the newest verdict, so a partially rewritten row is not redone', () => {
    expect(
      needsRecheckSince(
        [
          {
            url: 'https://a.yale.edu/lab',
            healthStatus: 'HEALTHY',
            checkedAt: at('2026-09-05T18:00:00.000Z'),
          },
          {
            url: 'https://b.yale.edu/lab',
            healthStatus: 'HEALTHY',
            checkedAt: at('2026-09-11T02:00:00.000Z'),
          },
        ],
        CUTOFF,
      ),
    ).toBe(false);
  });

  it('needs a re-probe when the row was never probed', () => {
    expect(needsRecheckSince([], CUTOFF)).toBe(true);
    expect(needsRecheckSince(undefined, CUTOFF)).toBe(true);
  });

  it('needs a re-probe when any verdict carries no usable date', () => {
    expect(
      needsRecheckSince(
        [
          {
            url: 'https://a.yale.edu/lab',
            healthStatus: 'HEALTHY',
            checkedAt: at('2026-09-11T02:00:00.000Z'),
          },
          { url: 'https://b.yale.edu/lab', healthStatus: 'HEALTHY' },
        ],
        CUTOFF,
      ),
    ).toBe(true);
  });

  it('accepts a serialized date string', () => {
    expect(
      needsRecheckSince(
        [
          {
            url: 'https://a.yale.edu/lab',
            healthStatus: 'HEALTHY',
            checkedAt: '2026-09-05T18:00:00.000Z',
          },
        ],
        CUTOFF,
      ),
    ).toBe(true);
  });

  // The reason this predicate exists rather than reusing the freshness horizon:
  // after a rules change the verdicts needing re-decision are days old, so every
  // one of them reads as fresh.
  it('catches rows that the freshness horizon reports as fresh', () => {
    const daysOld = [
      {
        url: 'https://a.yale.edu/lab',
        healthStatus: 'HEALTHY',
        checkedAt: at('2026-09-05T18:00:00.000Z'),
      },
    ];
    expect(needsSourceLinkHealthRefresh(daysOld, new Date('2026-09-11T00:00:00.000Z'))).toBe(false);
    expect(needsRecheckSince(daysOld, CUTOFF)).toBe(true);
  });
});
