/**
 * StudentGrantsDatabaseScraper
 *
 * Reads the Yale Student Grants Database - Yale's most comprehensive officially-curated
 * catalog of student funding. The public entry point studentgrants.yale.edu redirects to
 * the CommunityForce app at yale.communityforce.com, whose fund pages are public; only
 * *applying* requires a login. Each fund has its own /Funds/FundDetails.aspx page carrying
 * the application window, eligibility, award amount, and search facets.
 *
 * The fund search grid is driven by JavaScript postbacks, so it goes through the Scrapling
 * `stealthy` rendered fetch, which is an owner decision to keep. Fund pages use the same
 * renderer whenever one is configured and fall back to the shared static fetch otherwise,
 * because a FundDetails page is server-rendered. Funds are enumerated from the grid when it renders and
 * always from the FundDetails pages the live catalog already cites, so the lane still
 * reads every cited fund on a machine with no renderer (#3984).
 *
 * When the rendered search returns nothing, the grid is enumerated statically instead, by
 * replaying its WebForms postbacks one row at a time (#4214). A row whose fund name matches a
 * fund page already read is not posted back. A run scoped with `--only`, and any benchmark
 * capture or replay, holds its fund list still and never enumerates the grid, and a grid that
 * fails or lists nothing is reported as a partial failure rather than as an empty success.
 *
 * It cites each fund's own FundDetails page - never the search/index root - per the
 * self-referential / index-page source guards (#516/#549), and a page with no fund name
 * fails closed rather than minting a login shell. Contact data is fail-closed: the
 * contact block names a person and is never read.
 *
 * A fund already cited by a public fellowship page (as its applicationLink) merges into
 * that record rather than duplicating, via the materializer's record-specific
 * application-link dedupe (findFellowshipByRecordSpecificApplicationLink), which is also
 * how a fund gives an unowned catalog row a source and a resolve path.
 */
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import {
  createScraplingRenderedFetcher,
  fetchUsableRenderedPage,
  type RenderedFetcher,
} from '../renderedFetch';
import { BenchmarkReplayNetworkError, isBenchmarkModeActive } from '../snapshotBenchmarkMode';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  createStaticFundSearchEnumerator,
  normalizeFundName,
  type FundSearchGrid,
  type FundSearchGridEnumerator,
  type FundSearchGridRow,
} from '../utils/communityForceFundSearch';
import { fellowshipAbsenceAssertion } from '../fellowshipFieldAbsence';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import {
  type ProgramDateBoundary,
  nextCycleDeadline,
  parseProgramDate,
  statedProseDeadlines,
} from '../utils/programDeadline';
import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { endOfNewYorkDay, newYorkCalendarDate } from '../../utils/newYorkTime';
import { sanitizedObservedFellowshipProse } from '../fellowshipProse';
import {
  fundIdentityKey,
  isRecordSpecificFundDetailUrl,
  normalizeFundDetailUrl,
  sourceKeyForFund,
} from '../fellowshipFundFacets';
import { extractElementTextWithBlockSeparators } from '../utils/htmlText';
import { withoutContactDirections } from '../../utils/contactDirection';
import {
  FUND_PROSE_BLOCK_BREAK,
  fundProseLinkMarker,
  resolveFundApplicationRoute,
  type FundApplicationRoute,
  type FundProseSection,
} from '../utils/fundApplicationRoute';
import {
  resolveFundYearOfStudy,
  type FundEligibilityProse,
  type FundYearOfStudyResolution,
} from '../utils/fundYearOfStudy';

export const STUDENT_GRANTS_DATABASE_SOURCE = 'student-grants-database';

const COMMUNITYFORCE_HOST = 'yale.communityforce.com';

export const DEFAULT_STUDENT_GRANTS_SEARCH_URL = `https://${COMMUNITYFORCE_HOST}/Funds/Search.aspx`;

const FETCH_TIMEOUT_MS = 30_000;
const MAX_FUNDS = 1_000;
const MAX_CONSECUTIVE_POSTBACK_FAILURES = 5;

export interface StudentGrantsFundLink {
  title: string;
  url: string;
}

export interface StudentGrantsFund {
  sourceKey: string;
  title: string;
  url: string;
  description?: string;
  applicationInformation?: string;
  fullSourceDescription?: string;
  eligibility?: string;
  eligibilityStatesOnlyContactDirections?: boolean;
  restrictionsToUseOfAward?: string;
  awardAmount?: string;
  deadline?: Date;
  applicationOpenDate?: Date;
  applicationRoute: FundApplicationRoute;
  yearOfStudy: string[];
  /**
   * How the page settled the year of study, kept beside the values because
   * `unreconcilable` and an empty filter both read as no values and only the first
   * is the page stating that none apply (#4230).
   */
  yearOfStudyResolution: FundYearOfStudyResolution['kind'];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  isAcceptingApplications: boolean;
}

