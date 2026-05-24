/**
 * Public-page Yale fellowship catalog scraper.
 *
 * This source keeps Fellowship rows fresh from official Yale pages while
 * treating gated CommunityForce URLs as application links, not fetch targets.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  candidateToProgramObservations,
  finalizeProgramCandidate,
  inferProgramAccessRole,
  parseProgramDeadlineToUtcEndOfDay,
  type ProgramAccessRole,
} from '../programCandidate';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

export const YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE = 'yale-college-fellowships-office';

const DEFAULT_PAGE_URLS = [
  'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale',
];

const PUBLIC_YALE_HOSTS = new Set([
  'funding.yale.edu',
  'yalecollege.yale.edu',
  'college.yale.edu',
  'science.yalecollege.yale.edu',
]);

export interface FellowshipCatalogCandidate {
  sourceKey: string;
  sourceFingerprint: string;
  sourceName?: typeof YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE;
  title: string;
  summary?: string;
  description?: string;
  sourceUrl: string;
  applicationLink?: string;
  links: Array<{ label: string; url: string }>;
  deadline?: Date;
  applicationOpenDate?: Date;
  contactOffice?: string;
  contactEmail?: string;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  isAcceptingApplications: boolean;
  reviewRequired: boolean;
  programCategory?: 'FELLOWSHIP';
  programAccessRole?: ProgramAccessRole;
}

type FetchPage = (url: string, useCache: boolean) => Promise<string>;

interface YaleCollegeFellowshipsOfficeScraperDeps {
  pageUrls?: string[];
  fetchPage?: FetchPage;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('#') || /^mailto:/i.test(trimmed)) return undefined;
  try {
    return new URL(trimmed, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function normalizeLinkUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.hostname.endsWith('communityforce.com')) parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return url;
  }
}

function isPublicYaleUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return PUBLIC_YALE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isYaleOwnedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'yale.edu' || hostname.endsWith('.yale.edu');
  } catch {
    return false;
  }
}

function isCommunityForceUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().endsWith('communityforce.com');
  } catch {
    return false;
  }
}

function isHtmlLikeUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return !/\.(?:pdf|docx?|xlsx?|csv|zip|jpg|jpeg|png|gif|webp)(?:$|[?#])/i.test(pathname);
  } catch {
    return false;
  }
}

function isGenericCatalogTitle(title: string): boolean {
  const normalized = normalizeWhitespace(title);
  return (
    /^(?:about|advising|administering|contact|connect|find|prepare|search)\b/i.test(
      normalized,
    ) ||
    /\b(?:alternative funding|funding options|funding sources|student grants database)\b/i.test(
      normalized,
    ) ||
    /\b(?:faculty|staff|advisers?|advisors?|resources|directory|subjects?)\b/i.test(
      normalized,
    ) ||
    /^(?:fellowships?(?: and funding)?|fellowships and funding directory)$/i.test(normalized) ||
    /offered through|opportunities at yale|fellowships and funding$/i.test(normalized)
  );
}

function isLikelyFellowshipTitle(title: string): boolean {
  const normalized = normalizeWhitespace(title);
  if (!normalized || normalized.length > 180) return false;
  if (/^\d+\s*\(/.test(normalized)) return false;
  if (isGenericCatalogTitle(normalized)) return false;
  return /\b(?:fellowships?|grants?|scholars?|scholarships?|awards?|prizes?|internships?)\b/i.test(
    normalized,
  );
}

function isGenericPublicYalePath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /(?:about-fellowships|alternative-funding|administering|advising|faculty-staff|contact|connect|prepare|resources|directory|taxonomy|subjects)/i.test(
      pathname,
    );
  } catch {
    return true;
  }
}

function isLikelyPublicFellowshipDetailUrl(url: string): boolean {
  if (!isPublicYaleUrl(url) || !isHtmlLikeUrl(url) || isGenericPublicYalePath(url)) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /(?:find-funding|fellowship|fellowships|grant|grants|scholar|scholars|award|awards|prize|prizes|stem-fellowships|yale-undergraduate-research)/i.test(
      pathname,
    );
  } catch {
    return false;
  }
}

function isEligibleCandidateHref(url: string): boolean {
  return isCommunityForceUrl(url) || isLikelyPublicFellowshipDetailUrl(url);
}

function isInExcludedPageRegion(
  $link: cheerio.Cheerio<any>,
): boolean {
  return (
    $link.closest(
      'header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .menu, .sidebar',
    ).length > 0
  );
}

function isInPrimaryContent(
  $: cheerio.CheerioAPI,
  $link: cheerio.Cheerio<any>,
): boolean {
  const primaryScopes = $('main, [role="main"], article');
  if (primaryScopes.length === 0) return true;
  return $link.closest('main, [role="main"], article').length > 0;
}

function inferTerm(text: string): string[] {
  const terms: string[] = [];
  if (/\bsummer\b/i.test(text)) terms.push('Summer');
  if (/\bfall\b/i.test(text)) terms.push('Fall');
  if (/\bspring\b/i.test(text)) terms.push('Spring');
  if (/\byear[-\s]?long\b/i.test(text)) terms.push('Academic Year');
  return Array.from(new Set(terms));
}

function inferPurpose(text: string): string[] {
  const purposes: string[] = [];
  if (/\bresearch\b/i.test(text)) purposes.push('Research');
  if (/\bstudy\b|\bcourse\b/i.test(text)) purposes.push('Study');
  if (/\btravel\b|\binternational\b|\babroad\b/i.test(text)) purposes.push('Travel');
  if (/\bservice\b|\bpublic service\b/i.test(text)) purposes.push('Service');
  return Array.from(new Set(purposes));
}

function extractEmail(text: string): string | undefined {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function hasExplicitActiveApplicationLanguage(text: string): boolean {
  return /\bapplications?\s+(are\s+)?(now\s+)?open\b|\bcurrently accepting applications\b/i.test(text);
}

function bestDeadlineText(text: string): string {
  const deadlineSentence = text.match(/[^.]*\bdeadline\b[^.]*\./i)?.[0];
  return deadlineSentence || text;
}

export function parseDeadlineToUtcEndOfDay(
  text: string,
  referenceDate: Date = new Date(),
): Date | undefined {
  const normalized = normalizeWhitespace(text);
  const exactDeadline = parseProgramDeadlineToUtcEndOfDay(normalized, referenceDate);
  if (exactDeadline) return exactDeadline;

  const monthPattern =
    'january|february|march|april|may|june|july|august|september|october|november|december';
  const match = normalized.match(
    new RegExp(
      `(?:deadline[^A-Za-z0-9]*)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?[,]?\\s*(${monthPattern})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?`,
      'i',
    ),
  );
  if (!match) return undefined;

  const month = new Date(`${match[1]} 1, 2000`).getUTCMonth();
  const day = Number(match[2]);
  let year = match[3] ? Number(match[3]) : referenceDate.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  if (!match[3] && date.getTime() < referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000) {
    year += 1;
    date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  }
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date;
}

function finalizeCandidate(
  candidate: Omit<
    FellowshipCatalogCandidate,
    'sourceKey' | 'sourceFingerprint' | 'sourceName' | 'programCategory' | 'programAccessRole'
  >,
): FellowshipCatalogCandidate {
  const inferredAccessRole = inferProgramAccessRole(
    candidate.title,
    `${candidate.summary || ''} ${candidate.description || ''}`,
  );
  return finalizeProgramCandidate({
    ...candidate,
    sourceName: YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE,
    programCategory: 'FELLOWSHIP',
    programAccessRole: inferredAccessRole === 'UNKNOWN' ? 'FUNDING_ONLY' : inferredAccessRole,
  }) as FellowshipCatalogCandidate;
}

function compactTitleIdentity(title: string): string {
  return normalizeWhitespace(title)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function existingKeyForCandidate(
  byKey: Map<string, FellowshipCatalogCandidate>,
  candidate: FellowshipCatalogCandidate,
): string {
  if (byKey.has(candidate.sourceKey)) return candidate.sourceKey;

  const applicationLink = candidate.applicationLink
    ? normalizeLinkUrl(candidate.applicationLink)
    : undefined;
  if (applicationLink) {
    for (const [key, existing] of byKey) {
      const existingUrls = [
        existing.applicationLink,
        ...existing.links.map((link) => link.url),
      ]
        .filter((url): url is string => !!url)
        .map(normalizeLinkUrl);
      if (existingUrls.includes(applicationLink)) return key;
    }
  }

  const titleIdentity = compactTitleIdentity(candidate.title);
  for (const [key, existing] of byKey) {
    if (compactTitleIdentity(existing.title) === titleIdentity) return key;
  }

  return candidate.sourceKey;
}

function preferredTitle(
  existing: FellowshipCatalogCandidate,
  incoming: FellowshipCatalogCandidate,
): string {
  const existingPunctuation = (existing.title.match(/['’.-]/g) || []).length;
  const incomingPunctuation = (incoming.title.match(/['’.-]/g) || []).length;
  if (compactTitleIdentity(existing.title) === compactTitleIdentity(incoming.title)) {
    if (incomingPunctuation > existingPunctuation) return incoming.title;
    if (
      incomingPunctuation === existingPunctuation &&
      incoming.title.length > existing.title.length
    ) {
      return incoming.title;
    }
  }
  return existing.title;
}

function upsertCandidate(
  byKey: Map<string, FellowshipCatalogCandidate>,
  candidate: FellowshipCatalogCandidate,
): void {
  const key = existingKeyForCandidate(byKey, candidate);
  const existing = byKey.get(key);
  byKey.set(key, existing ? mergeCandidates(existing, candidate) : candidate);
}

function candidateFromLink(
  $: cheerio.CheerioAPI,
  link: Parameters<cheerio.CheerioAPI>[0],
  pageUrl: string,
  referenceDate: Date,
): FellowshipCatalogCandidate | undefined {
  const $link = $(link);
  const title = normalizeWhitespace($link.text());
  if (!title || !isLikelyFellowshipTitle(title)) return undefined;

  const rawHref = absoluteUrl($link.attr('href'), pageUrl);
  const href = rawHref ? normalizeLinkUrl(rawHref) : undefined;
  if (!href) return undefined;
  if (!isEligibleCandidateHref(href)) return undefined;
  if (isInExcludedPageRegion($link) || !isInPrimaryContent($, $link)) return undefined;

  const contextContainer = $link.closest('li, p, tr, div, section, article');
  const headingContext = $link
    .closest('ul, ol, table, div, section, article')
    .prevAll('h1,h2,h3,h4,h5,h6')
    .slice(0, 4)
    .toArray()
    .map((node) => normalizeWhitespace($(node).text()))
    .join(' ');
  const rowContext = normalizeWhitespace(contextContainer.text());
  const pageContext = normalizeWhitespace($('body').text());
  const contextText = normalizeWhitespace(`${headingContext} ${rowContext}`);
  const deadline = parseDeadlineToUtcEndOfDay(bestDeadlineText(contextText), referenceDate);
  const applicationLink = isCommunityForceUrl(href) ? href : undefined;
  const sourceUrl = pageUrl;
  const links = [{ label: applicationLink ? 'Application' : title, url: href }];
  const isAcceptingApplications =
    (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
    hasExplicitActiveApplicationLanguage(contextText);

  return finalizeCandidate({
    title,
    summary: rowContext && rowContext !== title ? rowContext : undefined,
    description: undefined,
    sourceUrl,
    applicationLink,
    links,
    deadline,
    applicationOpenDate: undefined,
    contactOffice: 'Yale Fellowships and Funding',
    contactEmail: extractEmail(contextText) || extractEmail(pageContext),
    yearOfStudy: [],
    termOfAward: inferTerm(contextText || pageContext),
    purpose: inferPurpose(contextText || pageContext),
    globalRegions: [],
    citizenshipStatus: [],
    isAcceptingApplications,
    reviewRequired: !deadline,
  });
}

function candidateFromDetailPage(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  referenceDate: Date,
): FellowshipCatalogCandidate | undefined {
  const title = normalizeWhitespace($('h1').first().text());
  if (!title || !isLikelyFellowshipTitle(title)) return undefined;
  if (isGenericCatalogTitle(title)) return undefined;

  const bodyText = normalizeWhitespace($('body').text());
  const deadline = parseDeadlineToUtcEndOfDay(bestDeadlineText(bodyText), referenceDate);
  const links = $('a')
    .toArray()
    .map((link) => {
      const rawUrl = absoluteUrl($(link).attr('href'), pageUrl);
      const url = rawUrl ? normalizeLinkUrl(rawUrl) : undefined;
      const label = normalizeWhitespace($(link).text()) || 'Link';
      return url ? { label, url } : undefined;
    })
    .filter((item) => item && (isYaleOwnedUrl(item.url) || isCommunityForceUrl(item.url)))
    .filter((item): item is { label: string; url: string } => !!item);
  const applicationLink =
    links.find((link) => isCommunityForceUrl(link.url))?.url ||
    links.find((link) => /apply|application|student grants/i.test(link.label))?.url;
  const isAcceptingApplications =
    (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
    hasExplicitActiveApplicationLanguage(bodyText);

  return finalizeCandidate({
    title,
    summary: undefined,
    description: bodyText.slice(0, 2000),
    sourceUrl: pageUrl,
    applicationLink,
    links,
    deadline,
    applicationOpenDate: undefined,
    contactOffice: 'Yale Fellowships and Funding',
    contactEmail: extractEmail(bodyText),
    yearOfStudy: [],
    termOfAward: inferTerm(bodyText),
    purpose: inferPurpose(bodyText),
    globalRegions: [],
    citizenshipStatus: [],
    isAcceptingApplications,
    reviewRequired: !deadline,
  });
}

function mergeCandidates(
  existing: FellowshipCatalogCandidate,
  incoming: FellowshipCatalogCandidate,
): FellowshipCatalogCandidate {
  const links = Array.from(
    new Map(
      [...existing.links, ...incoming.links].map((link) => [
        normalizeLinkUrl(link.url),
        { ...link, url: normalizeLinkUrl(link.url) },
      ]),
    ).values(),
  );
  const applicationLink = incoming.applicationLink || existing.applicationLink;
  const merged = finalizeCandidate({
    ...existing,
    title: preferredTitle(existing, incoming),
    summary: incoming.summary || existing.summary,
    description: incoming.description || existing.description,
    sourceUrl:
      incoming.sourceUrl !== existing.sourceUrl && isPublicYaleUrl(incoming.sourceUrl)
        ? incoming.sourceUrl
        : existing.sourceUrl,
    applicationLink: applicationLink ? normalizeLinkUrl(applicationLink) : undefined,
    links,
    deadline: incoming.deadline || existing.deadline,
    applicationOpenDate: incoming.applicationOpenDate || existing.applicationOpenDate,
    contactOffice: incoming.contactOffice || existing.contactOffice,
    contactEmail: incoming.contactEmail || existing.contactEmail,
    yearOfStudy: Array.from(new Set([...existing.yearOfStudy, ...incoming.yearOfStudy])),
    termOfAward: Array.from(new Set([...existing.termOfAward, ...incoming.termOfAward])),
    purpose: Array.from(new Set([...existing.purpose, ...incoming.purpose])),
    globalRegions: Array.from(new Set([...existing.globalRegions, ...incoming.globalRegions])),
    citizenshipStatus: Array.from(
      new Set([...existing.citizenshipStatus, ...incoming.citizenshipStatus]),
    ),
    isAcceptingApplications: existing.isAcceptingApplications || incoming.isAcceptingApplications,
    reviewRequired: existing.reviewRequired && incoming.reviewRequired,
  }) as FellowshipCatalogCandidate;
  return { ...merged, sourceKey: existing.sourceKey };
}

export function parseFellowshipCatalogPage(
  html: string,
  pageUrl: string,
  referenceDate: Date = new Date(),
): FellowshipCatalogCandidate[] {
  const $ = cheerio.load(html);
  const byKey = new Map<string, FellowshipCatalogCandidate>();

  const detail = candidateFromDetailPage($, pageUrl, referenceDate);
  if (detail) upsertCandidate(byKey, detail);

  for (const link of $('a').toArray()) {
    const candidate = candidateFromLink($, link, pageUrl, referenceDate);
    if (!candidate) continue;
    upsertCandidate(byKey, candidate);
  }

  return Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));
}

export function candidateToObservations(candidate: FellowshipCatalogCandidate): ObservationInput[] {
  const inferredAccessRole =
    candidate.programAccessRole ||
    inferProgramAccessRole(candidate.title, `${candidate.summary || ''} ${candidate.description || ''}`);
  const normalizedCandidate = {
    ...candidate,
    sourceName: candidate.sourceName || YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE,
    programCategory: candidate.programCategory || 'FELLOWSHIP',
    programAccessRole: inferredAccessRole === 'UNKNOWN' ? 'FUNDING_ONLY' : inferredAccessRole,
  };

  return candidateToProgramObservations(normalizedCandidate).map((observation) => ({
    ...observation,
    confidenceOverride: 0.95,
  }));
}

async function fetchHtml(url: string, useCache: boolean): Promise<string> {
  const cacheKey = `page:${url}`;
  if (useCache) {
    const cached = await getCached<string>(YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const res = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'YLabsBot/1.0 (+https://ylabs.yale.edu)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const html = String(res.data || '');
  if (useCache) await setCached(YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE, cacheKey, html);
  return html;
}

export class YaleCollegeFellowshipsOfficeScraper implements IScraper {
  readonly name = YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE;
  readonly displayName = 'Yale College Fellowships Office';

  private readonly pageUrls: string[];
  private readonly fetchPage: FetchPage;

  constructor(deps: YaleCollegeFellowshipsOfficeScraperDeps = {}) {
    this.pageUrls = deps.pageUrls || DEFAULT_PAGE_URLS;
    this.fetchPage = deps.fetchPage || fetchHtml;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const referenceDate = new Date();
    const candidatesByKey = new Map<string, FellowshipCatalogCandidate>();
    const fetched = new Set<string>();
    const failedUrls: string[] = [];

    const parseAndMerge = async (url: string) => {
      if (fetched.has(url)) return;
      fetched.add(url);
      const html = await this.fetchPage(url, ctx.options.useCache);
      const parsed = parseFellowshipCatalogPage(html, url, referenceDate);
      for (const candidate of parsed) {
        upsertCandidate(candidatesByKey, candidate);
      }
    };
    const tryParseAndMerge = async (url: string): Promise<boolean> => {
      try {
        await parseAndMerge(url);
        return true;
      } catch (error) {
        failedUrls.push(url);
        ctx.log('Skipping fellowship catalog page after fetch/parse failure', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    };

    let seedPageSuccesses = 0;
    for (const url of this.pageUrls) {
      if (!isPublicYaleUrl(url)) continue;
      if (await tryParseAndMerge(url)) seedPageSuccesses += 1;
    }

    if (seedPageSuccesses === 0 && failedUrls.length > 0) {
      throw new Error(
        `No fellowship catalog pages could be fetched; failed URLs: ${failedUrls.join(', ')}`,
      );
    }

    const detailUrls = Array.from(
      new Set(
        Array.from(candidatesByKey.values()).flatMap((candidate) =>
          candidate.links.map((link) => link.url),
        ),
      ),
    ).filter(
      (url) =>
        isLikelyPublicFellowshipDetailUrl(url) && !this.pageUrls.includes(url) && !fetched.has(url),
    );

    for (const url of detailUrls) {
      await tryParseAndMerge(url);
    }

    const allCandidates = Array.from(candidatesByKey.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    const selected =
      typeof ctx.options.limit === 'number' && ctx.options.limit >= 0
        ? allCandidates.slice(0, ctx.options.limit)
        : allCandidates;
    const observations = selected.flatMap(candidateToObservations);
    if (observations.length > 0) await ctx.emit(observations);

    const deadlineParsed = selected.filter((candidate) => !!candidate.deadline).length;
    const reviewRequired = selected.filter((candidate) => candidate.reviewRequired).length;
    const metrics = {
      fellowshipCatalog: {
        discovered: allCandidates.length,
        emitted: selected.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        reviewRequired,
        missingPreviouslySeen: 0,
        deadlineParsed,
        deadlineMissing: selected.length - deadlineParsed,
      },
    } as ScraperResult['metrics'] & {
      fellowshipCatalog: {
        discovered: number;
        emitted: number;
        created: number;
        updated: number;
        unchanged: number;
        reviewRequired: number;
        missingPreviouslySeen: number;
        deadlineParsed: number;
        deadlineMissing: number;
      };
    };

    return {
      observationCount: observations.length,
      entitiesObserved: selected.length,
      notes:
        failedUrls.length > 0
          ? `Skipped ${failedUrls.length} fellowship page(s) after fetch/parse failure.`
          : undefined,
      metrics,
    };
  }
}
