import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUDENT_GRANTS_SEARCH_URL,
  STUDENT_GRANTS_DATABASE_SOURCE,
  StudentGrantsDatabaseScraper,
  createRenderedStudentGrantsHtmlFetcher,
  fundToObservations,
  isRecordSpecificFundDetailUrl,
  parseFundDetailPage,
  parseFundSearchResults,
  sourceKeyForFund,
} from '../sources/studentGrantsDatabaseScraper';
import type { ObservationInput, ScraperContext } from '../types';

const FUND_A_URL =
  'https://yale.communityforce.com/Funds/FundDetails.aspx?B4C5D6E7F8091A2B3C4D5E6F';
const FUND_B_URL = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FundID=42';

const SEARCH_RESULTS_HTML = `
  <html><body>
    <nav><a href="/Login.aspx">Login</a></nav>
    <ul class="fund-results">
      <li>
        <a href="${FUND_A_URL}">Richter Summer Research Fellowship</a>
        <span>Deadline: February 12, 2099</span>
      </li>
      <li>
        <a href="/Funds/FundDetails.aspx?FundID=42">Global Health Travel Grant</a>
      </li>
      <li>
        <a href="/Funds/FundDetails.aspx?FundID=42" title="Global Health Travel Grant">Learn more</a>
      </li>
      <li><a href="https://yale.communityforce.com/">Back to portal home</a></li>
      <li><a href="/Funds/Search.aspx">Search all funds</a></li>
      <li><a href="https://example.com/apply">External page</a></li>
    </ul>
  </body></html>
`;

const P = 'ctl00_PreContent_FundDetails1_';

function facetPanel(id: number, label: string, values: string[]): string {
  const items = values.map((value) => `<li> ${value}</ li>`).join('');
  return `<div id="${P}${id}"><DIV id="${P}divHeader_${id}"><img src="../Images/plus.gif" /> <b>${label}</b></DIV></div>
    <div id="${P}pnlBody_${id}"><DIV id="${P}divBody_${id}"><ul id='ul${id}'>${items}<ul></DIV></div>`;
}

function fundDetailHtml(
  options: {
    opens?: string;
    deadline?: string;
    closedOn?: string;
    award?: string;
  } = {},
): string {
  const {
    opens = '1/15/2099',
    deadline = '2/12/2099 12:00 PM',
    closedOn = '',
    award = '',
  } = options;
  return `
  <html><body>
    <nav><a href="/Login.aspx">Login</a></nav>
    <div class="fdi-date-info">
      <div id="${P}spnBeginApplication" class="fdi-start-date-title"> Begin Accepting Applications Date: </div>
      <div class="fdi-start-date"> ${opens} </div>
      <div id="${P}spnDeadlineApplication" class="fdi-start-date-title"> <strong>Deadline Date (EST Time Zone):</strong> </div>
      <div class="fdi-start-date"> ${deadline} </div>
    </div>
    <span id="${P}lblFundName">Fixture Summer Research Fellowship</span>
    <span id="${P}lblAwardAmount">${award}</span>
    <span id="${P}lblFundClosedOn">${closedOn}</span>
    <span id="${P}lblReasonClosed"></span>
    <span id="${P}lblBriefDescription"><h1 class='Grant_Criteria_hd'>Brief Description:</h1>The fellowship funds independent summer research projects proposed by Yale College undergraduates working under a faculty mentor.</span>
    <span id="${P}lblApplicationInformation"></span>
    <span id="${P}lblSpecialEligibilityRequirements"><h1 class='Grant_Criteria_hd'>Special Eligibility Requirements:</h1>Enrolled Yale College undergraduates in good standing.</span>
    <span id="${P}lblRestrictionstoUseofAward"></span>
    <span id="${P}lblFundContactInformation"><h1 class='Grant_Criteria_hd'>Contact Information:</h1>For questions, contact <a href=mailto:fixture.contact@example.org>fixture.contact@example.org</a></span>
    <span id="${P}lblEligibilityRequirements"><h1 class='Grant_Criteria_hd'>Search Filters:</h1></span>
    ${facetPanel(1, 'Current Year of Study', ['Sophomore', 'Junior'])}
    ${facetPanel(2, 'Term of Award', ['Summer'])}
    ${facetPanel(3, 'Grant or Fellowship Purpose', ['Research', 'Travel'])}
    ${facetPanel(4, 'Global Region or Country', ['Europe', '-- France (Western Europe)', 'Asia', '-- Japan (East Asia)'])}
    ${facetPanel(5, 'Citizenship Status', ['U.S. citizens are eligible'])}
  </body></html>`;
}

