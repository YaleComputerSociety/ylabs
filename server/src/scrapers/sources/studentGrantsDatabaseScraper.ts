/**
 * StudentGrantsDatabaseScraper
 *
 * Enumerates the Yale Student Grants Database - Yale's single most comprehensive
 * officially-curated catalog of student funding opportunities. The public entry
 * point studentgrants.yale.edu 301-redirects to the CommunityForce app at
 * yale.communityforce.com, whose fund search is public and browseable; only
 * *applying* requires a login. Each fund has its own /Funds/FundDetails.aspx
 * detail page that carries the deadline, eligibility facets, award amount, and
 * sponsoring organization.
 *
 * The catalog is an ASP.NET / CommunityForce app driven by JavaScript postbacks,
 * so the fund grid is only reachable through the shared rendered (headless) fetch
 * path - a plain HTTP GET returns the search-form shell with no fund rows. This
 * producer therefore fetches through `createScraplingRenderedFetcher`. When no
 * rendered fetcher is configured, or the rendered results/detail pages come back
 * blocked or empty (an auth wall, a bot challenge, or an offline catalog), it
 * fails closed and emits nothing rather than minting funds from a login shell.
 *
 * It walks the rendered search results only to enumerate funds, then fetches and
 * cites each fund's own FundDetails page - never the search/index root - per the
 * self-referential / index-page source guards (#516/#549). A fund is emitted only
 * when it resolves to a record-specific FundDetails URL (`/Funds/FundDetails.aspx`
 * with a query string), so a bare portal root can never be cited. Contact data is
 * fail-closed: no scraped emails or phone numbers are ingested; the sponsoring
 * organization is recorded as the contact office and the read-time contact
 * derivation owns the outreach route, consistent with skills/scrapers/SKILL.md.
 *
 * Funds already discovered via the public fellowship pages (which carry the same
 * FundDetails URL as their applicationLink) merge into the existing record rather
 * than duplicating, via the materializer's record-specific application-link
 * dedupe (see findFellowshipByRecordSpecificApplicationLink in entityMaterializer).
 */
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import { createScraplingRenderedFetcher, type RenderedFetcher } from '../renderedFetch';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { classifyProgram } from '../../services/programClassifier';
import { sanitizeStoredCatalogDescription } from '../../utils/descriptionHygiene';
import { slugify } from '../utils/scraperHelpers';
import { isRecordSpecificApplicationPortalUrl } from '../../utils/researchHomeWebsiteUrl';
import { parseDeadlineToUtcEndOfDay } from './yaleCollegeFellowshipsOfficeScraper';

export const STUDENT_GRANTS_DATABASE_SOURCE = 'student-grants-database';

const COMMUNITYFORCE_HOST = 'yale.communityforce.com';

export const DEFAULT_STUDENT_GRANTS_SEARCH_URL = `https://${COMMUNITYFORCE_HOST}/Funds/Search.aspx`;

const FETCH_TIMEOUT_MS = 30_000;
const MAX_FUNDS = 1_000;

export interface StudentGrantsFundLink {
  title: string;
  url: string;
}

export interface StudentGrantsFund {
  sourceKey: string;
  title: string;
  url: string;
  description?: string;
  eligibility?: string;
  awardAmount?: string;
  sponsoringOrganization?: string;
  deadline?: Date;
  yearOfStudy: string[];
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

export function isRecordSpecificFundDetailUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== COMMUNITYFORCE_HOST) return false;
    if (!/^\/Funds\/FundDetails\.aspx$/i.test(parsed.pathname)) return false;
    return isRecordSpecificApplicationPortalUrl(parsed.toString());
  } catch {
    return false;
  }
}

function normalizeFundDetailUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function fundIdentityKey(url: string): string {
  try {
    const parsed = new URL(normalizeFundDetailUrl(url));
    const params = Array.from(parsed.searchParams.entries())
      .map(([key, value]) => `${key.toLowerCase()}=${value}`)
      .sort();
    const query = params.length > 0 ? params.join('&') : parsed.search.replace(/^\?/, '');
    return `${parsed.pathname.toLowerCase()}?${query}`;
  } catch {
    return url;
  }
}

