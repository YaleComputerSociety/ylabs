/**
 * Unit tests for NehGrantScraper.
 *
 * No network, no Mongo - the NEH Award Search fetch, the researcher resolver and
 * the research-row resolver are injected, so the tests exercise the full run()
 * path against synthetic Award Search pages.
 */
import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  NehGrantScraper,
  awardSearchQueryUrl,
  grantToRecord,
  groupGrantsByLeadPi,
  hasRequiredNehHeaders,
  isYaleAwardee,
  maxStartDate,
  nehGrantUrl,
  parseAwardPeriod,
  parseNehAmount,
  parseNehAwardSearchPage,
  parseNehDate,
  parseYear,
  piGroupKey,
  recordToNehGrant,
  sortGrantsByRecency,
  yearShardsForLookback,
} from '../sources/nehGrantScraper';
import type { ObservationInput, ScraperContext } from '../types';

const GRID_HEADERS = [
  'Award Number',
  'Grant Program',
  'Award Recipient',
  'Project Title',
  'Award Period',
  'Approved Award Total',
  'Project Director First Name',
  'Project Director Middle Name',
  'Project Director Last Name',
  'Co-Project Director First Name',
  'Co-Project Director Middle Name',
  'Co-Project Director Last Name',
  'Organization',
  'Organization City',
  'Organization State',
  'Organization Postal Code',
  'Organization Country',
  'Year Awarded',
  'Primary Humanities Discipline',
  'Grant Program Name',
  'Division or Office',
  'Approved Outright Funds',
  'Approved Matching Funds',
  'Awarded Outright Funds',
  'Awarded Matching Funds',
  'Description',
];

type GridRow = Partial<Record<(typeof GRID_HEADERS)[number], string>>;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function awardSearchPage(
  rows: GridRow[],
  options: { headers?: string[]; reportedCount?: number } = {},
): string {
  const headers = options.headers ?? GRID_HEADERS;
  const count = options.reportedCount ?? rows.length;
  const th = headers
    .map(
      (h) =>
        `<th scope="col" class="rgHeader"><a href="javascript:void(0)">${escapeHtml(h)}</a>&nbsp;<button type="button" value="Sorted asc">sort</button></th>`,
    )
    .join('');
  const body = rows
    .map((row, index) => {
      const cells = headers
        .map((h, i) => {
          const value = row[h as keyof GridRow] ?? '';
          const hidden = i >= 6 ? ' style="display:none;"' : '';
          const content =
            h === 'Award Number' && value
              ? `<a href="AwardDetail.aspx?gn=${value}">${value}</a>`
              : h === 'Description'
                ? `<p>${escapeHtml(value)}</p>\n<p>Second paragraph.</p>`
                : value
                  ? escapeHtml(value)
                  : '&nbsp;';
          return `<td${hidden}>${content}</td>`;
        })
        .join('');
      return `<tr class="${index % 2 ? 'rgAltRow' : 'rgRow'}">${cells}</tr>`;
    })
    .join('');
  return `<html><body><div id="cphMainContent_pnlResults"><span id="cphMainContent_lblQueryError"></span>
<table class="rgMasterTable"><thead>
<tr class="rgCommandRow"><td class="rgCommandCell"><button>Download to CSV</button></td></tr>
<tr class="rgPager"><td class="rgPagerCell"><div class="rgWrap rgInfoPart">&nbsp;<strong>${count}</strong> items in <strong>1</strong> pages</div></td></tr>
<tr>${th}</tr></thead><tbody>${body}</tbody></table></div></body></html>`;
}

const EMPTY_RESULTS_PAGE =
  '<html><body><div id="cphMainContent_pnlResults"><span id="cphMainContent_lblResultsSummary"></span><span id="cphMainContent_lblQueryError"></span></div></body></html>';

const ERROR_PAGE =
  '<html><body><h1>NEH Award Search: Error</h1><p>An error has occurred in the Award Search tool.</p></body></html>';