const FUND_A_DETAIL_HTML = fundDetailHtml({ award: 'Award Amount: $4,000' });

const AUTH_SHELL_HTML = `
  <html><body>
    <div id="ctl00_PreContent">
      <h1 class='Grant_Criteria_hd'>Search Filters:</h1>
      <a href="/Login.aspx">Login</a>
    </div>
  </body></html>
`;

function makeContext(overrides: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
} {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-test',
    sourceId: 'source-test',
    sourceName: STUDENT_GRANTS_DATABASE_SOURCE,
    sourceWeight: 0.95,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('isRecordSpecificFundDetailUrl', () => {
  it('accepts a FundDetails page with a query string', () => {
    expect(isRecordSpecificFundDetailUrl(FUND_A_URL)).toBe(true);
    expect(isRecordSpecificFundDetailUrl(FUND_B_URL)).toBe(true);
  });

  it('rejects the bare portal root, the search index, and non-CommunityForce hosts', () => {
    expect(isRecordSpecificFundDetailUrl('https://yale.communityforce.com/')).toBe(false);
    expect(isRecordSpecificFundDetailUrl('https://yale.communityforce.com/Funds/Search.aspx')).toBe(
      false,
    );
    expect(
      isRecordSpecificFundDetailUrl('https://yale.communityforce.com/Funds/FundDetails.aspx'),
    ).toBe(false);
    expect(isRecordSpecificFundDetailUrl('https://example.com/FundDetails.aspx?x=1')).toBe(false);
    expect(isRecordSpecificFundDetailUrl(undefined)).toBe(false);
  });
});

describe('parseFundSearchResults', () => {
  it('enumerates record-specific FundDetails links, deduped, ignoring roots and off-host links', () => {
    const funds = parseFundSearchResults(SEARCH_RESULTS_HTML, DEFAULT_STUDENT_GRANTS_SEARCH_URL);
    const urls = funds.map((fund) => fund.url).sort();
    expect(urls).toEqual([FUND_A_URL, FUND_B_URL].sort());
    const globalHealth = funds.find((fund) => fund.url === FUND_B_URL);
    expect(globalHealth?.title).toBe('Global Health Travel Grant');
  });
});

describe('parseFundDetailPage', () => {
  const referenceDate = new Date('2099-02-01T00:00:00Z');

  it('reads each field from its own element on a server-rendered fund page', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(fund).toMatchObject({
      title: 'Fixture Summer Research Fellowship',
      url: FUND_A_URL,
      sourceKey: sourceKeyForFund(FUND_A_URL),
      awardAmount: '$4,000',
      yearOfStudy: ['Sophomore', 'Junior'],
      termOfAward: ['Summer'],
      purpose: ['Research', 'Travel'],
      citizenshipStatus: ['U.S. citizens are eligible'],
      isAcceptingApplications: true,
    });
    expect(fund?.description).toMatch(/^The fellowship funds independent summer research/);
    expect(fund?.eligibility).toBe('Enrolled Yale College undergraduates in good standing.');
    expect(fund?.applicationInformation).toBeUndefined();
  });

  it('takes the deadline and the opening date from their own labels', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(fund?.deadline?.toISOString()).toBe('2099-02-12T23:59:59.999Z');
    expect(fund?.applicationOpenDate?.toISOString()).toBe('2099-01-15T00:00:00.000Z');
  });

  it('keeps regions and drops the countries listed under them', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(fund?.globalRegions).toEqual(['Europe', 'Asia']);
  });

  it('never reads the contact block', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(JSON.stringify(fund)).not.toContain('example.org');
  });

  it('fails closed on a page with no fund name', () => {
    expect(
      parseFundDetailPage(AUTH_SHELL_HTML, { title: 'Anything', url: FUND_A_URL }, referenceDate),
    ).toBeNull();
  });

  it('is not accepting before the window opens, after the deadline, or once closed', () => {
    const page = (options: Parameters<typeof fundDetailHtml>[0]) =>
      parseFundDetailPage(fundDetailHtml(options), { title: '', url: FUND_A_URL }, referenceDate);
    expect(page({ opens: '3/01/2099' })?.isAcceptingApplications).toBe(false);
    expect(page({ deadline: '1/20/2099' })?.isAcceptingApplications).toBe(false);
    expect(page({ closedOn: 'Closed on 1/25/2099' })?.isAcceptingApplications).toBe(false);
  });
});

