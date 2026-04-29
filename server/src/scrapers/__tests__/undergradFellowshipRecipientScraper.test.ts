/**
 * Unit tests for UndergradFellowshipRecipientScraper.
 *
 * No network, no DB. The HTML extractor is exercised against embedded
 * structurally-faithful fixtures, the aggregator is tested directly, the user
 * resolver is tested against a hand-built mock User model, and the full
 * `run()` is tested with all three I/O hooks (fetchPage, userFinder,
 * ownerToGroupSlug) injected so neither axios nor mongoose are touched.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  UndergradFellowshipRecipientScraper,
  drupalRecipientRowExtractor,
  manualUploadStub,
  aggregateAdviseesByAdvisor,
  findUserForAdvisor,
  buildObservationsForAdvisor,
  inferYearFromUrl,
  DEFAULT_PROGRAM_CONFIGS,
  type ProgramConfig,
  type FellowshipRecipient,
  type UserMatch,
} from '../sources/undergradFellowshipRecipientScraper';
import type { ObservationInput, ScraperContext } from '../types';

// ---------------------------------------------------------------------------
// Sample HTML fixtures
// ---------------------------------------------------------------------------

/**
 * A two-year recipient page using the `recipient-row` Drupal pattern. Year is
 * either declared per-row via data-year, or falls back to the page's URL year.
 * One row deliberately omits the advisor — it must be skipped.
 */
const RECIPIENTS_HTML_2024 = `
<html><body>
  <div class="recipient-row" data-year="2024">
    <span class="recipient-name">Alice Liu</span>
    <span class="project-title">Riboswitch dynamics in vivo</span>
    <span class="advisor-name">Ronald Breaker</span>
  </div>
  <div class="recipient-row" data-year="2024">
    <span class="recipient-name">Bob Chen</span>
    <span class="project-title">PFC neuromodulation</span>
    <span class="advisor-name">Amy Arnsten</span>
  </div>
  <div class="recipient-row" data-year="2024">
    <span class="recipient-name">No Advisor Person</span>
    <span class="project-title">Orphan project</span>
    <span class="advisor-name"></span>
  </div>
  <div class="recipient-row">
    <span class="recipient-name">Diana Ng</span>
    <span class="project-title">Senior thesis</span>
    <span class="advisor-name">Ronald Breaker</span>
  </div>
</body></html>
`;

const RECIPIENTS_HTML_2023 = `
<html><body>
  <div class="recipient-row" data-year="2023">
    <span class="recipient-name">Eve Martinez</span>
    <span class="project-title">Catalytic RNA</span>
    <span class="advisor-name">Ronald Breaker</span>
  </div>
</body></html>
`;

// ---------------------------------------------------------------------------
// Per-extractor tests
// ---------------------------------------------------------------------------

describe('drupalRecipientRowExtractor', () => {
  it('parses recipient-row cards with explicit data-year and falls back to defaultYear', () => {
    const out = drupalRecipientRowExtractor(RECIPIENTS_HTML_2024, {
      pageUrl: 'https://example.invalid/recipients/2024/',
      defaultYear: 2024,
    });
    // 4 rows, one with no advisor (skipped) → 3 surviving recipients
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      studentName: 'Alice Liu',
      advisorName: 'Ronald Breaker',
      projectTitle: 'Riboswitch dynamics in vivo',
      year: 2024,
    });
    expect(out[2]).toMatchObject({
      studentName: 'Diana Ng',
      advisorName: 'Ronald Breaker',
      year: 2024, // pulled from defaultYear
    });
  });

  it('skips rows when neither data-year nor a defaultYear is available', () => {
    const html = `
      <div class="recipient-row">
        <span class="recipient-name">No Year Person</span>
        <span class="advisor-name">Some Advisor</span>
      </div>
    `;
    const out = drupalRecipientRowExtractor(html, {
      pageUrl: 'https://example.invalid/recipients/',
    });
    expect(out).toEqual([]);
  });
});

describe('manualUploadStub', () => {
  it('throws a clear "manual upload required" error', () => {
    expect(() => manualUploadStub('<html></html>', { pageUrl: 'x' })).toThrow(
      /manual upload required/,
    );
  });
});

