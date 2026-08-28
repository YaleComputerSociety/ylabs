/**
 * Yale-hosted NSF REU / summer research program scraper.
 *
 * Yale runs multiple long-running summer research programs that are the primary
 * structured on-ramp for undergraduates who do not already have a faculty
 * connection, including students visiting from other institutions (e.g. the
 * Dorrit Hoffleit Astronomy program and SUMRY). Each lives on its own
 * department/center domain with its own application portal and fixed summer
 * window. This source cites each program's own official Yale page and emits
 * `fellowship` observations that classify as SUMMER_RESEARCH_PROGRAM.
 *
 * Discovery is cross-checked against the NSF REU Sites directory (a non-Yale,
 * crawl-seed-only enumeration that is never cited): links to Yale-hosted sites
 * found there are folded into the curated seed set. Contact is fail-closed - no
 * scraped emails are emitted; the read-time layer derives contact from the
 * official page. Application portals (the external apply link) are recorded as a
 * link, never fetched or cited as a source.
 */
import axios from 'axios';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { classifyProgram } from '../../services/programClassifier';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { sanitizeStoredCatalogDescription } from '../../utils/descriptionHygiene';
import { humanizeProgramLinkLabel } from '../../utils/programLinkLabel';
import { isUnhelpfulProgramUrl } from '../../utils/researchHomeWebsiteUrl';

export const YALE_REU_PROGRAMS_SOURCE = 'yale-reu-programs';

/**
 * Curated, reviewable seed of Yale-hosted summer research / REU program pages.
 * Each entry's `url` is the program's own official Yale page and is cited as the
 * source; `hostingOffice` is a display label, not a contact route. Grow this list
 * as the NSF REU Sites directory / department pages surface more Yale sites.
 */
export interface ReuProgramSeed {
  url: string;
  hostingOffice: string;
}

export const CURATED_YALE_REU_PROGRAM_SEEDS: ReuProgramSeed[] = [
  {
    url: 'https://astronomy.yale.edu/undergraduate-program/research/dorrit-hoffleit-undergraduate-research-scholarship',
    hostingOffice: 'Yale Department of Astronomy',
  },
  {
    url: 'https://sumry.yale.edu/',
    hostingOffice: 'Yale Department of Mathematics',
  },
];

/**
 * NSF REU Sites directory pages used only to discover Yale-hosted site URLs.
 * These are non-Yale hosts: parsed for yale.edu links, never emitted as a source
 * citation (self-referential / index-page source guards #516/#549).
 */
export const NSF_REU_DIRECTORY_SEED_URLS = [
  'https://www.nsf.gov/crssprgm/reu/reu_search.jsp',
];

const MAX_DISCOVERED_YALE_PROGRAM_PAGES = 60;
const MAX_PROGRAM_LINKS = 8;

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

export interface ReuProgramCandidate {
  sourceKey: string;
  sourceFingerprint: string;
  title: string;
  description?: string;
  eligibility?: string;
  competitionType: string;
  sourceUrl: string;
  applicationLink?: string;
  links: Array<{ label: string; url: string }>;
  deadline?: Date;
  contactOffice?: string;
  termOfAward: string[];
  purpose: string[];
  isAcceptingApplications: boolean;
  reviewRequired: boolean;
}

type FetchPage = (url: string, useCache: boolean) => Promise<string>;

interface YaleReuProgramsScraperDeps {
  programSeeds?: ReuProgramSeed[];
  nsfDirectoryUrls?: string[];
  fetchPage?: FetchPage;
  retryDelay?: (attempt: number) => Promise<void>;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sourceKeyForTitle(title: string): string {
  return `${YALE_REU_PROGRAMS_SOURCE}:${slugify(title)}`;
}

export function isYaleOwnedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'yale.edu' || hostname.endsWith('.yale.edu');
  } catch {
    return false;
  }
}

function absoluteUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:mailto|tel):/i.test(trimmed)) return undefined;
  try {
    return new URL(trimmed, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
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

function isReuOrSummerResearchUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /reu|research-experiences?-for-undergraduates|summer[-/]?(?:undergraduate[-/]?)?research|undergraduate[-/]?research/.test(
      pathname,
    );
  } catch {
    return false;
  }
}

