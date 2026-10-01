/**
 * Static enumeration of the CommunityForce fund search (ASP.NET WebForms), for machines with
 * no browser renderer (#4214). A grid row opens its fund only by postback, and the inline
 * answer carries no FundDetails link, only a share link that redirects to one. The grid's own
 * FundDetails links sit inside row descriptions and name other funds, such as a common
 * application, so they never identify the row they appear in.
 */
import * as cheerio from 'cheerio';
import {
  SCRAPER_USER_AGENT,
  fetchPageWithPolicy,
  fetchPublicHttpUrl,
  postFormWithPolicy,
  type FetchPageWithPolicyOptions,
  type FetchedHttpPage,
  type HttpRequestFn,
  type PublicHttpHopRequest,
} from './httpFetch';

export const VIEW_ALL_FUNDS_BUTTON = 'ctl00$PreContent$GrantsSearch1$btnAllGrants';
export const VIEW_ALL_FUNDS_BUTTON_VALUE = 'View All Grants/Fellowships';

const GRID_ROW_EVENT_TARGET = /^ctl00\$PreContent\$GrantsSearch1\$grdFund\$ctl\d+\$lnkFundName$/;
const POSTBACK_FUND_NAME = '[id$="_ctrlFundDetails_lblFundName"]';
const POSTBACK_SHORT_LINK = '[id$="_ctrlFundDetails_lnkShortLink"]';
const SKIPPED_INPUT_TYPES = new Set(['submit', 'button', 'image', 'reset', 'file']);

export const DEFAULT_POSTBACK_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface FundSearchGridRow {
  eventTarget: string;
  name: string;
}

export interface FundSearchGrid {
  html: string;
  url: string;
  rows: FundSearchGridRow[];
  pageCount: number;
  resolveRowFundUrl(row: FundSearchGridRow): Promise<string | null>;
}

export type FundSearchGridEnumerator = () => Promise<FundSearchGrid>;

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeFundName(value: string | undefined | null): string {
  return cleanText(value).normalize('NFKC').toLowerCase();
}

/**
 * The fields a browser would submit for the page's form: hidden state, text values,
 * checked boxes, and each select's chosen option, but no button and no disabled control.
 */
export function serializeWebForm(html: string): URLSearchParams {
  const $ = cheerio.load(html);
  const form = $('form').first();
  const fields = new URLSearchParams();
  form.find('input[name], select[name], textarea[name]').each((_i, element) => {
    const $element = $(element);
    if ($element.is('[disabled]')) return;
    const name = String($element.attr('name'));
    const tag = element.tagName.toLowerCase();
    if (tag === 'select') {
      const chosen = $element.find('option[selected]').first();
      const option = chosen.length > 0 ? chosen : $element.find('option').first();
      if (option.length > 0) fields.append(name, option.attr('value') ?? cleanText(option.text()));
      return;
    }
    if (tag === 'textarea') {
      fields.append(name, $element.text());
      return;
    }
    const type = String($element.attr('type') || 'text').toLowerCase();
    if (SKIPPED_INPUT_TYPES.has(type)) return;
    if ((type === 'checkbox' || type === 'radio') && !$element.is('[checked]')) return;
    fields.append(name, $element.attr('value') ?? (type === 'checkbox' ? 'on' : ''));
  });
  return fields;
}

function postbackTarget(href: string | undefined): string {
  const match = String(href || '').match(/__doPostBack\('([^']+)'/);
  return match ? match[1] : '';
}

export function parseFundSearchGrid(html: string): {
  rows: FundSearchGridRow[];
  pageCount: number;
} {
  const $ = cheerio.load(html);
  const byTarget = new Map<string, FundSearchGridRow>();
  $('a[id$="_lnkFundName"]').each((_i, anchor) => {
    const $anchor = $(anchor);
    const eventTarget = postbackTarget($anchor.attr('href'));
    if (!GRID_ROW_EVENT_TARGET.test(eventTarget) || byTarget.has(eventTarget)) return;
    const name = cleanText($anchor.text()) || cleanText($anchor.attr('aria-label'));
    if (name) byTarget.set(eventTarget, { eventTarget, name });
  });
  const pager = cleanText($('body').text()).match(/\bPage\s+(\d+)\s+of\s+(\d+)\b/i);
  return { rows: Array.from(byTarget.values()), pageCount: pager ? Number(pager[2]) : 1 };
}

