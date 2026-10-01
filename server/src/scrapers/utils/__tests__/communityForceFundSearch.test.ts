import { describe, expect, it, vi } from 'vitest';
import {
  VIEW_ALL_FUNDS_BUTTON,
  VIEW_ALL_FUNDS_BUTTON_VALUE,
  createStaticFundSearchEnumerator,
  parseFundSearchGrid,
  parsePostbackFund,
  serializeWebForm,
} from '../communityForceFundSearch';
import type { HttpRequestConfig, HttpRequestFn, PublicHttpHopRequest } from '../httpFetch';

const SEARCH_URL = 'https://yale.communityforce.com/Funds/Search.aspx';
const ROW_TARGET = (n: string) => `ctl00$PreContent$GrantsSearch1$grdFund$ctl${n}$lnkFundName`;
const COMMON_APP_URL =
  'https://yale.communityforce.com/Funds/FundDetails.aspx?4141414141414141414141414141';
const ROW_FUND_URL =
  'https://yale.communityforce.com/Funds/FundDetails.aspx?4242424242424242424242424242';
const SHORT_LINK = 'https://short.example/fixture02';

function gridRow(n: string, name: string, description = ''): string {
  const target = ROW_TARGET(n);
  return `<tr><td>
    <h3 id="ctl00_PreContent_GrantsSearch1_grdFund_ctl${n}_dvFundName">
      <a id="ctl00_PreContent_GrantsSearch1_grdFund_ctl${n}_lnkFundName" aria-label="${name}"
        href="javascript:__doPostBack(&#39;${target}&#39;,&#39;&#39;)">${name}</a>
    </h3>
    <span id="ctl00_PreContent_GrantsSearch1_grdFund_ctl${n}_lblDescription">${description}</span>
  </td></tr>`;
}

const SEARCH_HTML = `<html><body><form id="aspnetForm" method="post" action="./Search.aspx">
  <input type="hidden" name="__VIEWSTATE" value="search-state" />
  <input type="hidden" name="__EVENTVALIDATION" value="search-validation" />
  <input type="text" name="ctl00$PreContent$GrantsSearch1$txtKeyword" />
  <select name="ctl00$PreContent$GrantsSearch1$ddlListCriteria11">
    <option value="-1">Any</option><option value="7">Seventh</option>
  </select>
  <select name="ctl00$PreContent$GrantsSearch1$ddlListCriteria12">
    <option value="1">One</option><option value="2" selected="selected">Two</option>
  </select>
  <input type="checkbox" name="ctl00$PreContent$GrantsSearch1$chkUnchecked" />
  <input type="checkbox" name="ctl00$PreContent$GrantsSearch1$chkChecked" checked="checked" />
  <input type="text" name="ctl00$PreContent$GrantsSearch1$txtDisabled" value="x" disabled="disabled" />
  <input type="submit" name="${VIEW_ALL_FUNDS_BUTTON}" value="${VIEW_ALL_FUNDS_BUTTON_VALUE}" />
  <input type="submit" name="ctl00$PreContent$GrantsSearch1$btnSearch" value="Search" />
</form></body></html>`;

const GRID_HTML = `<html><body><form id="aspnetForm" method="post" action="./Search.aspx">
  <input type="hidden" name="__VIEWSTATE" value="grid-state" />
  <input type="hidden" name="__EVENTTARGET" value="" />
  <input type="hidden" name="__EVENTARGUMENT" value="" />
  <table>
    ${gridRow('02', 'Fixture Summer Research Fellowship')}
    ${gridRow('03', 'Fixture Travel Grant', `Apply via the <a href="${COMMON_APP_URL}">Fixture Common Application</a>.`)}
    ${gridRow('02', 'Fixture Summer Research Fellowship')}
  </table>
  <a id="ctl00_PreContent_Other_lnkFundName" href="javascript:__doPostBack(&#39;ctl00$Other&#39;,&#39;&#39;)">Not a row</a>
  <span>Page 1 of 1</span>
</form></body></html>`;

function postbackHtml(name: string, shortLink = SHORT_LINK): string {
  return `<html><body><form id="aspnetForm"><input type="hidden" name="__VIEWSTATE" value="detail-state" />
    <span id="ctl00_PreContent_GrantsSearch1_ctrlFundDetails_lblFundName">${name}</span>
    <a id="ctl00_PreContent_GrantsSearch1_ctrlFundDetails_lnkShortLink" disabled="disabled">${shortLink}</a>
  </form></body></html>`;
}

const passthroughAssert = async (url: string) => new URL(url);

describe('serializeWebForm', () => {
  it('submits what a browser would: state, values, chosen options, checked boxes, and no buttons', () => {
    const fields = serializeWebForm(SEARCH_HTML);

    expect(Array.from(fields.entries())).toEqual([
      ['__VIEWSTATE', 'search-state'],
      ['__EVENTVALIDATION', 'search-validation'],
      ['ctl00$PreContent$GrantsSearch1$txtKeyword', ''],
      ['ctl00$PreContent$GrantsSearch1$ddlListCriteria11', '-1'],
      ['ctl00$PreContent$GrantsSearch1$ddlListCriteria12', '2'],
      ['ctl00$PreContent$GrantsSearch1$chkChecked', 'on'],
    ]);
  });
});

