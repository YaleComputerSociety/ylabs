import { describe, expect, it } from 'vitest';

import {
  classifyDescriptionGrounding,
  servedDescriptionGroundingLost,
} from '../../services/descriptionGrounding';
import {
  descriptionGroundingTargets,
  mergedDescriptionGrounding,
  needsDescriptionGroundingRecheck,
  resolveDescriptionGroundingEntry,
  storedDescriptionGroundingEntry,
} from '../recheckDescriptionGroundingCore';
import {
  assertRecheckDescriptionGroundingApplyAllowed,
  parseRecheckDescriptionGroundingArgs,
  probeDescriptionPage,
} from '../recheckDescriptionGrounding';

const PROSE =
  'The Ferrant lab studies how ribosome stalling reshapes the proteome, combining ribosome profiling with targeted proteomics in yeast and mammalian cells.';

const target = {
  field: 'fullDescription',
  url: 'https://example.edu/labs/ferrant',
  storedDescription: PROSE,
};

describe('classifyDescriptionGrounding (#2879)', () => {
  it('confirms grounding when the fetched page still carries the prose', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
        pageText: `Welcome. ${PROSE} Contact us for details.`,
        storedDescription: PROSE,
      }),
    ).toBe('GROUNDED');
  });

  it('reports ABSENT only when a live page no longer carries the prose', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
        pageText: 'This page has been replaced by a departmental directory listing.',
        storedDescription: PROSE,
      }),
    ).toBe('ABSENT');
  });

  it('never reports ABSENT for a throttled or blocked fetch', () => {
    // The mechanism that produced this issue's retracted measurement: 403 with no body.
    for (const status of [403, 429, 500, 503]) {
      expect(
        classifyDescriptionGrounding({
          linkHealth: { healthStatus: 'UNKNOWN', httpStatusCode: status },
          storedDescription: PROSE,
        }),
      ).toBe('UNKNOWN');
    }
  });

  it('separates a page that asserts it is gone from a page that was rewritten', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
        storedDescription: PROSE,
      }),
    ).toBe('UNREACHABLE');
  });

  it('treats a private-address host as unknown rather than as evidence', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'UNKNOWN', privateAddressHost: true },
        pageText: 'irrelevant',
        storedDescription: PROSE,
      }),
    ).toBe('UNKNOWN');
  });
});

describe('descriptionGroundingTargets (#2879)', () => {
  it('selects only a field a write-time-grounded lane sourced from an http page', () => {
    const targets = descriptionGroundingTargets({
      fullDescription: PROSE,
      shortDescription: 'Studies ribosome stalling.',
      fieldProvenance: {
        fullDescription: {
          sourceName: 'lab-microsite-description-llm',
          sourceUrl: 'https://example.edu/labs/ferrant',
        },
        shortDescription: {
          sourceName: 'dept-faculty-roster',
          sourceUrl: 'https://example.edu/roster',
        },
      },
    });

    expect(targets.map((entry) => entry.field)).toEqual(['fullDescription']);
  });

  it('selects nothing when the provenance carries no fetchable url', () => {
    expect(
      descriptionGroundingTargets({
        fullDescription: PROSE,
        fieldProvenance: {
          fullDescription: { sourceName: 'lab-microsite-description-llm', sourceUrl: '' },
        },
      }),
    ).toEqual([]);
  });

  it('reads provenance stored as a Map', () => {
    const targets = descriptionGroundingTargets({
      fullDescription: PROSE,
      fieldProvenance: new Map([
        [
          'fullDescription',
          {
            sourceName: 'lab-microsite-description-llm',
            sourceUrl: 'https://example.edu/labs/ferrant',
          },
        ],
      ]),
    });

    expect(targets).toHaveLength(1);
  });
});

describe('resolveDescriptionGroundingEntry durability (#2879)', () => {
  const now = new Date('2026-09-22T00:00:00Z');

  it('records a decisive verdict with a fresh checkedAt', () => {
    const entry = resolveDescriptionGroundingEntry({ target, verdict: 'ABSENT', now });

    expect(entry).toMatchObject({ verdict: 'ABSENT', checkedAt: now, lastAttemptedAt: now });
  });

  it('leaves a decisive stored verdict and its horizon alone when the re-check is inconclusive', () => {
    const stored = {
      field: target.field,
      url: target.url,
      verdict: 'GROUNDED' as const,
      checkedAt: new Date('2026-06-01T00:00:00Z'),
    };
    const entry = resolveDescriptionGroundingEntry({
      target,
      verdict: 'UNKNOWN',
      stored,
      now,
    });

    expect(entry.verdict).toBe('GROUNDED');
    expect(entry.checkedAt).toEqual(stored.checkedAt);
    expect(entry.lastAttemptedAt).toEqual(now);
  });

  it('replaces the row for the same field and url rather than accumulating one per probe', () => {
    const first = resolveDescriptionGroundingEntry({ target, verdict: 'GROUNDED', now });
    const second = resolveDescriptionGroundingEntry({ target, verdict: 'ABSENT', now });
    const merged = mergedDescriptionGrounding(mergedDescriptionGrounding([], first), second);

    expect(merged).toHaveLength(1);
    expect(merged[0].verdict).toBe('ABSENT');
  });

  it('looks a stored row up past cosmetic url differences', () => {
    const merged = mergedDescriptionGrounding(
      [],
      resolveDescriptionGroundingEntry({ target, verdict: 'ABSENT', now }),
    );

    expect(
      storedDescriptionGroundingEntry(
        { descriptionGrounding: merged },
        { ...target, url: 'http://www.example.edu/labs/ferrant/' },
      )?.verdict,
    ).toBe('ABSENT');
  });
});