export function parsePostbackFund(html: string): { name: string; shortLink: string } | null {
  const $ = cheerio.load(html);
  const name = cleanText($(POSTBACK_FUND_NAME).first().text());
  const link = $(POSTBACK_SHORT_LINK).first();
  const shortLink = cleanText(link.attr('href')) || cleanText(link.text());
  if (!name || !/^https:\/\//i.test(shortLink)) return null;
  return { name, shortLink };
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(page: FetchedHttpPage): void {
    for (const header of page.setCookies ?? []) {
      const pair = header.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  header(): string {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ');
  }
}

export interface StaticFundSearchOptions {
  searchUrl: string;
  delayMs?: number;
  timeoutMs?: number;
  request?: HttpRequestFn;
  hopRequest?: PublicHttpHopRequest;
  assertUrl?: (url: string) => Promise<URL>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export function createStaticFundSearchEnumerator(
  options: StaticFundSearchOptions,
): FundSearchGridEnumerator {
  const delayMs = options.delayMs ?? DEFAULT_POSTBACK_DELAY_MS;
  const sleep = options.sleep ?? realSleep;

  return async () => {
    const jar = new CookieJar();
    let requests = 0;
    const policy = (): FetchPageWithPolicyOptions => {
      const cookie = jar.header();
      return {
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: { 'User-Agent': SCRAPER_USER_AGENT, ...(cookie ? { Cookie: cookie } : {}) },
        ...(options.request ? { request: options.request } : {}),
        ...(options.assertUrl ? { assertUrl: options.assertUrl } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
      };
    };
    const paced = async (send: () => Promise<FetchedHttpPage>): Promise<FetchedHttpPage> => {
      if (requests > 0) await sleep(delayMs);
      requests += 1;
      const page = await send();
      jar.absorb(page);
      return page;
    };

    const searchPage = await paced(() => fetchPageWithPolicy(options.searchUrl, policy()));
    const allFundsForm = serializeWebForm(searchPage.html);
    allFundsForm.set(VIEW_ALL_FUNDS_BUTTON, VIEW_ALL_FUNDS_BUTTON_VALUE);
    const gridPage = await paced(() =>
      postFormWithPolicy(options.searchUrl, allFundsForm, policy()),
    );
    const { rows, pageCount } = parseFundSearchGrid(gridPage.html);
    const gridForm = serializeWebForm(gridPage.html);

    const resolveRowFundUrl = async (row: FundSearchGridRow): Promise<string | null> => {
      const postback = new URLSearchParams(gridForm);
      postback.set('__EVENTTARGET', row.eventTarget);
      postback.set('__EVENTARGUMENT', '');
      const page = await paced(() => postFormWithPolicy(options.searchUrl, postback, policy()));
      const fund = parsePostbackFund(page.html);
      if (!fund || normalizeFundName(fund.name) !== normalizeFundName(row.name)) {
        options.log?.(`postback for "${row.eventTarget}" did not answer with the fund it names`);
        return null;
      }
      if (/\/FundDetails\.aspx$/i.test(new URL(fund.shortLink).pathname)) return fund.shortLink;
      const hop = await fetchPublicHttpUrl(fund.shortLink, {
        maxRedirects: 0,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(options.hopRequest ? { request: options.hopRequest } : {}),
        ...(options.assertUrl ? { assertUrl: options.assertUrl } : {}),
      });
      const target = hop.location ? new URL(hop.location, hop.finalUrl).toString() : '';
      return target || null;
    };

    return { html: gridPage.html, url: gridPage.url, rows, pageCount, resolveRowFundUrl };
  };
}