describe('inferYearFromUrl', () => {
  it('reads a 4-digit year out of the URL path', () => {
    expect(inferYearFromUrl('https://example.invalid/recipients/2024/')).toBe(2024);
    expect(
      inferYearFromUrl(
        'https://science.yalecollege.yale.edu/sites/default/files/files/2025%20STARS2%20Symposium.pdf',
      ),
    ).toBe(2025);
  });

  it('prefers the last plausible match when multiple years appear', () => {
    expect(inferYearFromUrl('https://example.invalid/2010/recipients/2024/')).toBe(2024);
  });

  it('returns undefined when no plausible year is present', () => {
    expect(inferYearFromUrl('https://example.invalid/recipients/')).toBeUndefined();
    // 0700 etc. are NOT plausible (1980 ≤ y ≤ next-year)
    expect(inferYearFromUrl('https://example.invalid/page/0700/')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// aggregateAdviseesByAdvisor
// ---------------------------------------------------------------------------

describe('aggregateAdviseesByAdvisor', () => {
  it('groups multiple students under the same (advisor, program, year) into a single entry with count', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'Alice', advisorName: 'Ronald Breaker', year: 2024 },
      { studentName: 'Bob', advisorName: 'Ronald Breaker', year: 2024 },
      { studentName: 'Charlie', advisorName: 'Amy Arnsten', year: 2024 },
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'STARS Summer');
    expect(out.size).toBe(2);
    const breaker = out.get('ronald-breaker')!;
    expect(breaker.advisees).toEqual([
      { year: 2024, programName: 'STARS Summer', count: 2 },
    ]);
    const arnsten = out.get('amy-arnsten')!;
    expect(arnsten.advisees).toEqual([
      { year: 2024, programName: 'STARS Summer', count: 1 },
    ]);
  });

  it('keeps separate entries for different years and sorts year desc', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'A', advisorName: 'Ronald Breaker', year: 2022 },
      { studentName: 'B', advisorName: 'Ronald Breaker', year: 2024 },
      { studentName: 'C', advisorName: 'Ronald Breaker', year: 2023 },
      { studentName: 'D', advisorName: 'Ronald Breaker', year: 2024 },
    ];
    const out = aggregateAdviseesByAdvisor(recipients, "Dean's Research");
    const row = out.get('ronald-breaker')!;
    expect(row.advisees.map((a) => a.year)).toEqual([2024, 2023, 2022]);
    const y2024 = row.advisees.find((a) => a.year === 2024)!;
    expect(y2024.count).toBe(2);
    expect(row.latestYear).toBe(2024);
  });

  it('canonicalizes advisor names so honorifics and credentials collapse', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'A', advisorName: 'Dr. Ronald Breaker', year: 2024 },
      { studentName: 'B', advisorName: 'Ronald Breaker, Ph.D.', year: 2024 },
      { studentName: 'C', advisorName: 'Ronald Breaker', year: 2024 },
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'STARS II');
    expect(out.size).toBe(1);
    const breaker = out.get('ronald-breaker')!;
    expect(breaker.advisees[0].count).toBe(3);
  });

  it('drops recipients with unparseable advisor names (no last name)', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'A', advisorName: '', year: 2024 },
      { studentName: 'B', advisorName: '   ', year: 2024 },
      { studentName: 'C', advisorName: 'Madonna', year: 2024 }, // single name → no last name from splitName
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'STARS II');
    // splitName returns last='' for single tokens, so all three are dropped.
    expect(out.size).toBe(0);
  });

  it('accumulates source URLs from the optional per-recipient map', () => {
    const r1: FellowshipRecipient = { studentName: 'A', advisorName: 'Amy Arnsten', year: 2024 };
    const r2: FellowshipRecipient = { studentName: 'B', advisorName: 'Amy Arnsten', year: 2023 };
    const recipientToUrl = new Map<FellowshipRecipient, string>([
      [r1, 'https://example.invalid/2024/'],
      [r2, 'https://example.invalid/2023/'],
    ]);
    const out = aggregateAdviseesByAdvisor([r1, r2], 'STARS Summer', recipientToUrl);
    const row = out.get('amy-arnsten')!;
    expect(Array.from(row.sourceUrls).sort()).toEqual([
      'https://example.invalid/2023/',
      'https://example.invalid/2024/',
    ]);
  });
});

// ---------------------------------------------------------------------------
// findUserForAdvisor
// ---------------------------------------------------------------------------