const FELLOWSHIP: GridRow = {
  'Award Number': 'FEL-000001-24',
  'Grant Program': 'Research: Fellowships',
  'Award Recipient': 'Avery Placeholder',
  'Project Title': 'Synthetic Study of Placeholder Manuscripts',
  'Award Period': '7/1/2024 - 6/30/2025',
  'Approved Award Total': '$60,000.00',
  'Project Director First Name': 'Avery',
  'Project Director Last Name': 'Placeholder',
  Organization: 'Yale University',
  'Organization City': 'New Haven',
  'Organization State': 'CT',
  'Year Awarded': '2024',
  'Primary Humanities Discipline': 'Film History and Criticism',
  'Grant Program Name': 'Fellowships',
  'Division or Office': 'Research',
  'Approved Outright Funds': '60000',
  'Approved Matching Funds': '0',
  'Awarded Outright Funds': '60000',
  'Awarded Matching Funds': '0',
  Description: 'Research and writing leading to a book.',
};

const COLLABORATIVE: GridRow = {
  ...FELLOWSHIP,
  'Award Number': 'RZ-000002-25',
  'Grant Program': 'Research: Collaborative Research',
  'Project Title': 'Synthetic Collaborative Edition',
  'Award Period': '9/1/2025 - 8/31/2027',
  'Co-Project Director First Name': 'Jordan',
  'Co-Project Director Last Name': 'Example',
  'Year Awarded': '2025',
  'Awarded Outright Funds': '150000',
  'Awarded Matching Funds': '25000',
};

const NON_YALE: GridRow = {
  ...FELLOWSHIP,
  'Award Number': 'FEL-000003-24',
  Organization: 'Placeholder State University',
  'Project Director First Name': 'Riley',
  'Project Director Last Name': 'Sample',
};

const YALE_OUT_OF_STATE: GridRow = {
  ...FELLOWSHIP,
  'Award Number': 'FEL-000004-24',
  'Organization State': 'NY',
  'Project Director First Name': 'Casey',
  'Project Director Last Name': 'Stand-In',
};

const PI_ID = '507f1f77bcf86cd799439011';

function gridRecord(row: GridRow) {
  const page = parseNehAwardSearchPage(awardSearchPage([row]));
  if (page.kind !== 'grid') throw new Error('expected a grid');
  return page.records[0];
}

describe('parseNehAwardSearchPage', () => {
  it('reads the grid by header name, including the hidden columns', () => {
    const page = parseNehAwardSearchPage(awardSearchPage([FELLOWSHIP, COLLABORATIVE]));
    expect(page.kind).toBe('grid');
    if (page.kind !== 'grid') return;
    expect(page.reportedCount).toBe(2);
    expect(page.records).toHaveLength(2);
    expect(page.headers).toContain('projectdirectorlastname');
    expect(page.headers[0]).toBe('awardnumber');
    expect(page.records[0].awardnumber).toBe('FEL-000001-24');
    expect(page.records[0].organizationstate).toBe('CT');
    expect(page.records[0].projectdirectormiddlename).toBe('');
    expect(page.records[1].coprojectdirectorlastname).toBe('Example');
    expect(page.records[0].description).toBe(
      'Research and writing leading to a book. Second paragraph.',
    );
    expect(hasRequiredNehHeaders(page.headers)).toBe(true);
  });

  it('recognises an empty result set as empty rather than drift', () => {
    expect(parseNehAwardSearchPage(EMPTY_RESULTS_PAGE)).toEqual({ kind: 'empty' });
  });

  it('refuses an error page or a query error as unrecognised', () => {
    expect(parseNehAwardSearchPage(ERROR_PAGE)).toEqual({ kind: 'unrecognised' });
    const queryError = EMPTY_RESULTS_PAGE.replace(
      '<span id="cphMainContent_lblQueryError"></span>',
      '<span id="cphMainContent_lblQueryError">The query could not be parsed.</span>',
    );
    expect(parseNehAwardSearchPage(queryError)).toEqual({ kind: 'unrecognised' });
  });

  it('flags a renamed required column as missing', () => {
    const headers = GRID_HEADERS.map((h) =>
      h === 'Project Director Last Name' ? 'Director Surname' : h,
    );
    const page = parseNehAwardSearchPage(awardSearchPage([FELLOWSHIP], { headers }));
    expect(page.kind).toBe('grid');
    if (page.kind !== 'grid') return;
    expect(hasRequiredNehHeaders(page.headers)).toBe(false);
  });
});

