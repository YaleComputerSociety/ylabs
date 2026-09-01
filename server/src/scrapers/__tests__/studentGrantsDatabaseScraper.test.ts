import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUDENT_GRANTS_SEARCH_URL,
  STUDENT_GRANTS_DATABASE_SOURCE,
  StudentGrantsDatabaseScraper,
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

const FUND_A_DETAIL_HTML = `
  <html><body>
    <nav><a href="/Login.aspx">Login</a></nav>
    <div id="ctl00_PreContent">
      <h1 class="Grant_hd">Richter Summer Research Fellowship</h1>
      <p>The Richter Fellowship funds independent summer research projects proposed
         by Yale College undergraduates working under a faculty mentor.</p>
      <p>Sponsoring Organization: Yale College Dean's Office</p>
      <p>Award Amount: $4,000</p>
      <p>Deadline: February 12, 2099</p>
      <p>Year of Study: Sophomore, Junior</p>
      <p>Term of Award: Summer</p>
      <p>Purpose: Research, Travel</p>
      <p>Citizenship: All students</p>
      <p>Eligibility: Enrolled Yale College undergraduates in good standing.</p>
    </div>
  </body></html>
`;

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
  const referenceDate = new Date('2099-01-01T00:00:00Z');

  it('extracts identity, description, eligibility, award, sponsor, deadline, and facets', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: 'Richter Summer Research Fellowship', url: FUND_A_URL },
      referenceDate,
    );
    expect(fund).not.toBeNull();
    expect(fund?.title).toBe('Richter Summer Research Fellowship');
    expect(fund?.url).toBe(FUND_A_URL);
    expect(fund?.sourceKey).toBe(sourceKeyForFund(FUND_A_URL));
    expect(fund?.awardAmount).toContain('$4,000');
    expect(fund?.sponsoringOrganization).toContain("Yale College Dean's Office");
    expect(fund?.eligibility).toContain('Yale College undergraduates');
    expect(fund?.deadline?.getUTCFullYear()).toBe(2099);
    expect(fund?.yearOfStudy).toEqual(expect.arrayContaining(['Sophomore', 'Junior']));
    expect(fund?.termOfAward).toContain('Summer');
    expect(fund?.purpose).toEqual(expect.arrayContaining(['Research', 'Travel']));
    expect(fund?.isAcceptingApplications).toBe(true);
    expect(fund?.description).toBeTruthy();
  });

  it('fails closed on an auth/search-filter shell', () => {
    expect(
      parseFundDetailPage(AUTH_SHELL_HTML, { title: '', url: FUND_A_URL }, referenceDate),
    ).toBeNull();
  });

  it('marks a fund with a past deadline as not accepting applications', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: 'Richter Summer Research Fellowship', url: FUND_A_URL },
      new Date('2100-06-01T00:00:00Z'),
    );
    expect(fund?.isAcceptingApplications).toBe(false);
  });
});

describe('fundToObservations', () => {
  it('emits fellowship observations citing the fund detail URL as source and application link', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: 'Richter Summer Research Fellowship', url: FUND_A_URL },
      new Date('2099-01-01T00:00:00Z'),
    )!;
    const observations = fundToObservations(fund);
    const byField = new Map(observations.map((obs) => [obs.field, obs.value]));

    expect(observations.every((obs) => obs.entityType === 'fellowship')).toBe(true);
    expect(observations.every((obs) => obs.sourceUrl === FUND_A_URL)).toBe(true);
    expect(observations.every((obs) => obs.entityKey === fund.sourceKey)).toBe(true);
    expect(byField.get('sourceName')).toBe(STUDENT_GRANTS_DATABASE_SOURCE);
    expect(byField.get('applicationLink')).toBe(FUND_A_URL);
    expect(byField.get('awardAmount')).toContain('$4,000');
    expect(byField.get('eligibility')).toContain('Yale College undergraduates');
    expect(byField.get('archived')).toBe(false);
  });
});

describe('StudentGrantsDatabaseScraper.run', () => {
  it('fails closed and emits nothing when the rendered fetcher is unavailable', async () => {
    const fetcher = vi.fn(async () => '');
    const scraper = new StudentGrantsDatabaseScraper(DEFAULT_STUDENT_GRANTS_SEARCH_URL, fetcher);
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.observationCount).toBe(0);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('enumerates the catalog and emits one fund per resolvable detail page', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === DEFAULT_STUDENT_GRANTS_SEARCH_URL) return SEARCH_RESULTS_HTML;
      if (url === FUND_A_URL) return FUND_A_DETAIL_HTML;
      if (url === FUND_B_URL) return AUTH_SHELL_HTML;
      return '';
    });
    const scraper = new StudentGrantsDatabaseScraper(DEFAULT_STUDENT_GRANTS_SEARCH_URL, fetcher);
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    const titleObs = emitted.find((obs) => obs.field === 'title');
    expect(titleObs?.value).toBe('Richter Summer Research Fellowship');
  });
});