function inferTerm(text: string): string[] {
  const terms = new Set<string>();
  if (/\bsummer\b/i.test(text)) terms.add('Summer');
  if (/\bacademic year\b|\byear[-\s]?long\b/i.test(text)) terms.add('Academic Year');
  return Array.from(terms);
}

const ELIGIBILITY_HEADING_RE = /\beligibility|who (?:can|may) apply|who is eligible|requirements?\b/i;
const APPLICATION_HEADING_RE =
  /(?:how to apply|application (?:process|information|requirements?|materials?)|to apply)/i;

function sectionTextForHeading($: cheerio.CheerioAPI, headingPattern: RegExp): string | undefined {
  const sections: string[] = [];
  $('h1,h2,h3,h4,h5,h6').each((_index, heading) => {
    const title = normalizeWhitespace($(heading).text());
    if (!headingPattern.test(title)) return;
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const content: string[] = [];
    let sibling = $(heading).next();
    while (sibling.length > 0) {
      const tagName = sibling[0]?.tagName?.toLowerCase() || '';
      if (/^h[1-6]$/.test(tagName)) {
        const siblingLevel = Number.parseInt(tagName.slice(1), 10);
        if (siblingLevel <= level) break;
      }
      const text = normalizeWhitespace(sibling.text());
      if (text) content.push(text);
      sibling = sibling.next();
    }
    const section = normalizeWhitespace(content.join(' '));
    if (section) sections.push(section);
  });
  const combined = normalizeWhitespace(sections.join(' '));
  return combined ? combined.slice(0, 1200) : undefined;
}

function nearestDeadlineText(text: string): string {
  const normalized = normalizeWhitespace(text);
  const label = /\b(?:application\s+)?deadline\b|\bapplications?\s+(?:are\s+)?due\b|\bapply\s+by\b|\bdue\s+by\b/i.exec(
    normalized,
  );
  if (!label || label.index === undefined) return '';
  const monthPattern = Object.keys(MONTHS).join('|');
  const namedDate = `(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?[,]?\\s*(?:${monthPattern})\\s+\\d{1,2}(?!\\d)(?:,\\s*\\d{4})?`;
  const numericDate = String.raw`\d{1,2}\/\d{1,2}\/\d{2,4}`;
  const datePattern = new RegExp(`(?:${namedDate}|${numericDate})`, 'i');
  const after = normalized.slice(label.index + label[0].length, label.index + label[0].length + 120);
  return datePattern.exec(after)?.[0] || '';
}

export function parseDeadlineToUtcEndOfDay(
  text: string,
  referenceDate: Date = new Date(),
): Date | undefined {
  const normalized = normalizeWhitespace(text);
  const numeric = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (numeric) {
    const month = Number(numeric[1]) - 1;
    const day = Number(numeric[2]);
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === day
    ) {
      return date;
    }
  }
  const monthPattern = Object.keys(MONTHS).join('|');
  const match = normalized.match(
    new RegExp(
      `(${monthPattern})\\s+(\\d{1,2})(?!\\d)(?:,\\s*(\\d{4}))?`,
      'i',
    ),
  );
  if (!match) return undefined;
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  let year = match[3] ? Number(match[3]) : referenceDate.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  if (!match[3] && date.getTime() < referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000) {
    year += 1;
    date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  }
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return undefined;
  }
  return date;
}

function hasActiveApplicationLanguage(text: string): boolean {
  return /\bapplications?\s+(?:are\s+)?(?:now\s+)?open\b|\bcurrently accepting applications\b|\baccepting applications\b|\bapplications?\s+(?:are\s+)?accepted\b/i.test(
    text,
  );
}

function competitionTypeForText(text: string): string {
  if (/research experiences? for undergraduates|\bnsf reu\b|\breu\b/i.test(text)) {
    return 'NSF REU (Research Experiences for Undergraduates)';
  }
  return 'Summer Undergraduate Research Program';
}

function isInExcludedRegion($link: cheerio.Cheerio<any>): boolean {
  return (
    $link.closest(
      'header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .breadcrumbs, .menu, .sidebar',
    ).length > 0
  );
}