describe('parseFundSearchGrid', () => {
  it('lists each grid row once by its postback target and reads the pager', () => {
    const { rows, pageCount } = parseFundSearchGrid(GRID_HTML);

    expect(rows).toEqual([
      { eventTarget: ROW_TARGET('02'), name: 'Fixture Summer Research Fellowship' },
      { eventTarget: ROW_TARGET('03'), name: 'Fixture Travel Grant' },
    ]);
    expect(pageCount).toBe(1);
  });

  it('reports a grid split across several pages', () => {
    expect(parseFundSearchGrid('<html><body>Page 1 of 3</body></html>').pageCount).toBe(3);
  });
});

describe('parsePostbackFund', () => {
  it('reads the inline fund name and its share link', () => {
    expect(parsePostbackFund(postbackHtml('Fixture Travel Grant'))).toEqual({
      name: 'Fixture Travel Grant',
      shortLink: SHORT_LINK,
    });
  });

  it('refuses an answer with no fund name or no https share link', () => {
    expect(parsePostbackFund('<html><body>Login</body></html>')).toBeNull();
    expect(
      parsePostbackFund(postbackHtml('Fixture Travel Grant', 'javascript:void(0)')),
    ).toBeNull();
  });
});

describe('createStaticFundSearchEnumerator', () => {
  function harness(postbackName = 'Fixture Summer Research Fellowship') {
    const calls: Array<{ url: string; config: HttpRequestConfig }> = [];
    const request: HttpRequestFn = vi.fn(async (url, config) => {
      calls.push({ url, config });
      if (config.method !== 'POST') {
        return {
          status: 200,
          data: SEARCH_HTML,
          finalUrl: url,
          setCookies: ['SessionId=fixture-session; path=/; secure; HttpOnly'],
        };
      }
      const body = new URLSearchParams(config.body);
      if (body.get(VIEW_ALL_FUNDS_BUTTON)) {
        return {
          status: 200,
          data: GRID_HTML,
          finalUrl: url,
          setCookies: ['Token=fixture-token; path=/'],
        };
      }
      return { status: 200, data: postbackHtml(postbackName), finalUrl: url };
    });
    const hopRequest: PublicHttpHopRequest = vi.fn(async () => ({
      status: 301,
      body: '',
      location: ROW_FUND_URL,
    }));
    const sleep = vi.fn(async (_ms: number) => {});
    const enumerate = createStaticFundSearchEnumerator({
      searchUrl: SEARCH_URL,
      delayMs: 1_000,
      request,
      hopRequest,
      assertUrl: passthroughAssert,
      sleep,
    });
    return { calls, request, hopRequest, sleep, enumerate };
  }

  it('opens a session, posts the view-all button, and returns the grid rows', async () => {
    const { calls, enumerate } = harness();

    const grid = await enumerate();

    expect(grid.rows.map((row) => row.eventTarget)).toEqual([ROW_TARGET('02'), ROW_TARGET('03')]);
    expect(calls.map(({ url, config }) => `${config.method ?? 'GET'} ${url}`)).toEqual([
      `GET ${SEARCH_URL}`,
      `POST ${SEARCH_URL}`,
    ]);
    const viewAll = new URLSearchParams(calls[1].config.body);
    expect(viewAll.get(VIEW_ALL_FUNDS_BUTTON)).toBe(VIEW_ALL_FUNDS_BUTTON_VALUE);
    expect(viewAll.get('__VIEWSTATE')).toBe('search-state');
    expect(viewAll.has('ctl00$PreContent$GrantsSearch1$btnSearch')).toBe(false);
    expect(calls[1].config.headers.Cookie).toBe('SessionId=fixture-session');
    expect(calls[1].config.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('resolves a row by posting back the grid form and following its share link one hop', async () => {
    const { calls, hopRequest, sleep, enumerate } = harness();
    const grid = await enumerate();

    const url = await grid.resolveRowFundUrl(grid.rows[0]);

    expect(url).toBe(ROW_FUND_URL);
    const postback = new URLSearchParams(calls[2].config.body);
    expect(postback.get('__EVENTTARGET')).toBe(ROW_TARGET('02'));
    expect(postback.get('__VIEWSTATE')).toBe('grid-state');
    expect(postback.has(VIEW_ALL_FUNDS_BUTTON)).toBe(false);
    expect(calls[2].config.headers.Cookie).toBe('SessionId=fixture-session; Token=fixture-token');
    expect(hopRequest).toHaveBeenCalledWith(SHORT_LINK, expect.any(Object));
    expect(sleep.mock.calls.filter(([ms]) => ms === 1_000)).toHaveLength(2);
  });

  it('refuses a postback that answers with a different fund than the row names', async () => {
    const { hopRequest, enumerate } = harness('Fixture Unrelated Prize');
    const grid = await enumerate();

    await expect(grid.resolveRowFundUrl(grid.rows[0])).resolves.toBeNull();
    expect(hopRequest).not.toHaveBeenCalled();
  });
});