export function sourceKeyForFund(url: string): string {
  return `${STUDENT_GRANTS_DATABASE_SOURCE}:${slugify(fundIdentityKey(url)).slice(0, 90)}`;
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

const FACET_LABELS: Array<{ field: keyof StudentGrantsFund; labels: string[] }> = [
  { field: 'yearOfStudy', labels: ['year of study', 'class year', 'student level', 'year level'] },
  { field: 'termOfAward', labels: ['term of award', 'term', 'award period', 'period of award'] },
  { field: 'purpose', labels: ['purpose', 'purpose of award', 'category', 'award type'] },
  { field: 'globalRegions', labels: ['region', 'country', 'geographic region', 'location'] },
  {
    field: 'citizenshipStatus',
    labels: ['citizenship', 'citizenship status', 'residency', 'citizenship requirement'],
  },
];

/**
 * A FundDetails page renders each field as its own labeled block. Collecting the
 * text of each block element keeps a "Label: value" field from bleeding into the
 * next when the whole body is flattened to a single line, which is what makes
 * label extraction robust on both the real structured page and normalized text.
 */
function fieldLines($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): string[] {
  const lines: string[] = [];
  root.find('p, li, td, th, dt, dd, tr, h2, h3, h4').each((_i, el) => {
    const line = cleanText($(el).text());
    if (line) lines.push(line);
  });
  return lines;
}

const LABEL_LINE_RE = /^[A-Za-z][A-Za-z '&/-]{1,40}\s*[:-]\s/;

function extractDescription($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): string | undefined {
  const paragraphs: string[] = [];
  root.find('p').each((_i, el) => {
    const text = cleanText($(el).text());
    if (text.length >= 40 && !LABEL_LINE_RE.test(text)) paragraphs.push(text);
  });
  const prose = paragraphs.join(' ').trim();
  const safe = sanitizeStoredCatalogDescription(prose, 2000);
  return safe || undefined;
}

function labelValueFromLines(lines: string[], labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}\\s*[:\\-]\\s*(.+)$`, 'i');
    for (const line of lines) {
      const value = cleanText(line.match(pattern)?.[1]);
      if (value && value.length >= 2) return value.slice(0, 240);
    }
  }
  return undefined;
}

function splitFacetValues(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[;,/]|(?:\s+and\s+)/i)
        .map((token) => cleanText(token))
        .filter((token) => token.length >= 2 && token.length <= 80),
    ),
  );
}

function extractAwardAmount(lines: string[], bodyText: string): string | undefined {
  const labeled = labelValueFromLines(lines, [
    'award amount',
    'amount',
    'award',
    'stipend',
    'funding amount',
  ]);
  if (labeled && /\$|\d/.test(labeled)) return labeled.slice(0, 120);
  const dollar = bodyText.match(/\$\s?\d[\d,]*(?:\.\d{2})?(?:\s?[-–]\s?\$?\d[\d,]*(?:\.\d{2})?)?/);
  return dollar ? cleanText(dollar[0]).slice(0, 120) : undefined;
}

function hasActiveApplicationLanguage(text: string): boolean {
  return /\baccepting applications\b|\bapplications?\s+(?:are\s+)?(?:now\s+)?open\b|\brolling\b|\bno\s+(?:fixed|set)\s+deadline\b/i.test(
    text,
  );
}

function detailContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  const scoped = $('#ctl00_PreContent, .FundDetails, main, [role="main"], article').first();
  const root = scoped.length > 0 ? scoped : $('body');
  const clone = root.clone();
  clone
    .find('script, style, noscript, nav, header, footer, aside, [role="navigation"], .breadcrumb')
    .remove();
  return clone;
}

/**
 * A FundDetails page reached without an authenticated session degrades to the
 * search-filter / login shell rather than showing the fund. Recognizing that
 * shell lets the producer fail closed on the whole catalog instead of minting a
 * login page as a fund.
 */
function isFundDetailAuthShell($: cheerio.CheerioAPI, title: string): boolean {
  const heading = cleanText($('h1').first().text()).toLowerCase();
  if (/search filters?:|please (?:log ?in|sign ?in)|session (?:expired|timed out)/i.test(heading)) {
    return true;
  }
  return !title;
}

export function parseFundDetailPage(
  html: string,
  fund: StudentGrantsFundLink,
  referenceDate: Date = new Date(),
): StudentGrantsFund | null {
  const $ = cheerio.load(html);
  const heading =
    cleanText($('h1.Grant_hd, h1.FundTitle, .FundDetails h1').first().text()) ||
    cleanText($('h1').first().text());
  const title = heading || cleanText(fund.title);
  if (isFundDetailAuthShell($, heading || fund.title)) return null;
  if (!title) return null;

  const root = detailContentRoot($);
  const bodyText = cleanText(root.text());
  const lines = fieldLines($, root);
  const description = extractDescription($, root);
  const eligibility = labelValueFromLines(lines, ['eligibility', 'who can apply', 'who is eligible']);
  const sponsoringOrganization = labelValueFromLines(lines, [
    'sponsoring organization',
    'sponsor',
    'department',
    'administered by',
    'offered by',
  ]);
  const deadline = parseDeadlineToUtcEndOfDay(bodyText, referenceDate);
  const awardAmount = extractAwardAmount(lines, bodyText);

  const facets: Record<string, string[]> = {};
  for (const { field, labels } of FACET_LABELS) {
    facets[field as string] = splitFacetValues(labelValueFromLines(lines, labels));
  }

  return {
    sourceKey: sourceKeyForFund(fund.url),
    title,
    url: normalizeFundDetailUrl(fund.url),
    description,
    eligibility: eligibility ? cleanText(eligibility).slice(0, 500) : undefined,
    awardAmount,
    sponsoringOrganization: sponsoringOrganization
      ? cleanText(sponsoringOrganization).slice(0, 160)
      : undefined,
    deadline,
    yearOfStudy: facets.yearOfStudy,
    termOfAward: facets.termOfAward,
    purpose: facets.purpose,
    globalRegions: facets.globalRegions,
    citizenshipStatus: facets.citizenshipStatus,
    isAcceptingApplications:
      (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
      hasActiveApplicationLanguage(bodyText),
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
    awardAmount: fund.awardAmount || '',
    sponsoringOrganization: fund.sponsoringOrganization || '',
    deadline: fund.deadline?.toISOString() || '',
    yearOfStudy: fund.yearOfStudy,
    termOfAward: fund.termOfAward,
    purpose: fund.purpose,
    globalRegions: fund.globalRegions,
    citizenshipStatus: fund.citizenshipStatus,
    isAcceptingApplications: fund.isAcceptingApplications,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function fundToObservations(fund: StudentGrantsFund): ObservationInput[] {
  const classification = classifyProgram({
    title: fund.title,
    summary: undefined,
    description: fund.description,
    purpose: fund.purpose,
    termOfAward: fund.termOfAward,
    sourceUrl: fund.url,
  });
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

  return [
    observation('sourceKey', fund.sourceKey),
    observation('sourceName', STUDENT_GRANTS_DATABASE_SOURCE),
    observation('sourceUrl', fund.url),
    observation('sourceFingerprint', fundFingerprint(fund)),
    observation('programCategory', classification.programCategory),
    observation('programKind', classification.programKind),
    observation('entryMode', classification.entryMode),
    observation('studentFacingCategory', classification.studentFacingCategory),
    observation('requiresMentorBeforeApply', classification.requiresMentorBeforeApply),
    observation('mentorMatching', classification.mentorMatching),
    observation('undergraduateOnly', classification.undergraduateOnly),
    observation('yaleCollegeOnly', classification.yaleCollegeOnly),
    observation('compensationSummary', classification.compensationSummary),
    observation('programDates', classification.programDates),
    observation('bestNextStep', classification.bestNextStep),
    observation('prepSteps', classification.prepSteps),
    observation('title', fund.title),
    observation('description', fund.description),
    observation('eligibility', fund.eligibility),
    observation('awardAmount', fund.awardAmount),
    observation('applicationLink', fund.url),
    observation('links', [{ label: 'Application', url: fund.url }]),
    observation('deadline', fund.deadline),
    observation('contactOffice', fund.sponsoringOrganization),
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
    if (!renderedFetcher) return '';
    const cacheKey = `rendered-page:v1:${url}`;
    if (useCache) {
      const cached = await getCached<string>(sourceName, cacheKey);
      if (cached) return cached;
    }
    const result = await renderedFetcher({ url, mode: 'stealthy', timeoutMs: FETCH_TIMEOUT_MS });
    const html = result && !result.blocked ? result.html || '' : '';
    if (useCache && html) await setCached(sourceName, cacheKey, html);
    return html;
  };
}

export class StudentGrantsDatabaseScraper implements IScraper {
  readonly name = STUDENT_GRANTS_DATABASE_SOURCE;
  readonly displayName = 'Yale Student Grants Database (CommunityForce)';

  constructor(
    private readonly searchUrl: string = DEFAULT_STUDENT_GRANTS_SEARCH_URL,
    private readonly htmlFetcher: StudentGrantsHtmlFetcher = createRenderedStudentGrantsHtmlFetcher(),
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = Math.min(limitOption ?? Infinity, MAX_FUNDS);
    const referenceDate = new Date();

    ctx.log(`[student-grants] fetching rendered fund search ${this.searchUrl}`);
    const searchHtml = await this.htmlFetcher(this.searchUrl, ctx.options.useCache, this.name);
    if (!searchHtml) {
      ctx.log(
        '[student-grants] skipped - rendered search unavailable (headless fetcher disabled or blocked)',
      );
      return { observationCount: 0, entitiesObserved: 0, notes: 'rendered-search-unavailable' };
    }

    const fundLinks = parseFundSearchResults(searchHtml, this.searchUrl);
    ctx.log(`[student-grants] discovered ${fundLinks.length} funds in the catalog`);
    if (fundLinks.length === 0) {
      return { observationCount: 0, entitiesObserved: 0, notes: 'no-funds-in-rendered-search' };
    }

    let totalObservations = 0;
    let totalEntities = 0;
    let withDeadline = 0;
    let unavailable = 0;

    for (const link of fundLinks) {
      if (totalEntities >= limit) break;
      const detailHtml = await this.htmlFetcher(link.url, ctx.options.useCache, this.name);
      if (!detailHtml) {
        unavailable += 1;
        ctx.log(`[student-grants] skipped fund - rendered detail unavailable`, { url: link.url });
        continue;
      }
      const fund = parseFundDetailPage(detailHtml, link, referenceDate);
      if (!fund) {
        unavailable += 1;
        ctx.log(`[student-grants] skipped fund - detail failed closed (auth shell or no title)`, {
          url: link.url,
        });
        continue;
      }
      const observations = fundToObservations(fund);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
      if (fund.deadline) withDeadline += 1;
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} student-grants funds (${withDeadline} with a parsed deadline, ${unavailable} skipped)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `funds=${totalEntities}, discovered=${fundLinks.length}, withDeadline=${withDeadline}, skipped=${unavailable}`,
    };
  }
}