function isApplyLink(url: string, label: string): boolean {
  return /\bapply|application|register\b/i.test(label) || /\bapply|application\b/i.test(url);
}

function fingerprintCandidate(candidate: Omit<ReuProgramCandidate, 'sourceFingerprint'>): string {
  const stable = {
    title: candidate.title,
    description: candidate.description || '',
    eligibility: candidate.eligibility || '',
    competitionType: candidate.competitionType,
    sourceUrl: candidate.sourceUrl,
    applicationLink: candidate.applicationLink || '',
    links: candidate.links,
    deadline: candidate.deadline?.toISOString() || '',
    contactOffice: candidate.contactOffice || '',
    termOfAward: candidate.termOfAward,
    purpose: candidate.purpose,
    isAcceptingApplications: candidate.isAcceptingApplications,
    reviewRequired: candidate.reviewRequired,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/**
 * Parse one Yale program page into a candidate. Returns undefined for a
 * non-Yale page (the source citation must be Yale-owned), a page with no
 * usable title, or a page whose prose carries no summer-research/REU signal.
 */
export function parseReuProgramPage(
  html: string,
  pageUrl: string,
  hostingOffice: string,
  referenceDate: Date = new Date(),
): ReuProgramCandidate | undefined {
  if (!isYaleOwnedUrl(pageUrl)) return undefined;
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const title = normalizeWhitespace($('h1').first().text());
  if (!title || title.length > 200) return undefined;

  const contentRoot = $('main, [role="main"], article').first();
  const root = contentRoot.length > 0 ? contentRoot : $('body');
  const chromeFree = root.clone();
  chromeFree
    .find(
      'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .breadcrumbs, .menu, .sidebar',
    )
    .remove();
  const bodyText = normalizeWhitespace(chromeFree.text());
  const identityText = `${title} ${bodyText}`;

  const isSummerResearchProgram =
    /research experiences? for undergraduates|\bnsf reu\b|\breu\b/i.test(identityText) ||
    (/\bsummer\b/i.test(identityText) &&
      /\bresearch\b/i.test(identityText) &&
      /\bundergraduate|students of any|any institution|visiting students|any nationality\b/i.test(
        identityText,
      ));
  if (!isSummerResearchProgram) return undefined;

  const description = sanitizeStoredCatalogDescription(bodyText, 2000) || undefined;
  const eligibility = sectionTextForHeading($, ELIGIBILITY_HEADING_RE);
  const applicationInfo = sectionTextForHeading($, APPLICATION_HEADING_RE);
  const deadline = parseDeadlineToUtcEndOfDay(
    nearestDeadlineText(`${applicationInfo || ''} ${bodyText}`),
    referenceDate,
  );

  const links: Array<{ label: string; url: string }> = [];
  const seenUrls = new Set<string>();
  for (const link of root.find('a').toArray()) {
    const $link = $(link);
    if (isInExcludedRegion($link)) continue;
    const rawUrl = absoluteUrl($link.attr('href'), pageUrl);
    if (!rawUrl) continue;
    const url = normalizeUrl(rawUrl);
    if (seenUrls.has(url)) continue;
    const rawLabel = normalizeWhitespace($link.text());
    if (!isApplyLink(url, rawLabel)) continue;
    if (isUnhelpfulProgramUrl(url, pageUrl)) continue;
    seenUrls.add(url);
    links.push({ label: humanizeProgramLinkLabel(rawLabel, url) || rawLabel || 'Application', url });
    if (links.length >= MAX_PROGRAM_LINKS) break;
  }
  const applicationLink = links.find((link) => isApplyLink(link.url, link.label))?.url;

  const termOfAward = inferTerm(identityText);
  const isAcceptingApplications =
    (deadline ? deadline.getTime() > referenceDate.getTime() : false) ||
    hasActiveApplicationLanguage(bodyText);

  const candidate: Omit<ReuProgramCandidate, 'sourceFingerprint'> = {
    sourceKey: sourceKeyForTitle(title),
    title,
    description,
    eligibility,
    competitionType: competitionTypeForText(identityText),
    sourceUrl: pageUrl,
    applicationLink,
    links,
    deadline,
    contactOffice: hostingOffice || undefined,
    termOfAward,
    purpose: ['Research'],
    isAcceptingApplications,
    reviewRequired: !deadline,
  };
  return { ...candidate, sourceFingerprint: fingerprintCandidate(candidate) };
}

/**
 * Parse an NSF REU Sites directory page for links to Yale-hosted program sites.
 * The directory host is non-Yale and is never cited; only Yale-owned links are
 * folded into the crawl set.
 */
export function extractYaleSiteUrlsFromNsfDirectory(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const urls = new Set<string>();
  for (const link of $('a').toArray()) {
    const rawUrl = absoluteUrl($(link).attr('href'), pageUrl);
    if (!rawUrl) continue;
    const url = normalizeUrl(rawUrl);
    if (!isYaleOwnedUrl(url) || !isHtmlLikeUrl(url) || !isReuOrSummerResearchUrl(url)) continue;
    urls.add(url);
  }
  return Array.from(urls).sort();
}

function observation(
  field: string,
  value: unknown,
  candidate: ReuProgramCandidate,
): ObservationInput | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return {
    entityType: 'fellowship',
    entityKey: candidate.sourceKey,
    field,
    value,
    sourceUrl: candidate.sourceUrl,
    confidenceOverride: 0.92,
  };
}

function currentSourceObservation(
  field: string,
  value: unknown,
  candidate: ReuProgramCandidate,
): ObservationInput {
  return {
    entityType: 'fellowship',
    entityKey: candidate.sourceKey,
    field,
    value,
    sourceUrl: candidate.sourceUrl,
    confidenceOverride: 0.92,
  };
}

export function candidateToObservations(candidate: ReuProgramCandidate): ObservationInput[] {
  const classification = classifyProgram({
    title: candidate.title,
    competitionType: candidate.competitionType,
    description: candidate.description,
    eligibility: candidate.eligibility,
    purpose: candidate.purpose,
    termOfAward: candidate.termOfAward,
    sourceUrl: candidate.sourceUrl,
  });
  return [
    observation('sourceKey', candidate.sourceKey, candidate),
    observation('sourceName', YALE_REU_PROGRAMS_SOURCE, candidate),
    observation('sourceUrl', candidate.sourceUrl, candidate),
    observation('sourceFingerprint', candidate.sourceFingerprint, candidate),
    observation('programCategory', classification.programCategory, candidate),
    observation('programKind', classification.programKind, candidate),
    observation('entryMode', classification.entryMode, candidate),
    observation('studentFacingCategory', classification.studentFacingCategory, candidate),
    observation('requiresMentorBeforeApply', classification.requiresMentorBeforeApply, candidate),
    observation('mentorMatching', classification.mentorMatching, candidate),
    observation('undergraduateOnly', classification.undergraduateOnly, candidate),
    observation('programDates', classification.programDates, candidate),
    observation('bestNextStep', classification.bestNextStep, candidate),
    observation('prepSteps', classification.prepSteps, candidate),
    observation('title', candidate.title, candidate),
    observation('competitionType', candidate.competitionType, candidate),
    observation('description', candidate.description, candidate),
    observation('eligibility', candidate.eligibility, candidate),
    currentSourceObservation('researchFocused', true, candidate),
    currentSourceObservation('archived', false, candidate),
    observation('applicationLink', candidate.applicationLink, candidate),
    observation('links', candidate.links, candidate),
    observation('deadline', candidate.deadline, candidate),
    observation('contactOffice', candidate.contactOffice, candidate),
    observation('termOfAward', candidate.termOfAward, candidate),
    observation('purpose', candidate.purpose, candidate),
    observation('isAcceptingApplications', candidate.isAcceptingApplications, candidate),
    observation('reviewRequired', candidate.reviewRequired, candidate),
  ].filter((item): item is ObservationInput => !!item);
}

async function fetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(YALE_REU_PROGRAMS_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 30000,
    headers: {
      'User-Agent': 'YLabsBot/1.0 (+https://ylabs.yale.edu)',
      Accept: 'text/html,application/xhtml+xml',
    },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = String(res.data || '');
  if (useCache) await setCached(YALE_REU_PROGRAMS_SOURCE, cacheKey, html);
  return html;
}

export class YaleReuProgramsScraper implements IScraper {
  readonly name = YALE_REU_PROGRAMS_SOURCE;
  readonly displayName = 'Yale REU & Summer Research Programs';

  private readonly programSeeds: ReuProgramSeed[];
  private readonly nsfDirectoryUrls: string[];
  private readonly fetchPage: FetchPage;
  private readonly retryDelay: (attempt: number) => Promise<void>;

  constructor(deps: YaleReuProgramsScraperDeps = {}) {
    this.programSeeds = deps.programSeeds || CURATED_YALE_REU_PROGRAM_SEEDS;
    this.nsfDirectoryUrls = deps.nsfDirectoryUrls || NSF_REU_DIRECTORY_SEED_URLS;
    this.fetchPage = deps.fetchPage || fetchHtml;
    this.retryDelay =
      deps.retryDelay ||
      ((attempt) => new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)));
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 0)) {
      throw new Error('--limit must be a safe non-negative integer');
    }

    const referenceDate = new Date();
    const officeByUrl = new Map<string, string>();
    for (const seed of this.programSeeds) {
      officeByUrl.set(normalizeUrl(seed.url), seed.hostingOffice);
    }

    const discoveredUrls = new Set<string>();
    for (const directoryUrl of this.nsfDirectoryUrls) {
      try {
        const html = await this.fetchPage(directoryUrl, ctx.options.useCache);
        for (const url of extractYaleSiteUrlsFromNsfDirectory(html, directoryUrl)) {
          discoveredUrls.add(url);
        }
      } catch (error) {
        ctx.log('Skipping NSF REU directory page after fetch/parse failure', {
          url: directoryUrl,
          error: sanitizeLogValue(error),
        });
      }
    }

    const seededUrls = this.programSeeds
      .map((seed) => normalizeUrl(seed.url))
      .filter(isYaleOwnedUrl);
    const programUrls = Array.from(new Set([...seededUrls, ...discoveredUrls]))
      .filter(isYaleOwnedUrl)
      .slice(0, MAX_DISCOVERED_YALE_PROGRAM_PAGES);

    const candidatesByKey = new Map<string, ReuProgramCandidate>();
    const failedUrls: string[] = [];
    let fetchSuccesses = 0;

    for (const url of programUrls) {
      let parsed: ReuProgramCandidate | undefined;
      let lastError: unknown;
      let fetched = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const html = await this.fetchPage(url, ctx.options.useCache);
          fetched = true;
          parsed = parseReuProgramPage(
            html,
            url,
            officeByUrl.get(url) || 'Yale',
            referenceDate,
          );
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await this.retryDelay(attempt);
        }
      }
      if (!fetched) {
        failedUrls.push(url);
        ctx.log('Skipping Yale REU program page after fetch failure', {
          url,
          error: sanitizeLogValue(lastError),
        });
        continue;
      }
      fetchSuccesses += 1;
      if (parsed) candidatesByKey.set(parsed.sourceKey, parsed);
    }

    if (fetchSuccesses === 0 && failedUrls.length > 0) {
      throw new Error(
        `No Yale REU program pages could be fetched; failed URLs: ${failedUrls.join(', ')}`,
      );
    }

    const allCandidates = Array.from(candidatesByKey.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    const selected =
      limitOption !== undefined ? allCandidates.slice(0, limitOption) : allCandidates;
    const observations = selected.flatMap(candidateToObservations);
    if (observations.length > 0) await ctx.emit(observations);

    const deadlineParsed = selected.filter((candidate) => !!candidate.deadline).length;
    const noteParts: string[] = [];
    if (failedUrls.length > 0) {
      noteParts.push(`Skipped ${failedUrls.length} REU program page(s) after fetch failure.`);
    }

    return {
      observationCount: observations.length,
      entitiesObserved: selected.length,
      notes: noteParts.length > 0 ? noteParts.join(' ') : undefined,
      metrics: {
        reuPrograms: {
          seeded: seededUrls.length,
          nsfDirectoryDiscovered: discoveredUrls.size,
          fetched: fetchSuccesses,
          emitted: selected.length,
          deadlineParsed,
          deadlineMissing: selected.length - deadlineParsed,
        },
      },
    };
  }
}