describe('findUserForAdvisor', () => {
  it('matches on lname + fname when exactly one user matches', async () => {
    const finder = vi.fn(async (q: any) => {
      // Exact-fname query
      if (q.fname) {
        return [{ _id: 'u1', netid: 'rrb1', fname: 'Ronald', lname: 'Breaker' }];
      }
      return [];
    });
    const out = await findUserForAdvisor('Ronald Breaker', finder);
    expect(out).toEqual({ _id: 'u1', netid: 'rrb1', fname: 'Ronald', lname: 'Breaker' });
  });

  it('falls back to first-initial match when exact fname matches zero', async () => {
    let call = 0;
    const finder = vi.fn(async (q: any) => {
      call++;
      const fnameSrc: string = q.fname?.source || '';
      // Exact-fname (^Sandy$) returns nothing — admin's display name doesn't match canonical first name
      if (/Sandy/.test(fnameSrc)) return [];
      // First-initial query — pattern is just `^S` (1-char prefix), no $ anchor
      if (fnameSrc === '^S') {
        return [{ _id: 'u2', netid: 'sc2', fname: 'Sanford', lname: 'Chang' }];
      }
      return [];
    });
    const out = await findUserForAdvisor('Sandy Chang', finder);
    expect(out?._id).toBe('u2');
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it('falls back to lname-only when exactly one faculty has that lname', async () => {
    // Two-token name where the first-name match deliberately misses, forcing fall-through.
    // (`splitName` requires ≥2 tokens before populating `last`, so a single-name input is skipped.)
    const finder = vi.fn(async (q: any) => {
      // No exact-fname or initial match
      if (q.fname) return [];
      // Only the lname-only query hits
      return [{ _id: 'u3', netid: 'fb1', fname: 'Frances', lname: 'Bergquist' }];
    });
    const out = await findUserForAdvisor('Q. Bergquist', finder);
    expect(out?._id).toBe('u3');
  });

  it('returns null when ambiguous lname-only match', async () => {
    const finder = vi.fn(async (_q: any) => [
      { _id: 'a', netid: 'a1', fname: 'A', lname: 'Smith' },
      { _id: 'b', netid: 'b1', fname: 'B', lname: 'Smith' },
    ]);
    const out = await findUserForAdvisor('Smith', finder);
    expect(out).toBeNull();
  });

  it('returns null on missing/unparseable name', async () => {
    expect(await findUserForAdvisor('', vi.fn())).toBeNull();
    expect(await findUserForAdvisor('Madonna', vi.fn(async () => []))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildObservationsForAdvisor
// ---------------------------------------------------------------------------

describe('buildObservationsForAdvisor', () => {
  it('emits pastUndergradAdvisees, acceptingUndergrads(0.8), and lastObservedAt — all keyed by group slug', () => {
    const advisees = [
      { year: 2024, programName: 'STARS Summer', count: 2 },
      { year: 2023, programName: 'STARS Summer', count: 1 },
    ];
    const out = buildObservationsForAdvisor(
      'breaker-lab-rrb1',
      advisees,
      'https://example.invalid/2024/',
    );
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.entityType === 'researchGroup')).toBe(true);
    expect(out.every((o) => o.entityKey === 'breaker-lab-rrb1')).toBe(true);
    expect(out.every((o) => o.sourceUrl === 'https://example.invalid/2024/')).toBe(true);

    const past = out.find((o) => o.field === 'pastUndergradAdvisees')!;
    expect(past.value).toEqual(advisees);

    const accepting = out.find((o) => o.field === 'acceptingUndergrads')!;
    expect(accepting.value).toBe(true);
    expect(accepting.confidenceOverride).toBe(0.8);

    const lastObs = out.find((o) => o.field === 'lastObservedAt')!;
    expect(lastObs.value).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PROGRAM_CONFIGS
// ---------------------------------------------------------------------------

describe('DEFAULT_PROGRAM_CONFIGS', () => {
  it('covers the v1 set of ~6 fellowship programs and stubs each one for manual upload', () => {
    const keys = DEFAULT_PROGRAM_CONFIGS.map((c) => c.programKey).sort();
    expect(keys).toEqual(
      [
        'bass-writing',
        'deans-research',
        'mellon-mays',
        'stars-ii',
        'stars-summer',
        'tetelman',
      ].sort(),
    );
    // All defaults are stubs until extractors are written for the real pages
    expect(DEFAULT_PROGRAM_CONFIGS.every((c) => c.manualUploadRequired)).toBe(true);
    expect(DEFAULT_PROGRAM_CONFIGS.every((c) => c.skipReason && c.skipReason.length > 0)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end orchestration with all I/O mocked
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'undergrad-fellowships-recipients',
    sourceWeight: 0.85,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('UndergradFellowshipRecipientScraper.run', () => {
  it('orchestrates fetch → extract → aggregate → match → emit across canned configs', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url.includes('2024')) return RECIPIENTS_HTML_2024;
      if (url.includes('2023')) return RECIPIENTS_HTML_2023;
      return '<html></html>';
    });

    // Match Breaker (id=u-breaker, netid=rrb1) and Arnsten (id=u-arnsten, netid=arnsten1).
    const userFinder = vi.fn(async (q: any) => {
      const lnameSrc: string = q.lname?.source || '';
      if (/Breaker/i.test(lnameSrc)) {
        return [
          {
            _id: 'u-breaker',
            netid: 'rrb1',
            fname: 'Ronald',
            lname: 'Breaker',
            primary_department: 'MCDB',
          },
        ];
      }
      if (/Arnsten/i.test(lnameSrc)) {
        return [
          {
            _id: 'u-arnsten',
            netid: 'arnsten1',
            fname: 'Amy',
            lname: 'Arnsten',
            primary_department: 'Neuroscience',
          },
        ];
      }
      return [];
    });

    const ownerToGroupSlug = vi.fn(async (owner: UserMatch) => {
      return `${owner.lname.toLowerCase()}-lab-${owner.netid}`;
    });

    const configs: ProgramConfig[] = [
      {
        programKey: 'fake-program',
        programName: 'Fake Test Fellowship',
        urls: [
          'https://example.invalid/recipients/2024/',
          'https://example.invalid/recipients/2023/',
        ],
        extractor: drupalRecipientRowExtractor,
      },
    ];

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder,
      ownerToGroupSlug,
    });

    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    // 2 distinct advisors emitted (Breaker, Arnsten)
    expect(result.entitiesObserved).toBe(2);
    // 2 advisors * 3 obs each = 6
    expect(result.observationCount).toBe(6);

    // Breaker should have 2024 (count 2 — Alice + Diana) and 2023 (count 1 — Eve).
    const breakerObs = emitted.filter((o) => o.entityKey === 'breaker-lab-rrb1');
    const breakerPast = breakerObs.find((o) => o.field === 'pastUndergradAdvisees')!;
    const breakerAdvisees = breakerPast.value as Array<{
      year: number;
      programName: string;
      count: number;
    }>;
    expect(breakerAdvisees).toHaveLength(2);
    expect(breakerAdvisees[0]).toEqual({
      year: 2024,
      programName: 'Fake Test Fellowship',
      count: 2,
    });
    expect(breakerAdvisees[1]).toEqual({
      year: 2023,
      programName: 'Fake Test Fellowship',
      count: 1,
    });

    const breakerAccepting = breakerObs.find((o) => o.field === 'acceptingUndergrads')!;
    expect(breakerAccepting.value).toBe(true);
    expect(breakerAccepting.confidenceOverride).toBe(0.8);

    // Arnsten should have just 2024 (Bob)
    const arnstenObs = emitted.filter((o) => o.entityKey === 'arnsten-lab-arnsten1');
    const arnstenPast = arnstenObs.find((o) => o.field === 'pastUndergradAdvisees')!;
    expect(arnstenPast.value).toEqual([
      { year: 2024, programName: 'Fake Test Fellowship', count: 1 },
    ]);

    expect(result.notes).toContain('fake-program=2');
  });

  it('silently skips advisors that cannot be matched against the User collection', async () => {
    const fetchPage = vi.fn(async () => RECIPIENTS_HTML_2024);
    // Match nothing — every advisor lookup returns empty
    const userFinder = vi.fn(async () => []);
    const ownerToGroupSlug = vi.fn(async () => 'should-never-be-called');

    const configs: ProgramConfig[] = [
      {
        programKey: 'fake',
        programName: 'Fake',
        urls: ['https://example.invalid/2024/'],
        extractor: drupalRecipientRowExtractor,
      },
    ];

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder,
      ownerToGroupSlug,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(ownerToGroupSlug).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toContain('unmatched');
  });

  it('honors --only filter to skip non-matching programs', async () => {
    const extA = vi.fn(drupalRecipientRowExtractor);
    const extB = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'program-a',
        programName: 'Program A',
        urls: ['https://example.invalid/a/2024/'],
        extractor: extA,
      },
      {
        programKey: 'program-b',
        programName: 'Program B',
        urls: ['https://example.invalid/b/2024/'],
        extractor: extB,
      },
    ];
    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage: vi.fn(async () => RECIPIENTS_HTML_2024),
      userFinder: vi.fn(async () => []),
      ownerToGroupSlug: vi.fn(async () => null),
    });

    const { ctx } = makeContext({ only: ['program-b'] });
    await scraper.run(ctx);

    expect(extA).not.toHaveBeenCalled();
    expect(extB).toHaveBeenCalledTimes(1);
  });

  it('skips configs marked manualUploadRequired without invoking the extractor or fetcher', async () => {
    const stubExt = vi.fn(manualUploadStub);
    const liveExt = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'pdf-only',
        programName: 'PDF only program',
        urls: ['https://example.invalid/symposium-2024.pdf'],
        extractor: stubExt,
        manualUploadRequired: true,
        skipReason: 'PDF only',
      },
      {
        programKey: 'live',
        programName: 'Live Program',
        urls: ['https://example.invalid/2024/'],
        extractor: liveExt,
      },
    ];

    const fetchedUrls: string[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      return RECIPIENTS_HTML_2024;
    });
    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder: vi.fn(async () => []),
      ownerToGroupSlug: vi.fn(async () => null),
    });
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(stubExt).not.toHaveBeenCalled();
    expect(liveExt).toHaveBeenCalledTimes(1);
    // fetchPage should only have been called for the live URL, not the PDF stub
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchedUrls[0]).toContain('/2024/');
    expect(result.notes).toContain('pdf-only=manual-upload-required');
  });

  it('records extractor failure status and continues to the next program', async () => {
    const failing: any = vi.fn(() => {
      throw new Error('boom');
    });
    const working = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'broken',
        programName: 'Broken Program',
        urls: ['https://example.invalid/broken'],
        extractor: failing,
      },
      {
        programKey: 'works',
        programName: 'Working Program',
        urls: ['https://example.invalid/2024/'],
        extractor: working,
      },
    ];

    const userFinder = vi.fn(async (q: any) => {
      if (/Breaker/i.test(q.lname?.source || '')) {
        return [{ _id: 'b', netid: 'rrb1', fname: 'Ronald', lname: 'Breaker' }];
      }
      return [];
    });
    const ownerToGroupSlug = vi.fn(async (u: UserMatch) => `${u.lname}-${u.netid}`);

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage: vi.fn(async () => RECIPIENTS_HTML_2024),
      userFinder,
      ownerToGroupSlug,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.notes).toContain('broken=extractor-failed');
    expect(result.notes).toContain('works=1');
    // The working program should still emit observations for Breaker (2 students aggregated as count=2)
    expect(emitted.some((o) => o.entityKey === 'Breaker-rrb1')).toBe(true);
  });

  it('records fetch failure but does not crash the run; recipient list is empty', async () => {
    const ext = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'unreachable',
        programName: 'Unreachable',
        urls: ['https://will-fail.invalid/x'],
        extractor: ext,
      },
    ];
    const fetchPage = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder: vi.fn(async () => []),
      ownerToGroupSlug: vi.fn(async () => null),
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted).toEqual([]);
    expect(ext).not.toHaveBeenCalled();
    expect(result.notes).toContain('unreachable=empty');
  });

  it('caps recipients processed at the limit option', async () => {
    // Build a recipient page with 5 distinct advisors so each consumes one slot.
    const html = `
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S1</span><span class="advisor-name">First Aaa</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S2</span><span class="advisor-name">Second Bbb</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S3</span><span class="advisor-name">Third Ccc</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S4</span><span class="advisor-name">Fourth Ddd</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S5</span><span class="advisor-name">Fifth Eee</span>
      </div>
    `;
    const fetchPage = vi.fn(async () => html);

    // Track distinct advisor lname values queried (findUserForAdvisor can call
    // the finder up to 3 times per advisor as it falls back through strategies).
    const distinctLnames = new Set<string>();
    const userFinder = vi.fn(async (q: any) => {
      const src: string = q.lname?.source || '';
      const lname = src.replace(/^\^|\$$/g, '');
      if (lname) distinctLnames.add(lname);
      return [];
    });
    const ownerToGroupSlug = vi.fn(async () => null);
    const configs: ProgramConfig[] = [
      {
        programKey: 'big',
        programName: 'Big Program',
        urls: ['https://example.invalid/2024/'],
        extractor: drupalRecipientRowExtractor,
      },
    ];

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder,
      ownerToGroupSlug,
    });
    const { ctx } = makeContext({ limit: 2 });
    await scraper.run(ctx);

    // Limit caps the recipients consumed; only the first 2 advisors should be
    // queried (each appears under a distinct lname).
    expect(distinctLnames.size).toBe(2);
    expect(distinctLnames).toEqual(new Set(['Aaa', 'Bbb']));
  });
});