describe('record helpers', () => {
  it('parses dates, periods, amounts and years', () => {
    expect(parseNehDate('7/1/2024')?.getFullYear()).toBe(2024);
    expect(parseNehDate('garbage')).toBeUndefined();
    const period = parseAwardPeriod('9/1/2025 - 8/31/2027');
    expect(period.begin?.getMonth()).toBe(8);
    expect(period.end?.getFullYear()).toBe(2027);
    expect(parseAwardPeriod('')).toEqual({ begin: undefined, end: undefined });
    expect(parseNehAmount('$60,000.00')).toBe(60000);
    expect(parseNehAmount('0')).toBeUndefined();
    expect(parseYear('2024')).toBe(2024);
    expect(parseYear('')).toBeUndefined();
  });

  it('identifies Yale awardees in Connecticut only', () => {
    expect(isYaleAwardee(gridRecord(FELLOWSHIP))).toBe(true);
    expect(isYaleAwardee(gridRecord(NON_YALE))).toBe(false);
    expect(isYaleAwardee(gridRecord(YALE_OUT_OF_STATE))).toBe(false);
  });

  it('maps a grid row to a grant with the director as lead and awarded totals', () => {
    const grant = recordToNehGrant(gridRecord(COLLABORATIVE));
    expect(grant?.appNumber).toBe('RZ-000002-25');
    expect(grant?.participants.map((p) => [p.fullName, p.isLead])).toEqual([
      ['Avery Placeholder', true],
      ['Jordan Example', false],
    ]);
    expect(grant?.awardOutright).toBe(175000);
    expect(grant?.yearAwarded).toBe(2025);
    expect(grant?.program).toBe('Fellowships');
  });

  it('drops a row with no award number, title or director surname', () => {
    expect(recordToNehGrant(gridRecord({ ...FELLOWSHIP, 'Award Number': '' }))).toBeNull();
    expect(recordToNehGrant(gridRecord({ ...FELLOWSHIP, 'Project Title': '' }))).toBeNull();
    expect(
      recordToNehGrant(gridRecord({ ...FELLOWSHIP, 'Project Director Last Name': '' })),
    ).toBeNull();
  });

  it('groups grants by lead director and cites the current award detail page', () => {
    const grants = [FELLOWSHIP, COLLABORATIVE].map((r) => recordToNehGrant(gridRecord(r))!);
    const groups = groupGrantsByLeadPi(grants);
    expect(groups).toHaveLength(1);
    expect(groups[0].awards).toHaveLength(2);
    expect(piGroupKey('AVERY', 'Placeholder')).toBe('avery placeholder');
    const records = sortGrantsByRecency(grants.map((g) => grantToRecord(g)));
    expect(records[0].id).toBe('RZ-000002-25');
    expect(records[0].url).toBe(nehGrantUrl('RZ-000002-25'));
    expect(nehGrantUrl('RZ-000002-25')).toBe(
      'https://awardsearch.neh.gov/AwardDetail.aspx?gn=RZ-000002-25',
    );
    expect(maxStartDate(grants)?.getFullYear()).toBe(2025);
  });

  it('queries one year per shard across the lookback window', () => {
    expect(yearShardsForLookback(2026, 3)).toEqual([2023, 2024, 2025, 2026]);
    const url = new URL(awardSearchQueryUrl(2024));
    expect(url.origin).toBe('https://awardsearch.neh.gov');
    expect(url.searchParams.get('ov')).toBe('Yale');
    expect(url.searchParams.get('sv')).toBe('CT');
    expect(url.searchParams.get('yf')).toBe('2024');
    expect(url.searchParams.get('yt')).toBe('2024');
  });
});

function buildContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'neh-funded-projects',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false, ...overrides },
    emit: async (input) => {
      const arr = Array.isArray(input) ? input : [input];
      for (const o of arr) emitted.push(o);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

const matched = async () => ({
  status: 'matched' as const,
  researcherId: new mongoose.Types.ObjectId(PI_ID),
});

function scraperFor(
  pagesByYear: Record<number, string>,
  deps: Partial<ConstructorParameters<typeof NehGrantScraper>[0]> = {},
) {
  const fetchAwardSearchYear = vi.fn(async (year: number) => {
    const page = pagesByYear[year];
    if (page === undefined) return EMPTY_RESULTS_PAGE;
    return page;
  });
  const scraper = new NehGrantScraper({
    fetchAwardSearchYear: fetchAwardSearchYear as any,
    resolveResearcherId: matched,
    researchHomeResolver: vi.fn().mockResolvedValue({ status: 'canonical', slug: 'dept-row' }),
    currentYear: 2026,
    lookbackYears: 6,
    ...deps,
  });
  return { scraper, fetchAwardSearchYear };
}

describe('NehGrantScraper.run', () => {
  it('enriches the existing research row and never emits identity fields', async () => {
    const researchHomeResolver = vi
      .fn()
      .mockResolvedValue({ status: 'canonical', slug: 'dept-film-row' });
    const { scraper, fetchAwardSearchYear } = scraperFor(
      { 2024: awardSearchPage([FELLOWSHIP]), 2025: awardSearchPage([COLLABORATIVE]) },
      { researchHomeResolver },
    );
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    expect(fetchAwardSearchYear).toHaveBeenCalledTimes(7);
    expect(researchHomeResolver).toHaveBeenCalledWith(PI_ID);
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(emitted.every((o) => o.entityType === 'researchEntity')).toBe(true);
    expect(emitted.every((o) => o.entityKey === 'dept-film-row')).toBe(true);
    expect(emitted.every((o) => o.sourceUrl === 'https://awardsearch.neh.gov/')).toBe(true);
    const fields = emitted.map((o) => o.field);
    for (const identity of ['slug', 'name', 'kind', 'entityType']) {
      expect(fields).not.toContain(identity);
    }
    expect(emitted.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);
    expect(emitted.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['NEH']);
    expect(emitted.find((o) => o.field === 'inferredPiUserId')?.value).toBe(PI_ID);
    const grants = emitted.find((o) => o.field === 'recentGrants')?.value as Array<{
      url: string;
    }>;
    expect(
      grants.every((g) => g.url.startsWith('https://awardsearch.neh.gov/AwardDetail.aspx')),
    ).toBe(true);
    for (const forbidden of ['signal', 'pathway', 'opportunity', 'contactroute']) {
      expect(fields.some((f) => f.toLowerCase().includes(forbidden))).toBe(false);
    }
    expect(result.notes).toMatch(/rows enriched: 1/);
  });

  it('mints nothing for a director with no existing research row, and says so', async () => {
    const { scraper } = scraperFor(
      { 2024: awardSearchPage([FELLOWSHIP]) },
      { researchHomeResolver: vi.fn().mockResolvedValue({ status: 'safe-shell' }) },
    );
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/1 have no existing research row/);
  });

  it('mints nothing for a director who resolves to nobody or to several people', async () => {
    const unresolved = scraperFor(
      { 2024: awardSearchPage([FELLOWSHIP]) },
      { resolveResearcherId: async () => ({ status: 'absent' as const }) },
    );
    const run1 = buildContext();
    const r1 = await unresolved.scraper.run(run1.ctx);
    expect(run1.emitted).toHaveLength(0);
    expect(r1.notes).toMatch(/1 resolved to no researcher/);

    const ambiguous = scraperFor(
      { 2024: awardSearchPage([FELLOWSHIP]) },
      { resolveResearcherId: async () => ({ status: 'ambiguous' as const }) },
    );
    const run2 = buildContext();
    const r2 = await ambiguous.scraper.run(run2.ctx);
    expect(run2.emitted).toHaveLength(0);
    expect(r2.notes).toMatch(/1 resolved to several researchers/);
  });

  it('skips an ineligible or ambiguous research row', async () => {
    for (const status of ['ineligible', 'ambiguous'] as const) {
      const { scraper } = scraperFor(
        { 2024: awardSearchPage([FELLOWSHIP]) },
        { researchHomeResolver: vi.fn().mockResolvedValue({ status }) },
      );
      const { ctx, emitted } = buildContext();
      const result = await scraper.run(ctx);
      expect(emitted).toHaveLength(0);
      expect(result.notes).toMatch(new RegExp(`1 ${status} row`));
    }
  });

  it('filters non-Yale and out-of-state rows and dedupes an award seen in two shards', async () => {
    const { scraper } = scraperFor({
      2024: awardSearchPage([FELLOWSHIP, NON_YALE, YALE_OUT_OF_STATE]),
      2025: awardSearchPage([FELLOWSHIP]),
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted.find((o) => o.field === 'recentGrantCount')?.value).toBe(1);
    expect(result.notes).toMatch(/Yale NEH awards since 2020: 1;/);
  });

  it('drops awards older than the lookback cutoff', async () => {
    const stale = { ...FELLOWSHIP, 'Award Number': 'FEL-000009-05', 'Year Awarded': '2005' };
    const { scraper } = scraperFor({ 2024: awardSearchPage([stale]) });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it('fails closed with no writes and says so when every shard is unreachable', async () => {
    const { scraper } = scraperFor(
      {},
      {
        fetchAwardSearchYear: vi.fn(async () => {
          throw new Error('Request failed with status code 301');
        }) as any,
      },
    );
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/unreachable; failed closed/);
    expect(result.notes).toMatch(/7 failed/);
  });

  it('fails closed with no writes when every page drifted', async () => {
    const headers = GRID_HEADERS.map((h) =>
      h === 'Project Director Last Name' ? 'Director Surname' : h,
    );
    const drifted = awardSearchPage([FELLOWSHIP], { headers });
    const pages = Object.fromEntries(
      [2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => [y, y % 2 ? ERROR_PAGE : drifted]),
    );
    const { scraper } = scraperFor(pages);
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/page shape drifted; failed closed/);
    expect(result.notes).toMatch(/3 unrecognised page, 4 schema drift/);
  });

  it('reports an empty window as empty rather than as a failure', async () => {
    const { scraper } = scraperFor({});
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/7 fetched, 0 failed, 7 empty/);
    expect(result.notes).toMatch(/Yale NEH awards since 2020: 0;/);
  });

  it('counts a shard that reports more awards than it served as truncated', async () => {
    const { scraper } = scraperFor({ 2024: awardSearchPage([FELLOWSHIP], { reportedCount: 60 }) });
    const { ctx, logs } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.notes).toMatch(/1 truncated/);
    expect(logs.some((l) => /reported 60 awards but served 1/.test(l))).toBe(true);
  });

  it('emits no roster membership for a co-director', async () => {
    const { scraper } = scraperFor({ 2025: awardSearchPage([COLLABORATIVE]) });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);
    expect(emitted.filter((o) => o.entityType === 'researchGroupMember')).toEqual([]);
    expect(
      emitted.filter((o) => o.field === 'researchGroupSlug' || o.field === 'researchGroupKey'),
    ).toEqual([]);
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const { scraper, fetchAwardSearchYear } = scraperFor({});
    const { ctx } = buildContext({ limit: 9007199254740992 } as any);
    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchAwardSearchYear).not.toHaveBeenCalled();
  });

  it('honors --limit by capping directors processed', async () => {
    const rows = Array.from({ length: 5 }, (_v, i) => ({
      ...FELLOWSHIP,
      'Award Number': `FEL-00010${i}-24`,
      'Project Director First Name': `Synthetic${String.fromCharCode(65 + i)}`,
      'Project Director Last Name': `Placeholder${String.fromCharCode(65 + i)}`,
    }));
    const { scraper } = scraperFor({ 2024: awardSearchPage(rows) });
    const { ctx } = buildContext({ limit: 2 });
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(2);
    expect(result.notes).toMatch(/Project Directors: 5 \(2 processed\)/);
  });
});