export type StudentGrantsHtmlFetcher = (
  url: string,
  useCache: boolean,
  sourceName: string,
) => Promise<string>;

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(href: string | undefined, baseUrl: string): string {
  const raw = cleanText(href);
  if (!raw || raw.startsWith('#') || /^(?:mailto|javascript):/i.test(raw)) return '';
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return '';
  }
}

/**
 * The rendered search results grid links each fund to its own FundDetails page.
 * The search/index root is never itself a candidate; only record-specific
 * FundDetails URLs are enumerated (#516/#549). Each fund is keyed by its
 * FundDetails identity so a fund linked twice on the grid is enumerated once.
 */
export function parseFundSearchResults(html: string, pageUrl: string): StudentGrantsFundLink[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const byKey = new Map<string, StudentGrantsFundLink>();

  for (const anchor of $('a[href]').toArray()) {
    const $anchor = $(anchor);
    const url = absoluteUrl($anchor.attr('href'), pageUrl);
    if (!isRecordSpecificFundDetailUrl(url)) continue;
    const normalized = normalizeFundDetailUrl(url);
    const title =
      cleanText($anchor.text()) ||
      cleanText($anchor.attr('title')) ||
      cleanText($anchor.attr('aria-label'));
    const key = fundIdentityKey(normalized);
    const existing = byKey.get(key);
    if (!existing || (!existing.title && title)) {
      byKey.set(key, { title, url: normalized });
    }
  }

  return Array.from(byKey.values());
}

const FUND_DETAIL_ID_PREFIX = '#ctl00_PreContent_FundDetails1_';

const FACET_FIELDS: Array<{ field: FundFacetField; label: RegExp }> = [
  { field: 'yearOfStudy', label: /year of study/i },
  { field: 'termOfAward', label: /term of award/i },
  { field: 'purpose', label: /purpose/i },
  { field: 'globalRegions', label: /region|country/i },
  { field: 'citizenshipStatus', label: /citizenship/i },
];

type FundFacetField =
  'yearOfStudy' | 'termOfAward' | 'purpose' | 'globalRegions' | 'citizenshipStatus';

function fundDetailElement($: cheerio.CheerioAPI, id: string): cheerio.Cheerio<any> {
  return $(`${FUND_DETAIL_ID_PREFIX}${id}`).first();
}

function sectionText($: cheerio.CheerioAPI, id: string): string | undefined {
  const section = fundDetailElement($, id).clone();
  section.find('h1, script, style').remove();
  const text = cleanText(section.text());
  return text || undefined;
}

function sectionBlocks($: cheerio.CheerioAPI, id: string): string[] {
  const section = fundDetailElement($, id).clone();
  section.find('h1, script, style, noscript').remove();
  section.find('br').replaceWith(` ${FUND_PROSE_BLOCK_BREAK} `);
  section.find(PROSE_BLOCK_SELECTOR).append(` ${FUND_PROSE_BLOCK_BREAK} `);
  return extractElementTextWithBlockSeparators(section[0])
    .split(FUND_PROSE_BLOCK_BREAK)
    .map(cleanText)
    .filter(Boolean);
}

interface FundSectionProse {
  text?: string;
  statesOnlyContactDirections: boolean;
}

function sectionTextWithoutContactDirections($: cheerio.CheerioAPI, id: string): FundSectionProse {
  const text = sectionText($, id);
  if (!text) return { statesOnlyContactDirections: false };
  const withoutContact = withoutContactDirections(sectionBlocks($, id));
  if (withoutContact.droppedSentences === 0) return { text, statesOnlyContactDirections: false };
  return {
    text: withoutContact.text || undefined,
    statesOnlyContactDirections: !withoutContact.text,
  };
}

/**
 * The fund page's own Description section, which states requirements its Brief
 * Description leaves out, such as an adviser who must approve the project (#4232). It is
 * stored whole for the classifier and never served.
 */
function fundFullSourceDescription($: cheerio.CheerioAPI): string | undefined {
  return sectionProse($, 'lblDescription');
}

function sectionProse($: cheerio.CheerioAPI, id: string): string | undefined {
  return sanitizedObservedFellowshipProse(sectionTextWithoutContactDirections($, id).text);
}

// The Global Region facet lists each country as its own "-- Country (Subregion)" item
// under its region, and the stored catalog filters by region only, so country items
// are dropped rather than stored as regions.
function isCountryUnderRegion(field: FundFacetField, value: string): boolean {
  return field === 'globalRegions' && value.startsWith('--');
}