describe('needsDescriptionGroundingRecheck (#2879)', () => {
  it('re-checks a row that has never been checked', () => {
    expect(needsDescriptionGroundingRecheck(undefined, new Date('2026-09-22T00:00:00Z'))).toBe(
      true,
    );
  });

  it('skips a verdict inside the freshness horizon and re-checks one past it', () => {
    const entry = {
      field: target.field,
      url: target.url,
      verdict: 'GROUNDED' as const,
      checkedAt: new Date('2026-09-01T00:00:00Z'),
    };

    expect(needsDescriptionGroundingRecheck(entry, new Date('2026-09-22T00:00:00Z'))).toBe(false);
    expect(needsDescriptionGroundingRecheck(entry, new Date('2027-09-22T00:00:00Z'))).toBe(true);
  });
});

describe('servedDescriptionGroundingLost (#2879)', () => {
  it('reads a fresh ABSENT verdict as lost grounding', () => {
    expect(
      servedDescriptionGroundingLost(
        {
          descriptionGrounding: [
            {
              field: 'fullDescription',
              url: target.url,
              verdict: 'ABSENT',
              checkedAt: new Date('2026-09-01T00:00:00Z'),
            },
          ],
        },
        new Date('2026-09-22T00:00:00Z'),
      ),
    ).toBe(true);
  });

  it('ignores a stale ABSENT verdict, so one old probe is not a permanent refusal', () => {
    expect(
      servedDescriptionGroundingLost(
        {
          descriptionGrounding: [
            {
              field: 'fullDescription',
              url: target.url,
              verdict: 'ABSENT',
              checkedAt: new Date('2025-01-01T00:00:00Z'),
            },
          ],
        },
        new Date('2026-09-22T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('ignores UNREACHABLE and UNKNOWN verdicts', () => {
    for (const verdict of ['UNREACHABLE', 'UNKNOWN'] as const) {
      expect(
        servedDescriptionGroundingLost(
          {
            descriptionGrounding: [
              {
                field: 'fullDescription',
                url: target.url,
                verdict,
                checkedAt: new Date('2026-09-01T00:00:00Z'),
              },
            ],
          },
          new Date('2026-09-22T00:00:00Z'),
        ),
      ).toBe(false);
    }
  });
});

describe('probeDescriptionPage (#2879)', () => {
  it('does not read a body when the link did not answer', async () => {
    const pages = new Map();
    let fetched = 0;
    await probeDescriptionPage(target.url, pages, {
      checkLink: async () => ({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }),
      fetchPage: async () => {
        fetched += 1;
        return { html: '', status: 200 };
      },
    });

    expect(fetched).toBe(0);
    expect(pages.get(target.url)?.pageText).toBeUndefined();
  });

  it('records no page text when the body fetch fails, so the verdict stays unknown', async () => {
    const pages = new Map();
    const health = await probeDescriptionPage(target.url, pages, {
      checkLink: async () => ({ healthStatus: 'HEALTHY', httpStatusCode: 200 }),
      fetchPage: async () => {
        throw new Error('Request failed with status code 403');
      },
    });

    expect(health.healthStatus).toBe('UNKNOWN');
    expect(pages.get(target.url)?.pageText).toBeUndefined();
    expect(
      classifyDescriptionGrounding({
        linkHealth: pages.get(target.url)!.health,
        pageText: pages.get(target.url)!.pageText,
        storedDescription: PROSE,
      }),
    ).toBe('UNKNOWN');
  });
});

describe('recheck-description-grounding CLI guards (#2879)', () => {
  it('defaults to dry-run', () => {
    expect(parseRecheckDescriptionGroundingArgs([]).dryRun).toBe(true);
  });

  it('refuses apply without confirmation', () => {
    expect(() =>
      assertRecheckDescriptionGroundingApplyAllowed({
        dryRun: false,
        confirm: false,
        explicitLimit: true,
        slugs: [],
      }),
    ).toThrow(/--confirm-description-grounding/);
  });

  it('refuses an unbounded apply', () => {
    expect(() =>
      assertRecheckDescriptionGroundingApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
        slugs: [],
      }),
    ).toThrow(/--limit/);
  });

  it('allows a slug-scoped apply', () => {
    expect(() =>
      assertRecheckDescriptionGroundingApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
        slugs: ['example-lab'],
      }),
    ).not.toThrow();
  });

  it('rejects an unknown flag rather than silently ignoring it', () => {
    expect(() => parseRecheckDescriptionGroundingArgs(['--verify'])).toThrow(/Unknown/);
  });
});