describe('fundToObservations', () => {
  it('emits fellowship observations citing the fund detail URL as source and application link', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      new Date('2099-02-01T00:00:00Z'),
    )!;
    const observations = fundToObservations(fund);
    const byField = new Map(observations.map((obs) => [obs.field, obs.value]));

    expect(observations.every((obs) => obs.entityType === 'fellowship')).toBe(true);
    expect(observations.every((obs) => obs.sourceUrl === FUND_A_URL)).toBe(true);
    expect(observations.every((obs) => obs.entityKey === fund.sourceKey)).toBe(true);
    expect(byField.get('sourceName')).toBe(STUDENT_GRANTS_DATABASE_SOURCE);
    expect(byField.get('applicationLink')).toBe(FUND_A_URL);
    expect(byField.get('awardAmount')).toBe('$4,000');
    expect(byField.get('applicationOpenDate')).toEqual(new Date('2099-01-15T00:00:00.000Z'));
    expect(byField.get('archived')).toBe(false);
    expect([...byField.keys()]).not.toContain('contactEmail');
  });
});

describe('createRenderedStudentGrantsHtmlFetcher', () => {
  it('returns no HTML for a rendered 404 page the bridge does not flag as blocked', async () => {
    const renderedFetcher = vi.fn().mockResolvedValue({
      url: FUND_B_URL,
      html: '<html><body><h1>Page not found</h1></body></html>',
      statusCode: 404,
      blocked: false,
      fetchMode: 'scrapling',
    });
    const fetchHtml = createRenderedStudentGrantsHtmlFetcher(renderedFetcher);

    await expect(fetchHtml(FUND_B_URL, false, STUDENT_GRANTS_DATABASE_SOURCE)).resolves.toBe('');
    expect(renderedFetcher).toHaveBeenCalledWith(expect.objectContaining({ mode: 'stealthy' }));
  });
});

describe('StudentGrantsDatabaseScraper.run', () => {
  it('reads the fund pages the catalog cites when the search grid does not render', async () => {
    const searchFetcher = vi.fn(async () => '');
    const detailFetcher = vi.fn(async (url: string) =>
      url === FUND_A_URL ? FUND_A_DETAIL_HTML : '',
    );
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher,
      detailFetcher,
      loadSeedUrls: async () => [FUND_A_URL],
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(emitted.find((obs) => obs.field === 'title')?.value).toBe(
      'Fixture Summer Research Fellowship',
    );
    expect(detailFetcher).toHaveBeenCalledWith(FUND_A_URL, false, STUDENT_GRANTS_DATABASE_SOURCE);
  });

  it('emits nothing when neither the grid nor any cited fund page yields a fund', async () => {
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher: vi.fn(async () => AUTH_SHELL_HTML),
      loadSeedUrls: async () => [FUND_B_URL],
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.observationCount).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it('reads each fund once whether the grid or a citation found it', async () => {
    const detailFetcher = vi.fn(async (url: string) =>
      url === FUND_A_URL ? FUND_A_DETAIL_HTML : AUTH_SHELL_HTML,
    );
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => SEARCH_RESULTS_HTML),
      detailFetcher,
      loadSeedUrls: async () => [FUND_A_URL],
    });
    const { ctx } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(detailFetcher.mock.calls.map(([url]) => url).sort()).toEqual(
      [FUND_A_URL, FUND_B_URL].sort(),
    );
  });

  it('reads only the funds an entity-scoped run names', async () => {
    const detailFetcher = vi.fn(async (_url: string) => FUND_A_DETAIL_HTML);
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher,
      loadSeedUrls: async () => [FUND_A_URL, FUND_B_URL],
    });
    const { ctx } = makeContext({ only: [sourceKeyForFund(FUND_B_URL)] });

    await scraper.run(ctx);

    expect(detailFetcher.mock.calls.map(([url]) => url)).toEqual([FUND_B_URL]);
  });
});