function parseFacets($: cheerio.CheerioAPI): Record<FundFacetField, string[]> {
  const facets: Record<FundFacetField, string[]> = {
    yearOfStudy: [],
    termOfAward: [],
    purpose: [],
    globalRegions: [],
    citizenshipStatus: [],
  };
  $(`[id^="${FUND_DETAIL_ID_PREFIX.slice(1)}divHeader_"]`).each((_i, header) => {
    const panelId = String($(header).attr('id') || '').split('divHeader_')[1];
    const facet = FACET_FIELDS.find(({ label }) => label.test(cleanText($(header).text())));
    if (!panelId || !facet) return;
    const values = fundDetailElement($, `divBody_${panelId}`)
      .find('li')
      .toArray()
      .map((item) => cleanText($(item).text()))
      .filter((value) => !isCountryUnderRegion(facet.field, value))
      .filter((value) => value.length >= 2 && value.length <= 80);
    facets[facet.field] = Array.from(new Set([...facets[facet.field], ...values]));
  });
  return facets;
}

const ROUTE_PROSE_SECTION_IDS = [
  'lblBriefDescription',
  'lblDescription',
  'lblApplicationInformation',
  'lblSpecialEligibilityRequirements',
  'lblLinkstoAdditionalInformation',
];

const ELIGIBILITY_PROSE_SECTION_IDS = [
  'lblBriefDescription',
  'lblDescription',
  'lblApplicationInformation',
  'lblSpecialEligibilityRequirements',
];

const PROSE_BLOCK_SELECTOR = 'p, div, li, tr, h2, h3, h4, h5, h6, ul, ol, table';

function proseSectionWithLinkMarkers(
  $: cheerio.CheerioAPI,
  id: string,
  pageUrl: string,
): FundProseSection {
  const section = fundDetailElement($, id).clone();
  section.find('h1, script, style, noscript').remove();
  const links: FundProseSection['links'] = [];
  section.find('a').each((_i, anchor) => {
    const $anchor = $(anchor);
    links.push({
      url: absoluteUrl($anchor.attr('href'), pageUrl),
      text: cleanText($anchor.text()),
    });
    $anchor.replaceWith(fundProseLinkMarker(links.length - 1));
  });
  section.find('br').replaceWith(` ${FUND_PROSE_BLOCK_BREAK} `);
  section.find(PROSE_BLOCK_SELECTOR).append(` ${FUND_PROSE_BLOCK_BREAK} `);
  return { text: extractElementTextWithBlockSeparators(section[0]), links };
}

function eligibilityProse($: cheerio.CheerioAPI, id: string): FundEligibilityProse {
  const section = fundDetailElement($, id).clone();
  section.find('h1, script, style, noscript').remove();
  section.find('br').replaceWith(` ${FUND_PROSE_BLOCK_BREAK} `);
  section.find(PROSE_BLOCK_SELECTOR).append(` ${FUND_PROSE_BLOCK_BREAK} `);
  return {
    text: extractElementTextWithBlockSeparators(section[0]),
    isEligibilitySection: id === 'lblSpecialEligibilityRequirements',
  };
}

const NUMERIC_CATALOG_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;

function applicationWindowBoundary(label: string): ProgramDateBoundary | null {
  if (/deadline/.test(label)) return 'deadline';
  if (/begin accepting/.test(label)) return 'opens';
  return null;
}

function parseApplicationWindow($: cheerio.CheerioAPI): { opensAt?: Date; deadline?: Date } {
  const window: { opensAt?: Date; deadline?: Date } = {};
  $('.fdi-start-date-title').each((_i, titleEl) => {
    const label = cleanText($(titleEl).text()).toLowerCase();
    const value = cleanText($(titleEl).nextAll('.fdi-start-date').first().text());
    if (!NUMERIC_CATALOG_DATE.test(value)) return;
    const boundary = applicationWindowBoundary(label);
    const date = boundary ? parseProgramDate(value, boundary) : undefined;
    if (!date) return;
    if (boundary === 'deadline') window.deadline = date;
    else window.opensAt = date;
  });
  return window;
}

const CYCLE_PROSE_SECTION_IDS = [
  'lblApplicationInformation',
  'lblBriefDescription',
  'lblDescription',
];

