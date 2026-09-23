import { describe, expect, it } from 'vitest';

import {
  classifyDescriptionGrounding,
  servedDescriptionCitationIsGone,
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
        candidateDescriptions: [PROSE],
      }),
    ).toBe('GROUNDED');
  });

  it('reports UNSUPPORTED when a live page carries no research prose of its own', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
        pageText: 'Ferrant Lab MENU Research Publications Contact Learn More',
        pageOffersResearchProse: false,
        candidateDescriptions: [PROSE],
      }),
    ).toBe('UNSUPPORTED');
  });

  it('reports REWORDED, not UNSUPPORTED, when the page still carries research prose', () => {
    // Measured on Development: two of three hand-read non-grounded bodies were our own
    // revoice of the page's own first-person prose, not publisher churn.
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
        pageText:
          'Our lab is dedicated to uncovering how ribosome stalling reshapes the proteome, using profiling and proteomics.',
        pageOffersResearchProse: true,
        candidateDescriptions: [
          'The Ferrant lab is dedicated to uncovering how ribosome stalling reshapes the proteome.',
        ],
      }),
    ).toBe('REWORDED');
  });

  it('accepts the wording the lane asserted when our own revoice rewrote the served text', () => {
    // Measured on Development: the lane copied a first-person opener and the revoice
    // pass stored it in the third person, so judging the served text alone reported our
    // own hygiene as publisher churn.
    const asserted = 'Our research focuses on how ribosome stalling reshapes the proteome.';
    const served =
      'The Ferrant lab conducts research on how ribosome stalling reshapes the proteome.';

    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
        pageText: `About the lab. ${asserted} Contact us.`,
        candidateDescriptions: [served, asserted],
      }),
    ).toBe('GROUNDED');
  });

  it('is UNKNOWN when the row can offer no wording at all', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
        pageText: 'A live page.',
        candidateDescriptions: ['', undefined],
      }),
    ).toBe('UNKNOWN');
  });

  it('never reports UNSUPPORTED for a throttled or blocked fetch', () => {
    // The mechanism that produced this issue's retracted measurement: 403 with no body.
    for (const status of [403, 429, 500, 503]) {
      expect(
        classifyDescriptionGrounding({
          linkHealth: { healthStatus: 'UNKNOWN', httpStatusCode: status },
          candidateDescriptions: [PROSE],
        }),
      ).toBe('UNKNOWN');
    }
  });

  it('separates a page that asserts it is gone from a page that was rewritten', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
        candidateDescriptions: [PROSE],
      }),
    ).toBe('UNREACHABLE');
  });

  it('treats a private-address host as unknown rather than as evidence', () => {
    expect(
      classifyDescriptionGrounding({
        linkHealth: { healthStatus: 'UNKNOWN', privateAddressHost: true },
        pageText: 'irrelevant',
        candidateDescriptions: [PROSE],
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
    const entry = resolveDescriptionGroundingEntry({ target, verdict: 'UNSUPPORTED', now });

    expect(entry).toMatchObject({ verdict: 'UNSUPPORTED', checkedAt: now, lastAttemptedAt: now });
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
    const second = resolveDescriptionGroundingEntry({ target, verdict: 'UNSUPPORTED', now });
    const merged = mergedDescriptionGrounding(mergedDescriptionGrounding([], first), second);

    expect(merged).toHaveLength(1);
    expect(merged[0].verdict).toBe('UNSUPPORTED');
  });

  it('looks a stored row up past cosmetic url differences', () => {
    const merged = mergedDescriptionGrounding(
      [],
      resolveDescriptionGroundingEntry({ target, verdict: 'UNSUPPORTED', now }),
    );

    expect(
      storedDescriptionGroundingEntry(
        { descriptionGrounding: merged },
        { ...target, url: 'http://www.example.edu/labs/ferrant/' },
      )?.verdict,
    ).toBe('UNSUPPORTED');
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

describe('servedDescriptionCitationIsGone (#2879)', () => {
  it('reads a fresh ABSENT verdict as lost grounding', () => {
    expect(
      servedDescriptionCitationIsGone(
        {
          descriptionGrounding: [
            {
              field: 'fullDescription',
              url: target.url,
              verdict: 'UNREACHABLE',
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
      servedDescriptionCitationIsGone(
        {
          descriptionGrounding: [
            {
              field: 'fullDescription',
              url: target.url,
              verdict: 'UNREACHABLE',
              checkedAt: new Date('2025-01-01T00:00:00Z'),
            },
          ],
        },
        new Date('2026-09-22T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('ignores every verdict that rests on a text comparison', () => {
    for (const verdict of ['GROUNDED', 'REWORDED', 'UNSUPPORTED', 'UNKNOWN'] as const) {
      expect(
        servedDescriptionCitationIsGone(
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
        candidateDescriptions: [PROSE],
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
