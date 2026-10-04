import { describe, expect, it } from 'vitest';
import { SOURCE_LINK_HEALTH_FRESHNESS_DAYS } from '../../services/sourceLinkHealth';
import {
  carryForwardSourceLinkHealthEntry,
  collectSourceLinkHealthCandidates,
  needsRecheckSince,
  needsSourceLinkHealthRefresh,
  planSourceLinkReprobe,
  tlsFallbackCandidates,
  SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS,
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

  it('collapses www and trailing-slash duplicates onto one probe', () => {
    const candidates = collectSourceLinkHealthCandidates(
      {
        websiteUrl: 'https://lab.example.yale.edu/research',
        sourceUrls: ['https://www.lab.example.yale.edu/research/'],
      },
      ['https://www.lab.example.yale.edu/research'],
    );

    expect(candidates).toEqual(['https://lab.example.yale.edu/research']);
  });

  it('probes each scheme on its own, because one can fail TLS while the other answers', () => {
    const candidates = collectSourceLinkHealthCandidates({
      websiteUrl: 'https://lab.example.yale.edu/research',
      sourceUrls: ['http://www.lab.example.yale.edu/research/'],
    });

    expect(candidates).toEqual([
      'https://lab.example.yale.edu/research',
      'http://www.lab.example.yale.edu/research/',
    ]);
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

// #2666: `hasLiveSourceCitation` counts every fieldProvenance sourceUrl as a
// citation, and this lane rewrites the whole verdict array, so a citation it does
// not probe loses its verdict and the gate reads it as possibly-live. Simulated
// against the corpus, that discarded 6 rows' dead verdicts and flipped 5
// student_ready cards from held to live.
describe('collectSourceLinkHealthCandidates covers every url the gate judges', () => {
  it('includes a fieldProvenance sourceUrl that is no longer in sourceUrls', () => {
    const candidates = collectSourceLinkHealthCandidates({
      sourceUrls: ['https://example-lab.yale.edu/'],
      fieldProvenance: {
        fullDescription: { sourceUrl: 'https://dropped.yale.edu/profile/example/' },
      },
    });

    expect(candidates).toContain('https://dropped.yale.edu/profile/example/');
    expect(candidates).toContain('https://example-lab.yale.edu/');
  });

  it('does not double count a provenance url already cited in sourceUrls', () => {
    const candidates = collectSourceLinkHealthCandidates({
      sourceUrls: ['https://example-lab.yale.edu/'],
      fieldProvenance: { name: { sourceUrl: 'https://example-lab.yale.edu/' } },
    });

    expect(candidates).toEqual(['https://example-lab.yale.edu/']);
  });

  it('tolerates a malformed or absent fieldProvenance', () => {
    for (const fieldProvenance of [undefined, null, 'nope', 42, { name: null }, { name: {} }]) {
      expect(
        collectSourceLinkHealthCandidates({
          sourceUrls: ['https://example-lab.yale.edu/'],
          fieldProvenance,
        }),
      ).toEqual(['https://example-lab.yale.edu/']);
    }
  });
});

describe('planSourceLinkReprobe', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const plan = (url: string, stored: unknown[]) => planSourceLinkReprobe([url], stored, 7, now);

  it('keeps the sweep window inside the horizon a verdict counts as verification for', () => {
    expect(SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS).toBeLessThan(
      SOURCE_LINK_HEALTH_FRESHNESS_DAYS,
    );
  });

  it('carries a HEALTHY verdict younger than the window forward unprobed', () => {
    const url = 'https://example-lab.yale.edu/';
    const stored = { url, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: daysAgo(2) };
    const result = plan(url, [stored]);
    expect(result.toProbe).toEqual([]);
    expect(result.carried.get(url)).toBe(stored);
  });

  it('probes a HEALTHY verdict older than the window, undated, or dated in the future', () => {
    const url = 'https://example-lab.yale.edu/';
    for (const checkedAt of [daysAgo(7.5), undefined, daysAgo(-1)]) {
      expect(plan(url, [{ url, healthStatus: 'HEALTHY', checkedAt }]).toProbe).toEqual([url]);
    }
  });

  it('probes every verdict that is not HEALTHY however fresh it is', () => {
    const url = 'https://example-lab.yale.edu/';
    for (const healthStatus of ['UNAVAILABLE', 'UNKNOWN', 'REDIRECTED']) {
      expect(plan(url, [{ url, healthStatus, checkedAt: daysAgo(0.1) }]).toProbe).toEqual([url]);
    }
  });

  it('probes a url new to the row even when a sibling citation is fresh', () => {
    const fresh = 'https://example-lab.yale.edu/';
    const added = 'https://example.yale.edu/profile/example-person/';
    const result = planSourceLinkReprobe(
      [fresh, added],
      [{ url: fresh, healthStatus: 'HEALTHY', checkedAt: daysAgo(1) }],
      7,
      now,
    );
    expect(result.toProbe).toEqual([added]);
    expect([...result.carried.keys()]).toEqual([fresh]);
  });

  it('finds a stored verdict under a cosmetically different spelling of the same scheme', () => {
    const result = plan('https://www.example-lab.yale.edu/research/', [
      {
        url: 'https://example-lab.yale.edu/research',
        healthStatus: 'HEALTHY',
        checkedAt: daysAgo(1),
      },
    ]);
    expect(result.toProbe).toEqual([]);
  });

  it('never carries a plain-HTTP verdict onto the https spelling of the same page', () => {
    const result = plan('https://example-lab.yale.edu/research', [
      {
        url: 'http://example-lab.yale.edu/research',
        healthStatus: 'HEALTHY',
        checkedAt: daysAgo(1),
      },
    ]);
    expect(result.toProbe).toEqual(['https://example-lab.yale.edu/research']);
  });
});

describe('carryForwardSourceLinkHealthEntry', () => {
  it('keeps the original verdict and its dates under the url the row now cites', () => {
    const checkedAt = new Date('2026-09-20T00:00:00Z');
    const lastAttemptedAt = new Date('2026-09-25T00:00:00Z');
    expect(
      carryForwardSourceLinkHealthEntry('https://example-lab.yale.edu/', {
        url: 'http://example-lab.yale.edu',
        healthStatus: 'HEALTHY',
        httpStatusCode: 200,
        checkedAt,
        lastAttemptedAt,
      }),
    ).toEqual({
      url: 'https://example-lab.yale.edu/',
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
      checkedAt,
      lastAttemptedAt,
    });
  });
});

describe('carryForwardSourceLinkHealthEntry https landing (#4649)', () => {
  it('carries the recorded https landing forward with the verdict', () => {
    const checkedAt = new Date('2026-09-20T00:00:00Z');
    expect(
      carryForwardSourceLinkHealthEntry('http://example-lab.yale.edu/', {
        url: 'http://example-lab.yale.edu/',
        healthStatus: 'HEALTHY',
        httpsLandingUrl: 'https://example-lab.yale.edu/',
        checkedAt,
      }),
    ).toEqual({
      url: 'http://example-lab.yale.edu/',
      healthStatus: 'HEALTHY',
      httpsLandingUrl: 'https://example-lab.yale.edu/',
      checkedAt,
    });
  });
});

describe('tlsFallbackCandidates', () => {
  it('adds the plain-HTTP spelling of an https url whose certificate failed', () => {
    const health = new Map([['https://a.yale.edu/~x/', { tlsVerificationFailed: true }]]);
    expect(tlsFallbackCandidates(['https://a.yale.edu/~x/'], health)).toEqual([
      'http://a.yale.edu/~x/',
    ]);
  });

  it('adds nothing when the plain-HTTP spelling is already a candidate', () => {
    const health = new Map([['https://a.yale.edu/~x/', { tlsVerificationFailed: true }]]);
    expect(
      tlsFallbackCandidates(['https://a.yale.edu/~x/', 'http://www.a.yale.edu/~x'], health),
    ).toEqual([]);
  });

  it('adds nothing for an https url whose certificate verified', () => {
    const health = new Map([['https://a.yale.edu/~x/', {}]]);
    expect(tlsFallbackCandidates(['https://a.yale.edu/~x/'], health)).toEqual([]);
  });
});