function nextStatedApplicationWindow(
  $: cheerio.CheerioAPI,
  referenceDate: Date,
): { opensAt?: Date; deadline?: Date } {
  const structured = parseApplicationWindow($);
  if (!structured.deadline) return structured;
  const structuredDeadline = structured.deadline;
  const structuredDeadlineDayEnd = endOfNewYorkDay(newYorkCalendarDate(structuredDeadline));
  const laterCycles = CYCLE_PROSE_SECTION_IDS.flatMap((id) =>
    statedProseDeadlines(sectionText($, id) || '', referenceDate),
  ).filter((deadline) => deadline.getTime() > structuredDeadlineDayEnd.getTime());
  const deadline = nextCycleDeadline([structuredDeadline, ...laterCycles], referenceDate);
  return deadline === structuredDeadline ? structured : { deadline };
}

function awardAmountText($: cheerio.CheerioAPI): string | undefined {
  const text = sectionText($, 'lblAwardAmount')?.replace(/^award amount\s*:?\s*/i, '');
  return text && /\$|\d/.test(text) ? text.slice(0, 120) : undefined;
}

/**
 * A FundDetails page is server-rendered ASP.NET: each field is its own element with a
 * stable `ctl00_PreContent_FundDetails1_*` id, and the search facets are collapsible
 * panels pairing a `divHeader_<n>` label with a `divBody_<n>` list. A page with no fund
 * name is a login or error shell rather than a fund, so it fails closed. The contact
 * block names a person, so it is never read (contact data fails closed).
 */
export function parseFundDetailPage(
  html: string,
  fund: StudentGrantsFundLink,
  referenceDate: Date = new Date(),
): StudentGrantsFund | null {
  const $ = cheerio.load(html);
  const title = sectionText($, 'lblFundName');
  if (!title) return null;

  const { opensAt, deadline } = nextStatedApplicationWindow($, referenceDate);
  const closed = Boolean(sectionText($, 'lblFundClosedOn') || sectionText($, 'lblReasonClosed'));
  const now = referenceDate.getTime();
  const { yearOfStudy: yearOfStudyFilter, ...otherFacets } = parseFacets($);
  const url = normalizeFundDetailUrl(fund.url);
  const yearOfStudy = resolveFundYearOfStudy(
    ELIGIBILITY_PROSE_SECTION_IDS.map((id) => eligibilityProse($, id)),
    yearOfStudyFilter,
  );
  const eligibility = sectionTextWithoutContactDirections($, 'lblSpecialEligibilityRequirements');

  return {
    sourceKey: sourceKeyForFund(fund.url),
    title,
    url,
    description: sectionProse($, 'lblBriefDescription'),
    fullSourceDescription: fundFullSourceDescription($),
    applicationInformation: sectionProse($, 'lblApplicationInformation'),
    eligibility: sanitizedObservedFellowshipProse(eligibility.text),
    eligibilityStatesOnlyContactDirections: eligibility.statesOnlyContactDirections,
    restrictionsToUseOfAward: sectionProse($, 'lblRestrictionstoUseofAward'),
    awardAmount: awardAmountText($),
    deadline,
    applicationOpenDate: opensAt,
    applicationRoute: resolveFundApplicationRoute(
      ROUTE_PROSE_SECTION_IDS.map((id) => proseSectionWithLinkMarkers($, id, url)),
      { url, title },
    ),
    yearOfStudy: yearOfStudy.kind === 'unreconcilable' ? [] : yearOfStudy.values,
    yearOfStudyResolution: yearOfStudy.kind,
    ...otherFacets,
    isAcceptingApplications:
      !closed &&
      Boolean(deadline && deadline.getTime() > now) &&
      (!opensAt || opensAt.getTime() <= now),
  };
}

function isResearchFocusedFund(fund: StudentGrantsFund): boolean {
  return /\bresearch\b/i.test(
    `${fund.title} ${fund.description || ''} ${fund.purpose.join(' ')} ${fund.eligibility || ''}`,
  );
}

function fundFingerprint(fund: StudentGrantsFund): string {
  const stable = {
    title: fund.title,
    url: fund.url,
    description: fund.description || '',
    eligibility: fund.eligibility || '',
    applicationInformation: fund.applicationInformation || '',
    fullSourceDescription: fund.fullSourceDescription || '',
    restrictionsToUseOfAward: fund.restrictionsToUseOfAward || '',
    awardAmount: fund.awardAmount || '',
    deadline: fund.deadline?.toISOString() || '',
    applicationOpenDate: fund.applicationOpenDate?.toISOString() || '',
    ...(fund.applicationRoute.kind === 'fund-page' ? {} : { route: fund.applicationRoute }),
    yearOfStudy: fund.yearOfStudy,
    termOfAward: fund.termOfAward,
    purpose: fund.purpose,
    globalRegions: fund.globalRegions,
    citizenshipStatus: fund.citizenshipStatus,
    isAcceptingApplications: fund.isAcceptingApplications,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function applicationLinkFor(fund: StudentGrantsFund): string | undefined {
  if (fund.applicationRoute.kind === 'elsewhere') return fund.applicationRoute.url;
  return fund.applicationRoute.kind === 'fund-page' ? fund.url : undefined;
}

// The fund's own page stays in `links` whatever the route, because
// `loadCitedFundDetailUrls` seeds the crawl from the FundDetails pages rows cite.
function fundLinks(fund: StudentGrantsFund, applicationLink: string | undefined) {
  if (applicationLink === fund.url) return [{ label: 'Application', url: fund.url }];
  const fundPage = { label: fund.title, url: fund.url };
  return applicationLink ? [{ label: 'Application', url: applicationLink }, fundPage] : [fundPage];
}

/**
 * The fields this read states the fund has none of (#4230).
 *
 * Each is a conclusion the page forces rather than a gap: a route named with no link
 * says the fund page is not where a student applies, prose naming a level the stored
 * vocabulary cannot express says the filter's values do not describe who may apply,
 * and an eligibility section holding only contact directions states no requirement
 * (#4177). A fund-page route, a linked route, and a year of study the prose or filter
 * settles all state a value, so they claim nothing.
 */
function fundFieldsStatedAbsent(fund: StudentGrantsFund): string[] {
  return [
    ...(fund.applicationRoute.kind === 'elsewhere-unlinked' ? ['applicationLink'] : []),
    ...(fund.yearOfStudyResolution === 'unreconcilable' ? ['yearOfStudy'] : []),
    ...(fund.eligibilityStatesOnlyContactDirections && !fund.eligibility ? ['eligibility'] : []),
  ];
}

const RETIRED_FUND_NOTICE = /\bthis fund is no longer available\b/i;

export function isRetiredFundPage(html: string): boolean {
  const $ = cheerio.load(html);
  if (sectionText($, 'lblFundName')) return false;
  $('script, style, noscript').remove();
  return RETIRED_FUND_NOTICE.test(cleanText($('body').text()));
}

export function retiredFundObservations(fundUrl: string): ObservationInput[] {
  return [
    {
      entityType: 'fellowship',
      entityKey: sourceKeyForFund(fundUrl),
      sourceUrl: normalizeFundDetailUrl(fundUrl),
      field: 'archived',
      value: true,
      confidenceOverride: 0.95,
    },
  ];
}

export function fundToObservations(fund: StudentGrantsFund): ObservationInput[] {
  const base = {
    entityType: 'fellowship' as const,
    entityKey: fund.sourceKey,
    sourceUrl: fund.url,
    confidenceOverride: 0.9,
  };
  const observation = (field: string, value: unknown): ObservationInput | null => {
    if (value === undefined || value === null || value === '') return null;
    if (Array.isArray(value) && value.length === 0) return null;
    return { ...base, field, value };
  };

  const applicationLink = applicationLinkFor(fund);
  const statedAbsent = fundFieldsStatedAbsent(fund);

  const identity = observation('sourceKey', fund.sourceKey);

  return [
    identity && {
      ...identity,
      ...fellowshipAbsenceAssertion(STUDENT_GRANTS_DATABASE_SOURCE, statedAbsent, [
        ...(applicationLink ? ['applicationLink'] : []),
        ...(fund.yearOfStudy.length > 0 ? ['yearOfStudy'] : []),
        ...(fund.eligibility ? ['eligibility'] : []),
      ]),
    },
    observation('sourceName', STUDENT_GRANTS_DATABASE_SOURCE),
    observation('sourceUrl', fund.url),
    observation('sourceFingerprint', fundFingerprint(fund)),
    observation('title', fund.title),
    observation('description', fund.description),
    observation('applicationInformation', fund.applicationInformation),
    observation('fullSourceDescription', fund.fullSourceDescription),
    observation('eligibility', fund.eligibility),
    observation('restrictionsToUseOfAward', fund.restrictionsToUseOfAward),
    observation('awardAmount', fund.awardAmount),
    observation('applicationLink', applicationLink),
    observation('links', fundLinks(fund, applicationLink)),
    observation('deadline', fund.deadline),
    observation('applicationOpenDate', fund.applicationOpenDate),
    observation('yearOfStudy', fund.yearOfStudy),
    observation('termOfAward', fund.termOfAward),
    observation('purpose', fund.purpose),
    observation('globalRegions', fund.globalRegions),
    observation('citizenshipStatus', fund.citizenshipStatus),
    { ...base, field: 'researchFocused', value: isResearchFocusedFund(fund) },
    { ...base, field: 'isAcceptingApplications', value: fund.isAcceptingApplications },
    { ...base, field: 'reviewRequired', value: !fund.deadline },
    { ...base, field: 'archived', value: false },
  ].filter((item): item is ObservationInput => !!item);
}

export function createRenderedStudentGrantsHtmlFetcher(
  renderedFetcher: RenderedFetcher | null = createScraplingRenderedFetcher(),
): StudentGrantsHtmlFetcher {
  return async (url, useCache, sourceName) => {
    const page = await fetchUsableRenderedPage({
      sourceName,
      useCache,
      request: { url, mode: 'stealthy', timeoutMs: FETCH_TIMEOUT_MS },
      renderedFetcher,
    });
    return page?.html || '';
  };
}

const CITED_FUND_DETAIL_URL = /^https?:\/\/yale\.communityforce\.com\/Funds\/FundDetails\.aspx\?/i;

/**
 * The FundDetails pages the live catalog already cites, as crawl seeds. A fund reached
 * this way is still read from its own page, so the seed decides only what to fetch.
 * Without it the lane depends on the rendered search grid alone, which no machine
 * without a renderer can read, and the rows the 2026-02 catalog import minted with no
 * source stay unreachable (#3984).
 */
export async function loadCitedFundDetailUrls(): Promise<string[]> {
  const rows = (await Fellowship.find(
    {
      archived: { $ne: true },
      $or: [{ applicationLink: CITED_FUND_DETAIL_URL }, { 'links.url': CITED_FUND_DETAIL_URL }],
    },
    { applicationLink: 1, links: 1 },
  ).lean()) as Array<{ applicationLink?: unknown; links?: Array<{ url?: unknown }> }>;
  const retiredFundUrls = (await Observation.distinct('sourceUrl', {
    entityType: 'fellowship',
    sourceName: STUDENT_GRANTS_DATABASE_SOURCE,
    field: 'archived',
    value: true,
  })) as unknown[];
  const urls = [
    ...rows.flatMap((row) => [
      row.applicationLink,
      ...(Array.isArray(row.links) ? row.links.map((link) => link?.url) : []),
    ]),
    ...retiredFundUrls,
  ];
  return urls.filter(
    (url): url is string => typeof url === 'string' && isRecordSpecificFundDetailUrl(url),
  );
}

export function createStaticStudentGrantsHtmlFetcher(
  fetchPage: (url: string) => Promise<string> = async (url) =>
    (await fetchPageWithPolicy(url, { timeoutMs: FETCH_TIMEOUT_MS })).html,
): StudentGrantsHtmlFetcher {
  return async (url, useCache, sourceName) => {
    const cacheKey = `page:${url}`;
    if (useCache) {
      const cached = await getCached<string>(sourceName, cacheKey);
      if (cached) return cached;
    }
    try {
      const html = await fetchPage(url);
      if (useCache && html) await setCached(sourceName, cacheKey, html);
      return html;
    } catch {
      return '';
    }
  };
}

/**
 * Fund pages go through the stealthy renderer whenever one is configured
 * (`SCRAPLING_RENDERER_ENABLED=true`), which is the lane's intended fetch, and fall back to
 * the static fetch when the renderer is disabled or returns no usable page. A FundDetails
 * page is server-rendered, so the fallback reads the same fields.
 */
function configuredRenderedDetailFetcher(): StudentGrantsHtmlFetcher | null {
  const renderer = createScraplingRenderedFetcher();
  return renderer ? createRenderedStudentGrantsHtmlFetcher(renderer) : null;
}

export function createStudentGrantsDetailFetcher(
  renderedFetcher: StudentGrantsHtmlFetcher | null = configuredRenderedDetailFetcher(),
  staticFetcher: StudentGrantsHtmlFetcher = createStaticStudentGrantsHtmlFetcher(),
): StudentGrantsHtmlFetcher {
  return async (url, useCache, sourceName) => {
    const rendered = renderedFetcher ? await renderedFetcher(url, useCache, sourceName) : '';
    return rendered || staticFetcher(url, useCache, sourceName);
  };
}

export interface StudentGrantsDatabaseScraperOptions {
  searchUrl?: string;
  searchFetcher?: StudentGrantsHtmlFetcher;
  detailFetcher?: StudentGrantsHtmlFetcher;
  gridEnumerator?: FundSearchGridEnumerator | null;
  loadSeedUrls?: () => Promise<string[]>;
}

function mergeFundLinks(
  gridLinks: StudentGrantsFundLink[],
  seedUrls: string[],
): StudentGrantsFundLink[] {
  const byKey = new Map<string, StudentGrantsFundLink>();
  for (const link of gridLinks) byKey.set(fundIdentityKey(link.url), link);
  for (const url of seedUrls) {
    const normalized = normalizeFundDetailUrl(url);
    const key = fundIdentityKey(normalized);
    if (!byKey.has(key)) byKey.set(key, { title: '', url: normalized });
  }
  return Array.from(byKey.values()).sort((a, b) => a.url.localeCompare(b.url));
}

function isInScope(link: StudentGrantsFundLink, only: string[] | undefined): boolean {
  if (!only || only.length === 0) return true;
  return only.includes(sourceKeyForFund(link.url)) || only.includes(link.url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StaticGridReading {
  linkedFunds: StudentGrantsFundLink[];
  rows: FundSearchGridRow[];
  grid: FundSearchGrid | null;
  partialFailures: string[];
}

const NO_STATIC_GRID: StaticGridReading = {
  linkedFunds: [],
  rows: [],
  grid: null,
  partialFailures: [],
};

function rowsSafeToSkipByName(rows: FundSearchGridRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = normalizeFundName(row.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export class StudentGrantsDatabaseScraper implements IScraper {
  readonly name = STUDENT_GRANTS_DATABASE_SOURCE;
  readonly displayName = 'Yale Student Grants Database (CommunityForce)';

  private readonly searchUrl: string;
  private readonly searchFetcher: StudentGrantsHtmlFetcher;
  private readonly detailFetcher: StudentGrantsHtmlFetcher;
  private readonly gridEnumerator: FundSearchGridEnumerator | null;
  private readonly loadSeedUrls: () => Promise<string[]>;

  constructor(options: StudentGrantsDatabaseScraperOptions = {}) {
    this.searchUrl = options.searchUrl ?? DEFAULT_STUDENT_GRANTS_SEARCH_URL;
    this.searchFetcher = options.searchFetcher ?? createRenderedStudentGrantsHtmlFetcher();
    this.detailFetcher = options.detailFetcher ?? createStudentGrantsDetailFetcher();
    this.gridEnumerator =
      options.gridEnumerator !== undefined
        ? options.gridEnumerator
        : createStaticFundSearchEnumerator({ searchUrl: this.searchUrl });
    this.loadSeedUrls = options.loadSeedUrls ?? loadCitedFundDetailUrls;
  }

  private async readStaticGrid(ctx: ScraperContext): Promise<StaticGridReading> {
    if ((ctx.options.only?.length ?? 0) > 0 || isBenchmarkModeActive()) {
      ctx.log(
        '[student-grants] rendered search unavailable; a scoped or benchmark run reads cited fund pages only',
      );
      return NO_STATIC_GRID;
    }
    if (!this.gridEnumerator) {
      ctx.log('[student-grants] rendered search unavailable; enumerating cited fund pages only');
      return NO_STATIC_GRID;
    }
    ctx.log('[student-grants] rendered search unavailable; enumerating the grid by postback');
    let grid: FundSearchGrid;
    try {
      grid = await this.gridEnumerator();
    } catch (error) {
      if (error instanceof BenchmarkReplayNetworkError) throw error;
      return {
        ...NO_STATIC_GRID,
        partialFailures: [`fund search grid unavailable: ${errorMessage(error)}`],
      };
    }
    const partialFailures: string[] = [];
    if (grid.rows.length === 0) {
      partialFailures.push('fund search grid listed no funds; read cited fund pages only');
    }
    if (grid.pageCount > 1) {
      partialFailures.push(
        `fund search grid has ${grid.pageCount} pages and only the first was read`,
      );
    }
    return {
      linkedFunds: parseFundSearchResults(grid.html, grid.url || this.searchUrl),
      rows: grid.rows.slice(0, MAX_FUNDS),
      grid,
      partialFailures,
    };
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = Math.min(limitOption ?? Infinity, MAX_FUNDS);
    const referenceDate = ctx.options.referenceDate ?? new Date();

    ctx.log(`[student-grants] fetching rendered fund search ${this.searchUrl}`);
    const searchHtml = await this.searchFetcher(this.searchUrl, ctx.options.useCache, this.name);
    const gridLinks = searchHtml ? parseFundSearchResults(searchHtml, this.searchUrl) : [];
    const staticGrid = searchHtml ? NO_STATIC_GRID : await this.readStaticGrid(ctx);
    const partialFailures = [...staticGrid.partialFailures];
    const seedUrls = await this.loadSeedUrls();
    const fundLinks = mergeFundLinks([...gridLinks, ...staticGrid.linkedFunds], seedUrls).filter(
      (link) => isInScope(link, ctx.options.only),
    );
    ctx.log(
      `[student-grants] ${fundLinks.length} funds to read (${gridLinks.length} from the search grid, ${staticGrid.rows.length} postback rows, ${seedUrls.length} cited fund pages)`,
    );
    if (fundLinks.length === 0 && staticGrid.rows.length === 0) {
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'no-funds-to-read',
        ...(partialFailures.length > 0 ? { partialFailures } : {}),
      };
    }

    let totalObservations = 0;
    let totalEntities = 0;
    let withDeadline = 0;
    let unavailable = 0;
    let retired = 0;
    const readKeys = new Set<string>();
    const readNames = new Set<string>();

    const readFund = async (link: StudentGrantsFundLink): Promise<void> => {
      readKeys.add(fundIdentityKey(link.url));
      const detailHtml = await this.detailFetcher(link.url, ctx.options.useCache, this.name);
      const fund = detailHtml ? parseFundDetailPage(detailHtml, link, referenceDate) : null;
      if (!fund && detailHtml && isRetiredFundPage(detailHtml)) {
        retired += 1;
        const observations = retiredFundObservations(link.url);
        await ctx.emit(observations);
        totalObservations += observations.length;
        ctx.log('[student-grants] retired fund - the portal says it is no longer available', {
          url: link.url,
        });
        return;
      }
      if (!fund) {
        unavailable += 1;
        ctx.log('[student-grants] skipped fund - detail unavailable or not a fund page', {
          url: link.url,
        });
        return;
      }
      readNames.add(normalizeFundName(fund.title));
      const observations = fundToObservations(fund);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
      if (fund.deadline) withDeadline += 1;
    };

    for (const link of fundLinks) {
      if (totalEntities >= limit) break;
      await readFund(link);
    }

    const postback = await this.readPostbackRows(ctx, staticGrid, {
      readKeys,
      readNames,
      isFull: () => totalEntities >= limit,
      readFund,
    });
    partialFailures.push(...postback.partialFailures);

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} student-grants funds (${withDeadline} with a parsed deadline, ${retired} retired, ${unavailable} skipped)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `funds=${totalEntities}, grid=${gridLinks.length}, postbackRows=${staticGrid.rows.length}, postbacks=${postback.posted}, postbackSkippedKnown=${postback.skippedKnown}, postbackUnresolved=${postback.unresolved}, cited=${seedUrls.length}, withDeadline=${withDeadline}, retired=${retired}, skipped=${unavailable}`,
      ...(partialFailures.length > 0 ? { partialFailures } : {}),
    };
  }

  private async readPostbackRows(
    ctx: ScraperContext,
    staticGrid: StaticGridReading,
    state: {
      readKeys: Set<string>;
      readNames: Set<string>;
      isFull: () => boolean;
      readFund: (link: StudentGrantsFundLink) => Promise<void>;
    },
  ): Promise<{
    posted: number;
    skippedKnown: number;
    unresolved: number;
    partialFailures: string[];
  }> {
    const outcome = { posted: 0, skippedKnown: 0, unresolved: 0, partialFailures: [] as string[] };
    const grid = staticGrid.grid;
    if (!grid) return outcome;
    const nameCounts = rowsSafeToSkipByName(staticGrid.rows);
    let consecutiveFailures = 0;
    let abandoned = 0;

    for (const [index, row] of staticGrid.rows.entries()) {
      if (state.isFull()) break;
      const name = normalizeFundName(row.name);
      if (nameCounts.get(name) === 1 && state.readNames.has(name)) {
        outcome.skippedKnown += 1;
        continue;
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_POSTBACK_FAILURES) {
        abandoned = staticGrid.rows.length - index;
        break;
      }
      outcome.posted += 1;
      let url: string | null;
      try {
        url = await grid.resolveRowFundUrl(row);
      } catch (error) {
        if (error instanceof BenchmarkReplayNetworkError) throw error;
        ctx.log('[student-grants] fund search postback failed', {
          eventTarget: row.eventTarget,
          error: errorMessage(error),
        });
        url = null;
      }
      if (!url || !isRecordSpecificFundDetailUrl(url)) {
        outcome.unresolved += 1;
        consecutiveFailures += 1;
        continue;
      }
      consecutiveFailures = 0;
      const normalized = normalizeFundDetailUrl(url);
      if (state.readKeys.has(fundIdentityKey(normalized))) {
        outcome.skippedKnown += 1;
        continue;
      }
      await state.readFund({ title: row.name, url: normalized });
    }

    if (outcome.unresolved > 0 || abandoned > 0) {
      outcome.partialFailures.push(
        `${outcome.unresolved + abandoned} of ${staticGrid.rows.length} fund search rows did not resolve to a fund page${abandoned > 0 ? ` (${abandoned} abandoned after ${MAX_CONSECUTIVE_POSTBACK_FAILURES} consecutive failures)` : ''}`,
      );
    }
    return outcome;
  }
}

export { isRecordSpecificFundDetailUrl, sourceKeyForFund };
